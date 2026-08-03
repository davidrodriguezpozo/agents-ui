import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Session } from './sessions'

const exec = promisify(execFile)

/**
 * Bringing a session's work back into the repository.
 *
 * The dangerous part is that this touches the user's actual checkout, so every
 * precondition is checked before anything is written, and a merge that goes
 * wrong is aborted rather than left half-applied.
 */

export interface MergePreview {
  canMerge: boolean
  /** Why not, in words a person can act on. */
  blockedReason?: string
  targetBranch: string
  currentBranch: string
  repoClean: boolean
  commits: number
  /** Files changed but never committed — these will not come across. */
  uncommittedFiles: string[]
  conflicts: string[]
}

async function git(cwd: string, args: string[], timeout = 30_000) {
  return exec('git', args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 })
}

async function tryGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await git(cwd, args)
    return stdout.trim()
  } catch {
    return ''
  }
}

/**
 * `git merge-tree --write-tree` performs the merge in memory and exits non-zero
 * when it conflicts, so conflicts can be reported without touching the working
 * tree. Requires git 2.38+; older git reports as "unknown" rather than lying.
 */
export function parseMergeTreeConflicts(stdout: string): string[] {
  // Output is: tree OID, then conflicted paths, then a blank line, then
  // human-readable messages. Without respecting that separator the messages
  // get counted as files, so one conflict reports as two.
  const [header = ''] = stdout.split(/\n[ \t]*\n/)
  const lines = header.split('\n').map(l => l.trim()).filter(Boolean)

  return lines
    .slice(1)
    .filter(line => !/^(Auto-merging|CONFLICT|warning:|hint:)/.test(line))
}

export async function previewMerge(session: Session): Promise<MergePreview> {
  const { repoDir, branch, baseBranch, worktreePath } = session

  const currentBranch = await tryGit(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const status = await tryGit(repoDir, ['status', '--porcelain'])
  const repoClean = status.length === 0

  const commitList = await tryGit(repoDir, ['rev-list', '--count', `${baseBranch}..${branch}`])
  const commits = Number(commitList) || 0

  const uncommittedFiles = (await tryGit(worktreePath, ['status', '--porcelain']))
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3).trim())

  let conflicts: string[] = []
  try {
    await git(repoDir, ['merge-tree', '--write-tree', '--name-only', baseBranch, branch])
  } catch (e: any) {
    // Non-zero exit means conflicts; stdout still carries the detail.
    conflicts = parseMergeTreeConflicts(e.stdout ?? '')
  }

  const preview: MergePreview = {
    canMerge: false,
    targetBranch: baseBranch,
    currentBranch,
    repoClean,
    commits,
    uncommittedFiles,
    conflicts,
  }

  if (!commits) {
    preview.blockedReason = 'This session has not committed anything yet, so there is nothing to merge.'
  } else if (!repoClean) {
    preview.blockedReason = `Your ${currentBranch} checkout has uncommitted changes. Commit or stash them first — merging into a dirty checkout is how work gets lost.`
  } else if (currentBranch !== baseBranch) {
    preview.blockedReason = `Your checkout is on ${currentBranch}, but this session branched from ${baseBranch}. Switch to ${baseBranch} first.`
  } else if (conflicts.length) {
    preview.blockedReason = `${conflicts.length} file${conflicts.length === 1 ? '' : 's'} would conflict. Resolve them in the session before merging.`
  } else {
    preview.canMerge = true
  }

  return preview
}

export interface MergeResult {
  merged: boolean
  commitsBrought: number
  message?: string
}

/** Commit whatever the agent left uncommitted, so it is not silently dropped. */
export async function commitSessionWork(session: Session, message: string): Promise<number> {
  const status = await tryGit(session.worktreePath, ['status', '--porcelain'])
  if (!status) return 0

  await git(session.worktreePath, ['add', '-A'])
  await git(session.worktreePath, ['commit', '-m', message])
  return status.split('\n').filter(Boolean).length
}

export async function mergeSession(session: Session, opts: { message?: string } = {}): Promise<MergeResult> {
  const preview = await previewMerge(session)
  if (!preview.canMerge) {
    throw createError({
      statusCode: 409,
      data: { error: 'merge_blocked', message: preview.blockedReason ?? 'This session cannot be merged.' },
    })
  }

  const message = opts.message?.trim() || `Merge session: ${session.title}`

  try {
    // --no-ff keeps the session visible as a unit in history rather than
    // silently replaying its commits onto the base.
    await git(session.repoDir, ['merge', '--no-ff', session.branch, '-m', message], 120_000)
  } catch (e: any) {
    // Never leave the checkout mid-merge.
    await tryGit(session.repoDir, ['merge', '--abort'])
    throw createError({
      statusCode: 500,
      data: {
        error: 'merge_failed',
        message: `The merge failed and was rolled back: ${e.stderr?.trim() || e.message}`,
      },
    })
  }

  return { merged: true, commitsBrought: preview.commits, message }
}
