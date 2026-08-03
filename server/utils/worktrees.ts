import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { getClaudeDir } from './claudeDir'

const exec = promisify(execFile)

/**
 * Git worktrees, one per session, so several agents can work the same
 * repository at once without overwriting each other.
 *
 * Worktrees live outside the repository, under the app's own directory. Putting
 * them inside would mean a stray `git add .` could commit another session's
 * work, and they would show up in editors and search. The cost is that they are
 * easy to forget about, which is why `listWorktrees` reads git's own record
 * rather than ours — the UI shows what actually exists on disk.
 */

export interface WorktreeRecord {
  path: string
  branch: string | null
  head: string | null
  /** True when git knows about it but the directory is gone. */
  prunable: boolean
}

export interface WorktreeStatus {
  path: string
  exists: boolean
  branch: string | null
  /** Files changed relative to the base — uncommitted or committed. */
  changedFiles: number
  /** Uncommitted changes sitting in the worktree. */
  dirty: boolean
  ahead: number
}

/** Branch names have real constraints; a session title does not. */
export function branchNameFor(title: string, id: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')

  return slug ? `agents-ui/${slug}-${id}` : `agents-ui/session-${id}`
}

/** Kept out of the repository on purpose — see the note above. */
export function worktreeRootFor(repoDir: string): string {
  return join(getClaudeDir(), 'agents-ui', 'worktrees', basename(repoDir) || 'repo')
}

export function worktreePathFor(repoDir: string, sessionId: string): string {
  return join(worktreeRootFor(repoDir), sessionId)
}

/**
 * Parse `git worktree list --porcelain`. Records are blank-line separated;
 * a `prunable` line means git still tracks a directory that is gone.
 */
export function parseWorktreeList(porcelain: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = []

  for (const block of porcelain.trim().split(/\n\s*\n/)) {
    if (!block.trim()) continue

    let path = ''
    let branch: string | null = null
    let head: string | null = null
    let prunable = false

    for (const line of block.split('\n')) {
      const [key, ...rest] = line.trim().split(' ')
      const value = rest.join(' ')

      if (key === 'worktree') path = value
      else if (key === 'HEAD') head = value
      else if (key === 'branch') branch = value.replace(/^refs\/heads\//, '')
      else if (key === 'prunable') prunable = true
      else if (key === 'detached') branch = null
    }

    if (path) records.push({ path, branch, head, prunable })
  }

  return records
}

async function git(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 })
  return stdout.trim()
}

export async function isGitRepo(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false
  try {
    const result = await git(dir, ['rev-parse', '--is-inside-work-tree'])
    return result === 'true'
  } catch {
    return false
  }
}

export async function currentBranch(repoDir: string): Promise<string> {
  try {
    return await git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  } catch {
    return 'HEAD'
  }
}

/** Every worktree git knows about for this repo — the authoritative list. */
export async function listWorktrees(repoDir: string): Promise<WorktreeRecord[]> {
  try {
    return parseWorktreeList(await git(repoDir, ['worktree', 'list', '--porcelain']))
  } catch {
    return []
  }
}

export async function createWorktree(options: {
  repoDir: string
  path: string
  branch: string
  baseRef: string
}): Promise<{ path: string; branch: string; baseSha: string }> {
  const { repoDir, path, branch, baseRef } = options

  if (existsSync(path)) {
    throw createError({
      statusCode: 409,
      data: { error: 'worktree_exists', message: `A worktree already exists at ${path}` },
    })
  }

  try {
    await git(repoDir, ['worktree', 'add', '-b', branch, path, baseRef], 120_000)
  } catch (e: any) {
    throw createError({
      statusCode: 500,
      data: {
        error: 'worktree_failed',
        message: `Could not create a workspace: ${e.stderr?.trim() || e.message}`,
      },
    })
  }

  const baseSha = await git(repoDir, ['rev-parse', baseRef]).catch(() => '')
  return { path, branch, baseSha }
}

/**
 * Remove a worktree. Refuses to discard uncommitted work unless forced, so a
 * stray click cannot destroy an agent's output.
 */
export async function removeWorktree(
  repoDir: string,
  path: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const args = ['worktree', 'remove', path]
  if (opts.force) args.push('--force')

  try {
    await git(repoDir, args, 60_000)
  } catch (e: any) {
    const stderr = e.stderr?.trim() || e.message
    if (!opts.force && /contains modified or untracked files/i.test(stderr)) {
      throw createError({
        statusCode: 409,
        data: {
          error: 'worktree_dirty',
          message: 'That workspace has uncommitted changes. Review them first, or remove it anyway.',
        },
      })
    }
    throw createError({
      statusCode: 500,
      data: { error: 'worktree_remove_failed', message: stderr },
    })
  }
}

export async function deleteBranch(repoDir: string, branch: string): Promise<void> {
  // -D rather than -d: the branch is usually unmerged, which is the point.
  await git(repoDir, ['branch', '-D', branch]).catch(() => {})
}

export async function pruneWorktrees(repoDir: string): Promise<void> {
  await git(repoDir, ['worktree', 'prune']).catch(() => {})
}

export async function worktreeStatus(
  worktreePath: string,
  baseRef: string,
): Promise<WorktreeStatus> {
  if (!existsSync(worktreePath)) {
    return { path: worktreePath, exists: false, branch: null, changedFiles: 0, dirty: false, ahead: 0 }
  }

  const branch = await currentBranch(worktreePath)
  const porcelain = await git(worktreePath, ['status', '--porcelain']).catch(() => '')
  const dirty = porcelain.length > 0

  const nameOnly = await git(worktreePath, ['diff', '--name-only', `${baseRef}...HEAD`]).catch(() => '')
  const committed = nameOnly ? nameOnly.split('\n').filter(Boolean) : []
  const uncommitted = porcelain
    ? porcelain.split('\n').filter(Boolean).map(l => l.slice(3).trim())
    : []

  const ahead = Number(
    await git(worktreePath, ['rev-list', '--count', `${baseRef}..HEAD`]).catch(() => '0')
  ) || 0

  return {
    path: worktreePath,
    exists: true,
    branch: branch === 'HEAD' ? null : branch,
    changedFiles: new Set([...committed, ...uncommitted]).size,
    dirty,
    ahead,
  }
}

export interface DiffFile {
  path: string
  added: number
  removed: number
  /** Uncommitted changes are shown separately so nothing looks already-saved. */
  staged: boolean
}

/** Numstat for everything the session changed, committed or not. */
export async function worktreeDiff(worktreePath: string, baseRef: string): Promise<{
  files: DiffFile[]
  patch: string
}> {
  if (!existsSync(worktreePath)) return { files: [], patch: '' }

  const parseNumstat = (raw: string, staged: boolean): DiffFile[] =>
    raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [added, removed, path] = line.split('\t')
        return {
          path: path ?? '',
          added: Number(added) || 0,
          removed: Number(removed) || 0,
          staged,
        }
      })
      .filter(f => f.path)

  const committed = parseNumstat(
    await git(worktreePath, ['diff', '--numstat', `${baseRef}...HEAD`]).catch(() => ''),
    true,
  )
  const working = parseNumstat(
    await git(worktreePath, ['diff', '--numstat', 'HEAD']).catch(() => ''),
    false,
  )

  // `git diff` only reports tracked files, so a brand new file — the most
  // common thing an agent produces — would otherwise be invisible here.
  const untrackedPaths = (await git(worktreePath, ['ls-files', '--others', '--exclude-standard']).catch(() => ''))
    .split('\n')
    .filter(Boolean)

  const untracked: DiffFile[] = await Promise.all(untrackedPaths.map(async (path) => {
    const lines = await readFile(join(worktreePath, path), 'utf-8')
      .then((content: string) => (content ? content.split('\n').length : 0))
      .catch(() => 0)
    return { path, added: lines, removed: 0, staged: false }
  }))

  // Both halves, or the patch contradicts the file list: a file shown as
  // "uncommitted" would be missing from the diff body entirely.
  const committedPatch = await git(worktreePath, ['diff', `${baseRef}...HEAD`], 60_000).catch(() => '')
  const workingPatch = await git(worktreePath, ['diff', 'HEAD'], 60_000).catch(() => '')

  const patch = [
    committedPatch,
    workingPatch && `${committedPatch ? '\n' : ''}--- Uncommitted ---\n${workingPatch}`,
  ].filter(Boolean).join('\n')

  const untrackedNote = untracked.length
    ? `\n\nNew files not yet committed:\n${untracked.map(f => `  ${f.path}`).join('\n')}`
    : ''

  const capped = patch.length > 200_000 ? `${patch.slice(0, 200_000)}\n\n… diff truncated` : patch
  return {
    files: [...committed, ...working, ...untracked],
    patch: capped + untrackedNote,
  }
}
