import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, sep } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * Git worktrees, one per session, so several agents can work the same
 * repository at once without overwriting each other.
 *
 * They live in a hidden directory inside the repository, which puts a session's
 * work next to the project it belongs to rather than somewhere a person would
 * never think to look. Registering the directory in `.git/info/exclude` covers
 * the obvious hazards: git stops reporting it, `git add .` will not stage it as
 * an embedded repository, and `git clean -fdx` already refuses to delete a
 * nested repository.
 *
 * What it does not cover is tooling that ignores gitignore rules. `tsc` skips
 * dot-directories, but a test runner like vitest will discover each session's
 * copy of the suite unless its config excludes this directory.
 *
 * `listWorktrees` reads git's own record rather than ours, so the UI shows what
 * actually exists on disk rather than what we believe we created.
 */

/** Dot-prefixed so that glob-based tools skip it by default. */
export const WORKTREE_DIR = '.worktrees'

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
  /**
   * Commits on the base branch this session does not have.
   *
   * The number that makes parallel sessions honest. Six sessions branch from
   * main and all go green; you merge one, and the other five are now verified
   * against a main that no longer exists. Git will refuse a textual conflict,
   * but it has nothing to say about the case where one session renamed a
   * function another one calls — that merges cleanly and breaks.
   */
  behind: number
}

/** Branch names have real constraints; a session title does not. */
export function branchNameFor(title: string, id: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')

  return slug ? `${slug}-${id}` : `session-${id}`
}

/**
 * Branches this app used to make.
 *
 * Everything was namespaced under `agents-ui/` so a session's branch could be
 * recognised on sight. It also made every branch read as belonging to the tool
 * rather than to the work, in a repository where they are ordinary branches
 * you push and open pull requests from — so new ones are named plainly.
 *
 * Kept only for recognising what is already on disk. Nothing new matches it.
 */
export const LEGACY_BRANCH_PREFIX = 'agents-ui/'

/**
 * Whether a worktree is one this app made.
 *
 * This used to be answered by the branch prefix, which was doing real work:
 * it is what stops `prune` — which deletes branches with `-D` — from touching
 * a worktree somebody set up by hand. Without the prefix the question needs a
 * different answer, and location is a better one than naming ever was. These
 * live in `<repo>/.worktrees/` because that is where this app puts them, and
 * unlike a name that cannot be quietly invalidated by renaming a branch.
 *
 * The legacy prefix still counts, so worktrees made before this keep being
 * recognised rather than becoming invisible to cleanup and recovery.
 */
export function looksLikeSessionWorktree(
  canonicalWorktreeRoot: string,
  entry: { canonical: string; branch?: string | null },
): boolean {
  const root = canonicalWorktreeRoot.endsWith(sep)
    ? canonicalWorktreeRoot
    : `${canonicalWorktreeRoot}${sep}`

  // Prefix match on a separator-terminated root, so a sibling directory named
  // `.worktrees-old` is never mistaken for something inside `.worktrees`.
  return entry.canonical.startsWith(root)
    || entry.branch?.startsWith(LEGACY_BRANCH_PREFIX) === true
}

/** Inside the repository, so a session's work sits next to the project it belongs to. */
export function worktreeRootFor(repoDir: string): string {
  return join(repoDir, WORKTREE_DIR)
}

/**
 * Hide the worktree directory from git without touching a tracked file.
 *
 * `.git/info/exclude` is per-clone and never committed, so this cannot show up
 * in someone's diff or conflict with a shared `.gitignore`. It does more than
 * quieten `git status`: with the entry present, `git add .` no longer stages
 * the nested worktree as an embedded repository, which is the one way in-repo
 * worktrees could otherwise damage a commit.
 */
export async function excludeWorktreeDir(repoDir: string): Promise<void> {
  const gitDir = await git(repoDir, ['rev-parse', '--git-common-dir']).catch(() => '')
  if (!gitDir) return

  const path = join(isAbsolute(gitDir) ? gitDir : join(repoDir, gitDir), 'info', 'exclude')
  const existing = await readFile(path, 'utf-8').catch(() => '')
  if (existing.split('\n').some(line => line.trim() === `${WORKTREE_DIR}/`)) return

  await mkdir(dirname(path), { recursive: true })
  const prefix = existing && !existing.endsWith('\n') ? '\n' : ''
  await appendFile(
    path,
    `${prefix}\n# Session workspaces created by agents-ui\n${WORKTREE_DIR}/\n`,
    'utf-8',
  )
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

/**
 * Whether this repository has anything to branch from.
 *
 * A freshly `git init`ed directory is a real repository with no commits, and
 * `HEAD` does not resolve in one. Every path here assumed otherwise: the branch
 * lookup fell back to the literal string "HEAD", which was then handed to
 * `git worktree add` as a starting point and came back as "fatal: not a valid
 * object name: 'HEAD'" — true, unhelpful, and nothing to do with what the
 * person actually needed to hear.
 */
export async function hasCommits(repoDir: string): Promise<boolean> {
  try {
    await git(repoDir, ['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

/**
 * Compare paths by their resolved form. Git reports worktree paths with
 * symlinks already resolved, so comparing them to a path we composed ourselves
 * fails on any machine where part of the path is a symlink — and a session that
 * fails to match its worktree is reported as abandoned when it is running fine.
 */
export async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    // Not on disk (a pruned worktree, say) — the raw path is the best we have.
    return path
  }
}

/** The commit a branch actually diverged from, rather than an assumed base. */
export async function mergeBase(repoDir: string, a: string, b: string): Promise<string> {
  return git(repoDir, ['merge-base', a, b]).catch(() => '')
}

/** Commits on `branch` that exist nowhere else — what deleting it would destroy. */
export async function unmergedCommits(repoDir: string, branch: string): Promise<number> {
  const base = await mergeBase(repoDir, 'HEAD', branch)
  if (!base) return 0
  const count = await git(repoDir, ['rev-list', '--count', `${base}..${branch}`]).catch(() => '0')
  return Number(count) || 0
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

  // Before the directory exists, so git never sees it as untracked content.
  await excludeWorktreeDir(repoDir)

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
 * Check out a branch that already exists, rather than cutting a new one.
 *
 * The other half of starting work: a session usually begins from nothing, but
 * plenty of work begins from something — a colleague's branch, a pull request,
 * a branch whose checks are failing. Those need the branch git already has,
 * not a new one named after it.
 */
export async function createWorktreeOn(options: {
  repoDir: string
  path: string
  branch: string
  remote?: string | null
}): Promise<{ path: string; branch: string; baseSha: string }> {
  const { repoDir, path, branch, remote } = options

  await excludeWorktreeDir(repoDir)

  if (existsSync(path)) {
    throw createError({
      statusCode: 409,
      data: { error: 'worktree_exists', message: `A worktree already exists at ${path}` },
    })
  }

  const hasLocal = await git(repoDir, ['rev-parse', '--verify', `refs/heads/${branch}`])
    .then(() => true)
    .catch(() => false)

  // A branch that only exists on the remote has to be fetched before anything
  // can be checked out from it.
  if (!hasLocal && remote) {
    await git(repoDir, ['fetch', remote, branch], 120_000).catch(() => {})
  }

  if (!hasLocal) {
    // Neither here nor on the remote after fetching: almost always a typo, and
    // git's answer to that is a sentence about upstream branches.
    const onRemote = remote
      ? await git(repoDir, ['rev-parse', '--verify', `refs/remotes/${remote}/${branch}`])
        .then(() => true)
        .catch(() => false)
      : false

    if (!onRemote) {
      throw createError({
        statusCode: 404,
        data: {
          error: 'no_such_branch',
          message: `There is no branch called \`${branch}\` here${remote ? ` or on ${remote}` : ''}.`,
        },
      })
    }
  }

  const args = hasLocal
    ? ['worktree', 'add', path, branch]
    // Creates the local branch tracking the remote one, which is what you want
    // when continuing somebody else's work.
    : ['worktree', 'add', '--track', '-b', branch, path, `${remote ?? 'origin'}/${branch}`]

  try {
    await git(repoDir, args, 180_000)
  } catch (e: any) {
    const stderr = String(e.stderr ?? '').trim()

    // The most common failure by far, and git's own wording is unhelpful about
    // what to do next.
    if (/already (checked out|used by worktree)/i.test(stderr)) {
      throw createError({
        statusCode: 409,
        data: {
          error: 'branch_in_use',
          message: `\`${branch}\` is already checked out somewhere else. A branch can only be in one working copy at a time — switch that one away, or close the session using it.`,
        },
      })
    }

    throw createError({
      statusCode: 500,
      data: {
        error: 'worktree_failed',
        message: `Could not check out ${branch}: ${stderr || e.message}`,
      },
    })
  }

  const baseSha = await git(repoDir, ['rev-parse', branch]).catch(() => '')
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

export interface UpdateFromBaseResult {
  status: 'updated' | 'already-current' | 'conflicted' | 'refused'
  /** What happened, in words worth showing someone. */
  message: string
}

/**
 * Bring the base branch into a session's workspace.
 *
 * The other half of knowing a session is behind. Merging one session moves the
 * base under all the others, and a green check taken before that move is a
 * claim about code that is no longer what would land. This is how a session
 * catches up so its checks can mean something again.
 *
 * A merge rather than a rebase, deliberately. Rebasing rewrites commits the
 * person may already have pushed or opened a pull request from, and a merge
 * commit in a branch that exists to be merged costs nothing.
 */
export async function updateFromBase(
  worktreePath: string,
  baseBranch: string,
): Promise<UpdateFromBaseResult> {
  if (!existsSync(worktreePath)) {
    return { status: 'refused', message: 'This session\'s workspace is no longer on disk.' }
  }

  const behind = Number(
    await git(worktreePath, ['rev-list', '--count', `HEAD..${baseBranch}`]).catch(() => '0')
  ) || 0

  if (!behind) {
    return { status: 'already-current', message: `Already up to date with ${baseBranch}.` }
  }

  // Uncommitted work would be caught up in the merge, and a conflict on top of
  // it is a mess nobody asked for. Said plainly rather than attempted.
  const porcelain = await git(worktreePath, ['status', '--porcelain']).catch(() => '')
  if (porcelain.trim()) {
    return {
      status: 'refused',
      message: 'There are uncommitted changes here. Commit them first, then bring the base in.',
    }
  }

  try {
    await git(worktreePath, ['merge', '--no-edit', baseBranch], 120_000)
    return {
      status: 'updated',
      message: `Brought in ${behind} commit${behind === 1 ? '' : 's'} from ${baseBranch}.`,
    }
  } catch (e: any) {
    const output = `${e.stdout ?? ''}${e.stderr ?? ''}`

    if (/conflict/i.test(output)) {
      // Left in place on purpose: the conflict is the session's to resolve, and
      // it now has both sides of it in the workspace to work with.
      return {
        status: 'conflicted',
        message: `${baseBranch} conflicts with this session's work. The conflict is in the workspace — ask the session to resolve it.`,
      }
    }

    await git(worktreePath, ['merge', '--abort']).catch(() => {})
    return { status: 'refused', message: output.trim().split('\n').at(-1) || 'The merge did not go through.' }
  }
}

/**
 * `baseRef` is what this session branched from — usually the sha, so the diff
 * is against the code as it was. `baseBranch` is where that branch has got to
 * since, which is a different question and the only one that can tell you a
 * green check has gone out of date. Passing the sha for both would always
 * report zero, because a sha does not move.
 */
export async function worktreeStatus(
  worktreePath: string,
  baseRef: string,
  baseBranch?: string,
): Promise<WorktreeStatus> {
  if (!existsSync(worktreePath)) {
    return { path: worktreePath, exists: false, branch: null, changedFiles: 0, dirty: false, ahead: 0, behind: 0 }
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

  // Zero when there is no branch to ask about, which is honest: without one
  // there is nothing this session could be out of date with respect to.
  const behind = baseBranch
    ? Number(
        await git(worktreePath, ['rev-list', '--count', `HEAD..${baseBranch}`]).catch(() => '0')
      ) || 0
    : 0

  return {
    path: worktreePath,
    exists: true,
    branch: branch === 'HEAD' ? null : branch,
    changedFiles: new Set([...committed, ...uncommitted]).size,
    dirty,
    ahead,
    behind,
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
