import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, sep } from 'node:path'
import { promisify } from 'node:util'
import { checkoutDrifted } from '~/utils/checkout'

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
  /**
   * Which files those are.
   *
   * Computed here already — the count below is this set's size — and thrown away
   * until something wanted to compare two sessions. Two sessions editing the
   * same file is knowable for nothing, and was not knowable at all: `behind`
   * catches a session whose base has moved, and nothing caught the case where
   * the base has not moved yet because the other session has not merged.
   *
   * Not sent to the browser. Twenty sessions with two hundred changed files each
   * is a poll response nobody needs; the comparison happens on the server and
   * only its result travels. See `overlap.ts`.
   */
  changedPaths: string[]
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

/**
 * What a session's work should be measured against.
 *
 * `baseSha` is where the branch was cut, and it is the right answer only until
 * the session catches up with its base. `updateFromBase` merges the base branch
 * in, and from that moment `baseSha..HEAD` carries every commit that came along
 * for the ride — so the diff shows somebody else's fifty files, the "ahead"
 * count is their commits plus yours, and the pull request body lists both.
 *
 * Naming the base *branch* instead fixes all three at once: `branch...HEAD`
 * re-derives the merge base each time, so it moves forward exactly when the
 * base is merged in and stays put when it is not. The branch is whatever this
 * session was cut from — routinely not `main`, and on stacked work it is
 * another session's branch.
 *
 * The recorded sha wins in the two cases where the branch would lie:
 *
 *   - It is not an ancestor of the base branch. A session started on an
 *     existing branch or a pull request records that branch's head as its base
 *     precisely so the diff excludes what the branch already had; the merge
 *     base with `main` is far behind it. A force-pushed or rewritten base lands
 *     here too.
 *   - The base branch *is* the session's branch, which is what a session
 *     adopted from the checkout it was started in looks like. That base moves
 *     with HEAD, so measuring against it reports no work, forever.
 */
export async function diffBase(session: {
  worktreePath: string
  branch: string
  baseBranch: string
  baseSha: string
  /**
   * What the worktree is really on, when the caller has already read it.
   *
   * Absent means "not asked", which keeps every existing caller's behaviour
   * exactly as it was. See the drift case below.
   */
  checkedOut?: string | null
  /** Made detached on purpose, so a record naming another branch is correct. */
  detached?: boolean
}): Promise<string> {
  const { worktreePath, branch, baseBranch, baseSha, checkedOut, detached } = session

  /*
   * A checkout that has wandered off the branch on record is not measurable
   * against the base that record names. The base described a lineage HEAD is no
   * longer on, so `baseBranch...HEAD` resolves to whatever the two happen to
   * share — four months back, on the sessions this was found on, which is how a
   * review session came to report 2,231 changed files and 214 commits ahead.
   *
   * The default branch is the one base that still means something about a branch
   * we know nothing else about. It reported 7 files and 2 commits for the same
   * session.
   *
   * A better answer exists and is deliberately not taken here: the pull request's
   * own base, which `branchPullRequest` already knows. It is a fact from GitHub,
   * this function is called from a polled path, and a stacked branch measured
   * against the trunk over-reports by its own stack rather than by a season. That
   * refinement belongs where the network already lives, not here.
   */
  if (checkoutDrifted({ recorded: branch, actual: checkedOut, detached })) {
    const trunk = await defaultBranchRef(worktreePath)
    // Unknown leaves everything as it was: a guessed trunk that is wrong
    // produces exactly the enormous diff this is here to avoid.
    if (trunk) return trunk
  }

  if (!baseBranch || baseBranch === branch) return baseSha || baseBranch || 'HEAD'
  if (!baseSha) return baseBranch

  try {
    // Exits zero for "yes" and for "same commit"; non-zero for both "no" and
    // "that branch is gone", which want the same fallback.
    await git(worktreePath, ['merge-base', '--is-ancestor', baseSha, baseBranch])
    return baseBranch
  } catch {
    return baseSha
  }
}

/**
 * Fetch one branch from a remote and say which commit came back.
 *
 * `FETCH_HEAD` rather than the remote-tracking ref, because a bare
 * `git fetch <remote> <branch>` is not obliged to update `refs/remotes/` and
 * quietly returning the commit from last week would be worse than failing.
 * Empty when the fetch did not work — no network, no such branch — which every
 * caller here can carry on from.
 */
export async function fetchRemoteBranchHead(
  cwd: string,
  remote: string,
  branch: string,
): Promise<string> {
  try {
    await git(cwd, ['fetch', remote, branch], 120_000)
  } catch {
    return ''
  }
  return resolveRef(cwd, 'FETCH_HEAD')
}

/** A ref's commit, or empty when this repository has never heard of it. */
export async function resolveRef(dir: string, ref: string): Promise<string> {
  return git(dir, ['rev-parse', '--verify', `${ref}^{commit}`]).catch(() => '')
}

/** Uncommitted work sitting in a workspace — untracked files included. */
export async function isWorktreeDirty(path: string): Promise<boolean> {
  if (!existsSync(path)) return false
  const porcelain = await git(path, ['status', '--porcelain']).catch(() => '')
  return porcelain.trim().length > 0
}

/**
 * Move a workspace forward to a ref, or leave it exactly as it was.
 *
 * `--ff-only` is the whole point. Taking over an abandoned workspace, or coming
 * back to one after somebody pushed to the branch, wants the new commits — but
 * only if arriving at them costs nothing. Anything that would need a merge, a
 * conflict resolution, or a decision about uncommitted work is not something to
 * do on the way to starting a session; git refuses and the workspace is
 * untouched, which is the right outcome to report rather than to fix.
 */
export async function fastForward(path: string, ref: string): Promise<boolean> {
  if (!ref) return false
  const before = await resolveRef(path, 'HEAD')
  try {
    await git(path, ['merge', '--ff-only', ref], 60_000)
  } catch {
    return false
  }
  return (await resolveRef(path, 'HEAD')) !== before
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

/**
 * What this repository considers its trunk, as git knows it.
 *
 * Only ever needed for a checkout that has drifted off the branch on record: the
 * recorded base then describes a lineage HEAD is not on, and the merge base
 * between them can be months back. This is the one base that is always
 * meaningful for a branch we know nothing else about.
 *
 * `refs/remotes/origin/HEAD` is the authoritative answer and nothing here
 * guesses past it — no falling back to a local `main` or `master`, because a
 * guess that is wrong produces exactly the enormous diff this exists to avoid.
 * An empty string means "unknown", and the caller keeps what it had.
 */
export async function defaultBranchRef(cwd: string): Promise<string> {
  const ref = await git(cwd, ['symbolic-ref', 'refs/remotes/origin/HEAD']).catch(() => '')
  if (!ref.startsWith('refs/remotes/')) return ''
  return ref.slice('refs/remotes/'.length)
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

    // The backstop, not the usual path: callers are expected to ask
    // `findBranchHolder` first and offer the workspace that already has it.
    // Reaching here means the holder appeared in between, so the one thing
    // worth adding to git's wording is where it went.
    if (/already (checked out|used by worktree)/i.test(stderr)) {
      const held = (await listWorktrees(repoDir)).find(w => w.branch === branch)
      throw createError({
        statusCode: 409,
        data: {
          error: 'branch_in_use',
          message: `\`${branch}\` is already checked out${held ? ` in ${held.path}` : ' somewhere else'}. `
            + 'A branch can only be in one working copy at a time — switch that one away, or close the session using it.',
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
 * Check out a commit without taking the branch that points at it.
 *
 * The rule that makes this necessary: a branch can be checked out in exactly
 * one working copy, and git is right about that — two worktrees moving one ref
 * is a corruption waiting to happen. A *commit* has no such constraint. It can
 * be checked out in as many worktrees as you like, because nothing about a
 * detached HEAD is shared.
 *
 * Which is the whole answer for reading somebody's work. A review does not
 * commit, does not push, and does not need a branch — it needed one only
 * because checking out by name was the only way this app knew. Paying a branch
 * for it cost twice: reviewing the same pull request a second time failed with
 * "already checked out somewhere else", and a review taken while a session was
 * fixing that same branch could not happen at all.
 *
 * The commit is named explicitly rather than resolved from the branch here, so
 * a review is of a sha somebody can quote back — not of "whatever the branch
 * said when the worktree was cut".
 */
export async function createDetachedWorktree(options: {
  repoDir: string
  path: string
  commit: string
}): Promise<{ path: string; head: string }> {
  const { repoDir, path, commit } = options

  await excludeWorktreeDir(repoDir)

  if (existsSync(path)) {
    throw createError({
      statusCode: 409,
      data: { error: 'worktree_exists', message: `A worktree already exists at ${path}` },
    })
  }

  try {
    await git(repoDir, ['worktree', 'add', '--detach', path, commit], 180_000)
  } catch (e: any) {
    const stderr = String(e.stderr ?? '').trim()
    throw createError({
      statusCode: 500,
      data: {
        error: 'worktree_failed',
        message: `Could not check out ${commit.slice(0, 12)}: ${stderr || e.message}`,
      },
    })
  }

  const head = await git(path, ['rev-parse', 'HEAD']).catch(() => commit)
  return { path, head }
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
 * The branch name out of `git status --branch --porcelain`'s header line.
 *
 * Asking `status` for the branch as well saves a `rev-parse` per worktree, and
 * a spawn per worktree is worth having when this is asked about every session
 * at once. The header has four shapes and three of them are edge cases:
 *
 *   `## main...origin/main [ahead 1]`  tracking a remote
 *   `## some-branch`                   no upstream, which sessions never have
 *   `## HEAD (no branch)`              detached, so there is no branch to name
 *   `## No commits yet on main`        a fresh repository, branch not yet real
 *
 * Returns null for detached, matching what `rev-parse` reported as "HEAD".
 */
export function parseStatusBranch(header: string): string | null {
  const line = header.startsWith('## ') ? header.slice(3) : header
  if (!line || line.startsWith('HEAD (no branch)')) return null

  const fresh = /^No commits yet on (.+)$/.exec(line)
  const name = fresh ? fresh[1]! : line.split('...')[0]!.replace(/ \[.*$/, '')

  return name === 'HEAD' ? null : name.trim() || null
}

/**
 * `baseRef` is what this session's work is measured from — `diffBase` works it
 * out, and it is the base branch wherever naming the branch is safe, so a
 * session that has merged its base in is not counted as ahead by its base's
 * commits. `baseBranch` is where that branch has got to since, which is a
 * different question and the only one that can tell you a green check has gone
 * out of date. Passing the sha for both would always report zero, because a sha
 * does not move.
 *
 * The four questions are asked concurrently, and the caller is expected to
 * bound how many worktrees it asks about at once — see `mapLimit`. Firing every
 * session's git at the process table simultaneously is what took the app down.
 */
export async function worktreeStatus(
  worktreePath: string,
  baseRef: string,
  baseBranch?: string,
): Promise<WorktreeStatus> {
  if (!existsSync(worktreePath)) {
    return {
      path: worktreePath,
      exists: false,
      branch: null,
      changedFiles: 0,
      changedPaths: [],
      dirty: false,
      ahead: 0,
      behind: 0,
    }
  }

  const count = (range: string) =>
    git(worktreePath, ['rev-list', '--count', range])
      .then(out => Number(out) || 0)
      .catch(() => 0)

  const [status, nameOnly, ahead, behind] = await Promise.all([
    git(worktreePath, ['status', '--porcelain', '--branch']).catch(() => ''),
    git(worktreePath, ['diff', '--name-only', `${baseRef}...HEAD`]).catch(() => ''),
    count(`${baseRef}..HEAD`),
    // Zero when there is no branch to ask about, which is honest: without one
    // there is nothing this session could be out of date with respect to.
    baseBranch ? count(`HEAD..${baseBranch}`) : Promise.resolve(0),
  ])

  // `--branch` prepends a `## ` header, so it is not part of the file list and
  // must not be counted as a change — with it included, every worktree read as
  // dirty and every clean session claimed one changed file.
  const lines = status.split('\n').filter(Boolean)
  const header = lines[0]?.startsWith('## ') ? lines[0]! : ''
  const entries = header ? lines.slice(1) : lines

  const committed = nameOnly ? nameOnly.split('\n').filter(Boolean) : []
  const uncommitted = entries.map(l => l.slice(3).trim())

  const changed = new Set([...committed, ...uncommitted])

  return {
    path: worktreePath,
    exists: true,
    branch: header ? parseStatusBranch(header) : await currentBranch(worktreePath).then(b => (b === 'HEAD' ? null : b)),
    changedFiles: changed.size,
    changedPaths: [...changed],
    dirty: entries.length > 0,
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
