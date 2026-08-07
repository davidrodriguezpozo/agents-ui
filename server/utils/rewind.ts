import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * Putting a workspace back.
 *
 * A session's workspace is a git worktree, which means undo already exists and
 * only needed exposing: there is no checkpointing system here, no shadow copy,
 * nothing to keep in sync. Two questions people actually ask — "throw away what
 * it just did to my files" and "that whole turn was wrong" — are `restore` and
 * `reset`, with guards.
 *
 * It matters more since files became editable by hand. An agent's work was
 * always recoverable by simply not merging it; a change you made yourself, on
 * top of a turn you now want gone, was not.
 *
 * **The guard is `baseSha`.** A rewind must never pass the commit the session
 * branched from. Below that lies the rest of the repository's history, which
 * this session does not own and must not be able to destroy from a web page —
 * so every reset target is checked to be a descendant of the base, and refused
 * otherwise rather than clamped to something plausible.
 */

/**
 * Trailing whitespace only. A plain `trim()` eats the *leading* space of a
 * `status --porcelain` line — ` M file` becomes `M file` — which shifts the
 * path by one character on the first line and no others.
 */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })
  return stdout.replace(/\s+$/, '')
}

export interface RewindCommit {
  sha: string
  subject: string
}

export interface RewindPreview {
  /** Tracked files changed since the last commit — a discard loses these. */
  changed: string[]
  /** Untracked, not ignored. A discard deletes these; ignored files survive. */
  untracked: string[]
  /** This session's own commits, newest first. Never includes the base. */
  commits: RewindCommit[]
  /** Whether there is anything uncommitted to throw away. */
  canDiscard: boolean
  /** Whether there is a commit of ours to undo. False at the base. */
  canUndoCommit: boolean
  /** Set when the workspace is not usable at all. */
  unavailable?: string
}

interface SessionLike {
  worktreePath: string
  baseSha: string
}

/**
 * What a rewind would cost, named before it happens.
 *
 * "Discard 3 files" is a number somebody has to trust; the files themselves are
 * something they can check. Same for the commit — its subject is how anybody
 * recognises the turn they are about to undo.
 */
export async function previewRewind(session: SessionLike): Promise<RewindPreview> {
  const empty: RewindPreview = {
    changed: [], untracked: [], commits: [], canDiscard: false, canUndoCommit: false,
  }

  if (!existsSync(session.worktreePath)) {
    return { ...empty, unavailable: 'This session has no workspace on disk any more.' }
  }

  try {
    const porcelain = await git(session.worktreePath, ['status', '--porcelain'])

    const changed: string[] = []
    const untracked: string[] = []
    for (const line of porcelain.split('\n').filter(Boolean)) {
      // `XY path`, where either status character may be a space. Matched rather
      // than sliced so a malformed line is skipped instead of contributing a
      // mangled filename to something that then deletes files.
      const match = /^(..) (.*)$/.exec(line)
      if (!match) continue

      const [, status, path] = match
      if (status === '??') untracked.push(path!)
      else changed.push(path!)
    }

    // Only this session's commits: everything from the base to HEAD, which is
    // exactly the set a rewind is allowed to touch.
    const log = session.baseSha
      ? await git(session.worktreePath, ['log', '--format=%H%x00%s', `${session.baseSha}..HEAD`])
      : ''

    const commits = log.split('\n').filter(Boolean).map((line) => {
      const [sha, subject] = line.split('\0')
      return { sha: sha ?? '', subject: subject ?? '(no message)' }
    })

    return {
      changed,
      untracked,
      commits,
      canDiscard: changed.length > 0 || untracked.length > 0,
      canUndoCommit: commits.length > 0,
    }
  } catch (e) {
    return { ...empty, unavailable: (e as Error).message }
  }
}

export type RewindTarget = 'uncommitted' | 'commit'

export interface RewindResult {
  done: boolean
  /** What happened, in a sentence worth showing. */
  message: string
}

/**
 * Whether `sha` has `base` in its history — the check that keeps a reset inside
 * this session. `merge-base --is-ancestor` exits non-zero for "no", which is a
 * throw here, so a failure to answer reads as "not a descendant" and refuses.
 */
async function isDescendantOfBase(cwd: string, base: string, sha: string): Promise<boolean> {
  if (!base) return false
  if (base === sha) return true
  try {
    await git(cwd, ['merge-base', '--is-ancestor', base, sha])
    return true
  } catch {
    return false
  }
}

export async function rewind(session: SessionLike, target: RewindTarget): Promise<RewindResult> {
  const cwd = session.worktreePath
  if (!existsSync(cwd)) {
    return { done: false, message: 'This session has no workspace on disk any more.' }
  }

  const before = await previewRewind(session)
  if (before.unavailable) return { done: false, message: before.unavailable }

  if (target === 'uncommitted') {
    if (!before.canDiscard) {
      return { done: false, message: 'There is nothing uncommitted to throw away.' }
    }

    // Tracked files back to the last commit, then untracked ones removed.
    // `clean -fd` without `-x` deliberately leaves ignored files alone, so a
    // discard does not delete `node_modules` and cost a fresh setup run.
    await git(cwd, ['checkout', '--', '.'])
    await git(cwd, ['clean', '-fd'])

    /**
     * Directories are counted separately because git reports one as a single
     * entry. "Put 3 files back" is a lie when one of the three is a directory
     * holding a few thousand, which is what an un-ignored `node_modules` looks
     * like from here.
     */
    const dirs = before.untracked.filter(path => path.endsWith('/'))
    const count = before.changed.length + before.untracked.length - dirs.length

    const parts = []
    if (count) parts.push(`${count} file${count === 1 ? '' : 's'}`)
    if (dirs.length) parts.push(`${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'} (${dirs.join(', ')})`)

    return {
      done: true,
      message: `Put back ${parts.join(' and ')}, to the last commit.`,
    }
  }

  if (!before.canUndoCommit) {
    return {
      done: false,
      message: 'There is nothing of this session to undo — it is already back at the commit it branched from.',
    }
  }

  const parent = await git(cwd, ['rev-parse', 'HEAD~1']).catch(() => '')
  if (!parent) {
    return { done: false, message: 'Could not work out what came before this commit.' }
  }

  // The guard. A parent that does not descend from the base is history this
  // session does not own, and no button here may reach it.
  if (!await isDescendantOfBase(cwd, session.baseSha, parent)) {
    return {
      done: false,
      message: 'That would go back past where this session branched, which is not this session\'s to undo.',
    }
  }

  const undone = before.commits[0]!
  await git(cwd, ['reset', '--hard', parent])

  return {
    done: true,
    message: `Undid "${undone.subject}". Anything uncommitted went with it.`,
  }
}
