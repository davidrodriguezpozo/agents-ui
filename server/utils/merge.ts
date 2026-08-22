import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isStale, worktreeFingerprint, type SessionCheck } from './checks'
import { describeFlakes, flakesFor, type Flake } from './checkFlakes'
import { recordLanded } from './landed'
import type { Session } from './sessions'
import { checkoutDrifted, driftNote, reviewOnlyNote } from '~/utils/checkout'

const exec = promisify(execFile)

/**
 * Bringing a session's work back into the repository.
 *
 * The dangerous part is that this touches the user's actual checkout, so every
 * precondition is checked before anything is written, and a merge that goes
 * wrong is aborted rather than left half-applied.
 */

/**
 * Which precondition failed, for callers that must act differently per cause.
 *
 * The words in `blockedReason` are for a person; this is for the code. Landing
 * needs the difference because two of these are facts about the repository and
 * stop everything behind them, while the rest are about one session and must not.
 */
export type MergeBlocker =
  | 'no-commits'
  | 'already-landed'
  | 'dirty-base'
  | 'wrong-branch'
  /** The session's own worktree is not on the branch this merge would take. */
  | 'drifted'
  /** A review workspace: the commits on its branch belong to somebody else. */
  | 'read-only'
  | 'conflicts'
  | 'checks'

export interface MergePreview {
  canMerge: boolean
  /** Why not, in words a person can act on. */
  blockedReason?: string
  /** Why not, as something to branch on. */
  blockedBy?: MergeBlocker
  targetBranch: string
  currentBranch: string
  repoClean: boolean
  commits: number
  /** Files changed but never committed — these will not come across. */
  uncommittedFiles: string[]
  conflicts: string[]
  /** How the project's own checks last went here, if they ever have. */
  check?: SessionCheck | null
  /** The recorded verdict describes code that has since changed. */
  checkStale?: boolean
  /**
   * Failures this project has seen go both ways on identical code. Shown beside
   * the failure and nothing more — the gate is unmoved, the person is better
   * informed. Empty whenever there is nothing established to say. See
   * `checkFlakes.ts`.
   */
  flakes?: Flake[]
  /** The one line above them, when there are any. See `describeFlakes`. */
  flakeNote?: string
  /**
   * The only thing in the way is the checks. Everything git cares about is
   * fine, so this is a judgement rather than an impossibility — and a
   * judgement is something you are allowed to overrule.
   */
  blockedByChecks?: boolean
}

/**
 * Whether a verdict should stand in the way of a merge.
 *
 * Only a real failure does. A check that could not run says nothing about the
 * code — a workspace missing its dependencies is not a bug — and blocking on
 * it would train people to override by reflex, which is worse than not
 * checking at all. Checks still running block too, briefly: merging a moment
 * before the answer arrives is exactly the mistake this exists to prevent.
 */
export function checkBlocks(check: SessionCheck | null | undefined): boolean {
  return check?.status === 'failing' || check?.status === 'running'
}

function describeCheckBlock(check: SessionCheck, stale: boolean): string {
  if (check.status === 'running') {
    return `\`${check.command}\` is still running in this session's workspace. Give it a moment — merging now would be merging without the answer.`
  }
  return stale
    ? `\`${check.command}\` failed here, and the workspace has changed since. Run the checks again to see where it stands.`
    : `\`${check.command}\` failed in this session's workspace.`
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
 * Every local branch whose tip the base branch already contains.
 *
 * The question "is there anything left to merge" asked once for the whole
 * repository instead of once per session. It matters because this is wanted on
 * every sessions poll, and `rev-list` per branch turns one git call into
 * twenty-one for somebody with twenty-one sessions.
 *
 * Pointedly not `worktree.ahead`, which is counted from the commit a session
 * branched at and is frozen there — a session whose work has landed reports
 * sixteen commits ahead of where it started for the rest of its life. Only this
 * answers "is it in".
 *
 * A branch with no commits of its own is in here too, since its tip *is* the base
 * commit. So on its own this does not mean "landed"; it means "nothing of this is
 * outstanding". Callers pair it with having committed something at all.
 */
export async function mergedBranches(repoDir: string, baseBranch: string): Promise<Set<string>> {
  const out = await tryGit(repoDir, ['branch', '--format=%(refname:short)', '--merged', baseBranch])

  return new Set(out.split('\n').map(line => line.trim()).filter(Boolean))
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

export interface BaseCheckout {
  currentBranch: string
  clean: boolean
  /**
   * Set when nothing can merge here, whatever the session. Absent means git has
   * no objection to the checkout itself.
   */
  blockedReason?: string
}

/**
 * The state of the checkout everything merges *into*.
 *
 * Two of the conditions that block a merge are facts about the repository rather
 * than about a session: the checkout has uncommitted changes, or it is on the
 * wrong branch. Both refuse every session equally, and both are two `git` calls
 * to establish.
 *
 * Landing found this out per-session, and only after running that session's
 * checks — so a dirty `main` cost a full test-suite run before anything said the
 * word "uncommitted", and then said it four more times. Asking here first is the
 * difference between a refusal you are told about and one you pay for.
 */
export async function baseCheckoutState(repoDir: string, baseBranch: string): Promise<BaseCheckout> {
  const currentBranch = await tryGit(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const clean = (await tryGit(repoDir, ['status', '--porcelain'])).length === 0

  if (!clean) {
    return {
      currentBranch,
      clean,
      blockedReason: `Your ${currentBranch} checkout has uncommitted changes. Commit or stash them first — merging into a dirty checkout is how work gets lost.`,
    }
  }
  if (currentBranch !== baseBranch) {
    return {
      currentBranch,
      clean,
      blockedReason: `Your checkout is on ${currentBranch}, but these sessions branched from ${baseBranch}. Switch to ${baseBranch} first.`,
    }
  }

  return { currentBranch, clean }
}

/**
 * The branch a session's worktree is really on, when that is not its own.
 *
 * Asked of the worktree, not the repository — `baseCheckoutState` answers the
 * same-sounding question about the *main* checkout, and the two were both being
 * called "the current branch".
 *
 * One `git` invocation, exported because two write paths need it before they act
 * rather than after: committing a session's leftovers commits them onto whatever
 * is checked out, and finding out afterwards that the merge is refused is a
 * commit on somebody else's branch that nobody asked for.
 */
export async function driftedCheckout(session: Session): Promise<string | null> {
  const checkedOut = await tryGit(session.worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'])

  return checkoutDrifted({
    recorded: session.branch,
    actual: checkedOut,
    detached: session.detached,
  })
    ? checkedOut
    : null
}

/**
 * Everything that must be refused before a single byte is written.
 *
 * Both of these are about the same disagreement between a record and a workspace,
 * and they are opposite mistakes about it: a drifted session's work is somewhere
 * other than the branch on record, and a review session's branch is somebody
 * else's work entirely. Neither can be discovered from the commit count — a
 * drifted session's is zero, and a review session's is healthy and not ours.
 *
 * Asked as one question so the two write paths cannot end up checking one and
 * not the other, and asked *early* because both of them commit the session's
 * leftovers first: in a review workspace that is a commit on a colleague's
 * branch, made on the way to a refusal.
 */
export async function mergeRefusal(
  session: Session,
): Promise<{ blockedBy: MergeBlocker; reason: string } | null> {
  const drifted = await driftedCheckout(session)
  if (drifted) return { blockedBy: 'drifted', reason: driftNote(session.branch, drifted) }

  // Never drift — its record is right, which is why this has to be asked on its
  // own. See `reviewOnlyNote`.
  if (session.detached) return { blockedBy: 'read-only', reason: reviewOnlyNote(session.branch) }

  return null
}

export async function previewMerge(session: Session): Promise<MergePreview> {
  const { repoDir, branch, baseBranch, worktreePath } = session

  // The same two questions as `baseCheckoutState`, asked through it so the
  // wording of a refusal cannot drift between the two places that report it.
  const base = await baseCheckoutState(repoDir, baseBranch)
  const currentBranch = base.currentBranch
  const repoClean = base.clean

  const commitList = await tryGit(repoDir, ['rev-list', '--count', `${baseBranch}..${branch}`])
  const commits = Number(commitList) || 0

  const uncommittedFiles = (await tryGit(worktreePath, ['status', '--porcelain']))
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3).trim())

  const refusal = await mergeRefusal(session)

  let conflicts: string[] = []
  try {
    await git(repoDir, ['merge-tree', '--write-tree', '--name-only', baseBranch, branch])
  } catch (e: any) {
    // Non-zero exit means conflicts; stdout still carries the detail.
    conflicts = parseMergeTreeConflicts(e.stdout ?? '')
  }

  const check = session.check ?? null
  const checkStale = isStale(session.check, await worktreeFingerprint(worktreePath))
  const flakes = await flakesFor(repoDir, check)

  const preview: MergePreview = {
    canMerge: false,
    targetBranch: baseBranch,
    currentBranch,
    repoClean,
    commits,
    uncommittedFiles,
    conflicts,
    check,
    checkStale,
    flakes,
    ...(flakes.length ? { flakeNote: describeFlakes(flakes) } : {}),
  }

  if (refusal) {
    /*
     * Both of `mergeRefusal`'s cases are checked before the commit count, and
     * that ordering is the whole point.
     *
     * A drifted session has never committed to the branch on record, so
     * `baseBranch..branch` is zero and the refusal below would say "this session
     * has not committed anything yet" over a worktree holding real work — the
     * mistake that comment warns about, one case further along. A review session
     * is the opposite: its count is healthy, and every commit in it belongs to
     * the person whose pull request it is, so the preview would offer to merge
     * their branch into your base.
     *
     * Refused rather than redirected in both cases. Merging whatever is checked
     * out instead would be a guess with somebody else's work in it.
     */
    preview.blockedBy = refusal.blockedBy
    preview.blockedReason = refusal.reason
  } else if (!commits) {
    /**
     * No commits the base does not already have. Two very different reasons, and
     * saying the wrong one is actively misleading: a session showing "16 ahead"
     * told that it "has not committed anything" reads as a bug in the app, when
     * what happened is that its work landed earlier and `ahead` is counted from
     * where it branched rather than from the base as it stands.
     */
    const everCommitted = session.baseSha
      ? (await tryGit(repoDir, ['rev-list', '--count', `${session.baseSha}..${branch}`])) !== '0'
      : false

    preview.blockedBy = everCommitted ? 'already-landed' : 'no-commits'
    preview.blockedReason = everCommitted
      ? `Everything in this session is already in ${baseBranch} — it landed earlier.`
      : 'This session has not committed anything yet, so there is nothing to merge.'
  } else if (!repoClean) {
    preview.blockedBy = 'dirty-base'
    preview.blockedReason = `Your ${currentBranch} checkout has uncommitted changes. Commit or stash them first — merging into a dirty checkout is how work gets lost.`
  } else if (currentBranch !== baseBranch) {
    preview.blockedBy = 'wrong-branch'
    preview.blockedReason = `Your checkout is on ${currentBranch}, but this session branched from ${baseBranch}. Switch to ${baseBranch} first.`
  } else if (conflicts.length) {
    preview.blockedBy = 'conflicts'
    preview.blockedReason = `${conflicts.length} file${conflicts.length === 1 ? '' : 's'} would conflict. Resolve them in the session before merging.`
  } else if (checkBlocks(check)) {
    preview.blockedBy = 'checks'
    // Evaluated last on purpose: reaching here means git has no objection, so
    // the checks are the only thing standing in the way — which is what makes
    // overriding them safe to offer at all.
    preview.blockedByChecks = true
    preview.blockedReason = describeCheckBlock(check!, checkStale)
  } else {
    preview.canMerge = true
  }

  return preview
}

export interface MergeResult {
  merged: boolean
  commitsBrought: number
  message?: string
  /** This merge went ahead over a failing check. */
  overrodeChecks?: boolean
}

/** Commit whatever the agent left uncommitted, so it is not silently dropped. */
export async function commitSessionWork(session: Session, message: string): Promise<number> {
  const status = await tryGit(session.worktreePath, ['status', '--porcelain'])
  if (!status) return 0

  await git(session.worktreePath, ['add', '-A'])
  await git(session.worktreePath, ['commit', '-m', message])
  return status.split('\n').filter(Boolean).length
}

export async function mergeSession(
  session: Session,
  opts: { message?: string; override?: boolean } = {},
): Promise<MergeResult> {
  const preview = await previewMerge(session)

  // Failing checks are the one blocker that can be overruled, and only when
  // they are the only one — `previewMerge` sets `blockedByChecks` last, so it
  // can never be true while git still objects to something.
  const overruled = preview.blockedByChecks && opts.override

  if (!preview.canMerge && !overruled) {
    throw createError({
      statusCode: 409,
      data: { error: 'merge_blocked', message: preview.blockedReason ?? 'This session cannot be merged.' },
    })
  }

  const base = opts.message?.trim() || `Merge session: ${session.title}`

  // A decision to merge over a failing suite is worth keeping. Six months on,
  // the question "was this known to be broken when it landed" has an answer in
  // the history rather than only in whoever remembers clicking the button.
  const message = overruled && preview.check
    ? `${base}\n\nMerged with \`${preview.check.command}\` failing.`
    : base

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

  /*
   * Filed here rather than by the caller, and that is deliberate.
   *
   * Both callers already patch the session immediately after this returns, so
   * the record could have gone there — and then the next caller to be written
   * would merge a branch that nothing reported as landed, which is precisely
   * the hole this whole field exists to close. A merge that happened is a fact
   * about the repository; recording it is not the caller's business to
   * remember.
   *
   * `recordLanded` cannot throw. A merge that has already gone through must not
   * come back as a failure because the bookkeeping afterwards did.
   */
  /*
   * The merge commit, read straight back off the base branch.
   *
   * `--no-ff` above guarantees there is one, and it is the only handle anything
   * later has on this landing: `revertWatch` watches the base branch for a commit
   * that undoes it, and "undoes what" has to name a commit. `tryGit` rather than
   * `git`, for the same reason `recordLanded` cannot throw — the merge is in, and
   * failing to read its sha is a landing recorded without one, not a failed merge.
   */
  const sha = await tryGit(session.repoDir, ['rev-parse', 'HEAD'])

  await recordLanded(session.id, {
    at: Date.now(),
    how: 'merged',
    into: session.baseBranch,
    commits: preview.commits,
    ...(sha ? { sha } : {}),
    ...(overruled ? { overrodeChecks: true } : {}),
  })

  return { merged: true, commitsBrought: preview.commits, message, overrodeChecks: Boolean(overruled) }
}
