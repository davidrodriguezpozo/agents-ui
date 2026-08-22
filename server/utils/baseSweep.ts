import { existsSync } from 'node:fs'
import type { Session } from './sessions'

/**
 * Bringing a moved base into every session that is now behind it.
 *
 * A merge is not one event. It is one event and then five silent consequences:
 * every other session in that repository is behind the moment it lands, and each
 * of their green verdicts was earned against a branch that no longer exists.
 * `updateFromBase` has always been able to fix one of them, from a button on
 * that session's own page — so the work was there, and the person had to
 * remember to do it five times, on five pages, in the right order.
 *
 * This is the pass. The decisions in it are all about restraint:
 *
 *   - **It is offered, never automatic.** A merge is a thing somebody pressed; a
 *     rebase of five other workspaces is not implied by it. The offer appears
 *     after the merge has succeeded and says how many sessions it would touch.
 *   - **Every precondition is checked before anything is written**, and a session
 *     that fails one is skipped with a sentence rather than half-attempted. A
 *     session mid-turn is the one that matters most: two agents in one worktree
 *     is the exact problem sessions exist to prevent.
 *   - **A branch another checkout holds is never touched.** Not a session's own
 *     worktree — that is where it lives — but any *other* path holding the same
 *     branch, which is what happens when somebody runs `gh pr checkout` in the
 *     main repository. Writing to it would move a branch under a person's feet.
 *   - **A conflict becomes a turn, not a failure.** It is left in the workspace
 *     where the session can see both sides, and that session is asked to resolve
 *     it with the files and the base named. This is the one place an agent is
 *     unambiguously the right tool: a small, well-specified, verifiable task, in
 *     a worktree that already exists.
 *
 * The plan is separated from the run for the reason everything else here is: the
 * plan is what the offer shows, and it must be the same judgement the run makes.
 */

/** What will happen to one session, decided before anything is written. */
export type SweepDisposition =
  /** Behind the base and able to catch up. */
  | 'update'
  /** Already has everything the base has. */
  | 'current'
  /** Left alone, and `reason` says why. */
  | 'skip'

export interface SweepCandidate {
  id: string
  title: string
  disposition: SweepDisposition
  /** Set on `skip` and on `current`, in words worth showing somebody. */
  reason?: string
  /** How far behind, when that is known. */
  behind?: number
}

export interface SweepPlan {
  repoDir: string
  baseBranch: string
  /** Every session considered, in the order the pass would take them. */
  candidates: SweepCandidate[]
  /** How many would actually be touched. What the offer counts. */
  updating: number
}

/** Enough of a session to decide. Kept narrow so this stays testable. */
export interface SweepInput {
  id: string
  title: string
  status: Session['status']
  branch: string
  baseBranch: string
  repoDir: string
  worktreePath: string
  detached?: boolean
  /** Its work is in the base already — including the session that just merged. */
  inBase: boolean
  landedAndHeld: boolean
  behind: number
  dirty: boolean
  worktreeExists: boolean
  /** A turn is running in it now. */
  busy: boolean
  /**
   * Another checkout is on this session's branch — not its own worktree.
   *
   * `git worktree list` is the authority: a branch checked out in two places
   * cannot be written to from one of them without moving it under the other.
   */
  heldElsewhere?: string
}

/**
 * Who the pass would touch, and who it would leave alone.
 *
 * Ordered by how far behind they are, most behind first. Not for tidiness: the
 * furthest behind is the one whose verdict is most out of date, and if something
 * goes wrong halfway through a pass, having done the most stale ones first is the
 * better half to have finished.
 */
export function planSweep(
  repoDir: string,
  baseBranch: string,
  sessions: SweepInput[],
): SweepPlan {
  const candidates = sessions
    .filter(session => session.repoDir === repoDir)
    .map(decide)
    .sort((a, b) => (b.behind ?? 0) - (a.behind ?? 0) || a.title.localeCompare(b.title))

  return {
    repoDir,
    baseBranch,
    candidates,
    updating: candidates.filter(candidate => candidate.disposition === 'update').length,
  }
}

function decide(session: SweepInput): SweepCandidate {
  const head = { id: session.id, title: session.title, behind: session.behind }

  if (session.status === 'archived') {
    return { ...head, disposition: 'skip', reason: 'Closed.' }
  }

  // A review workspace holds somebody else's commit rather than a branch of its
  // own. Bringing the base into it would be editing a pull request.
  if (session.detached) {
    return { ...head, disposition: 'skip', reason: 'A review workspace — it holds a commit, not a branch of its own.' }
  }

  if (!session.worktreeExists) {
    return { ...head, disposition: 'skip', reason: 'Its workspace is no longer on disk.' }
  }

  // The one that just merged, and anything else already in.
  if (session.inBase || session.landedAndHeld) {
    return { ...head, disposition: 'skip', reason: 'Its work is already in the base.' }
  }

  /*
   * Two agents in one worktree is the exact problem sessions exist to prevent,
   * and a merge landing under a turn that is mid-edit is worse than being
   * behind. Skipped and said, so the person can come back to it.
   */
  if (session.busy) {
    return { ...head, disposition: 'skip', reason: 'Still working — it would be merged into mid-turn.' }
  }

  if (session.heldElsewhere) {
    return {
      ...head,
      disposition: 'skip',
      reason: `Its branch is checked out in ${session.heldElsewhere}. Nothing here will move a branch somebody else is standing on.`,
    }
  }

  // `updateFromBase` refuses this too, and refusing it here means the offer
  // never counts a session it cannot actually touch.
  if (session.dirty) {
    return { ...head, disposition: 'skip', reason: 'It has uncommitted changes. Commit them, then bring the base in.' }
  }

  if (!session.behind) {
    return { ...head, disposition: 'current', reason: `Already up to date with ${session.baseBranch}.` }
  }

  return { ...head, disposition: 'update' }
}

// --- What happened -----------------------------------------------------------

export type SweepOutcome =
  /** Brought the base in, and the checks were re-run. */
  | 'updated'
  /** Brought the base in; the checks could not be re-run. */
  | 'updated-unverified'
  /** The base conflicts, and the session has been asked to resolve it. */
  | 'conflicted'
  /** Nothing was attempted. */
  | 'skipped'
  /** Attempted and refused by git. */
  | 'failed'

export interface SweepResult {
  id: string
  title: string
  outcome: SweepOutcome
  message: string
  /** The turn started to resolve a conflict, when one was. */
  runId?: string
  /** What the re-run checks said, when they ran. */
  check?: 'passing' | 'failing' | 'errored'
  /** The files git could not merge, when it could not. */
  conflicts?: string[]
}

/**
 * The turn a conflicted session is asked to take.
 *
 * Names the base, names the files, and stops. It deliberately does not say how
 * to resolve anything: the session has the whole of both sides in front of it,
 * and a prompt that guesses at the resolution is a prompt that argues with the
 * code. The last line is the only instruction that matters — the conflict has to
 * end resolved or reverted, never half-done.
 */
export function conflictPrompt(baseBranch: string, files: string[]): string {
  const list = files.length
    ? files.map(file => `- ${file}`).join('\n')
    : '- (git did not name the files; run `git status` to see them)'

  return [
    `Bringing \`${baseBranch}\` into this workspace hit a merge conflict. The merge is in progress`,
    'here — both sides are in the files, and nothing has been committed.',
    '',
    'Conflicted:',
    list,
    '',
    `Resolve each one so the work in this branch and the new \`${baseBranch}\` are both kept, then`,
    'commit the merge. Run this project\'s checks afterwards.',
    '',
    'If a conflict is not resolvable without a decision somebody has to make, run',
    '`git merge --abort` and say what the decision is. Do not leave the merge half-resolved.',
  ].join('\n')
}

/** Whether a merge left conflicts in the workspace, as `git status` reports them. */
export function conflictedFiles(porcelain: string): string[] {
  const files: string[] = []

  for (const line of porcelain.split('\n')) {
    // `UU`, `AA`, `DU`, `UD`, `AU`, `UA`, `DD` — the unmerged states. Two-letter
    // code, a space, then the path.
    const code = line.slice(0, 2)
    if (!/^(UU|AA|DD|AU|UA|DU|UD)$/.test(code)) continue

    const path = line.slice(3).trim()
    if (path) files.push(path)
  }

  return files
}

/** One line for the person who pressed it, from the results. */
export function describeSweep(results: SweepResult[]): string {
  const updated = results.filter(r => r.outcome === 'updated' || r.outcome === 'updated-unverified').length
  const conflicted = results.filter(r => r.outcome === 'conflicted').length
  const failed = results.filter(r => r.outcome === 'failed').length

  if (!results.length) return 'Nothing needed bringing forward.'

  const parts: string[] = []
  if (updated) parts.push(`${updated} brought forward`)
  if (conflicted) parts.push(`${conflicted} conflicted and ${conflicted === 1 ? 'is' : 'are'} resolving it`)
  if (failed) parts.push(`${failed} could not be updated`)

  return parts.length ? `${parts.join(', ')}.` : 'Nothing needed bringing forward.'
}
