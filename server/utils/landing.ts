import type { Session } from './sessions'
import { orderTrain } from './trainOrder'

/**
 * Landing finished work, several sessions at a time.
 *
 * This is the half the app never had. It is very good at starting work — six
 * sessions in parallel, each in its own worktree, each with a verdict — and
 * then leaves you to merge them one page at a time.
 *
 * Doing that by hand is worse than it sounds, because the sessions interact.
 * Six branch from `main` and all go green. You merge the first, and the other
 * five are now verified against a `main` that no longer exists. Git will refuse
 * a textual conflict, but it has nothing to say about the other branch renaming
 * a function this one calls — that merges cleanly and breaks. Doing it properly
 * means, for every session after the first: bring the new base in, run the
 * checks again, and only then merge. Nobody does that six times.
 *
 * So it is done here instead, in order, one at a time. Sequential is not a
 * simplification — each merge moves the base, so the next session's update and
 * re-check are only meaningful once the previous one has landed.
 */

/** What a session needs before it can go in, cheapest first. */
export type LandingNeed =
  | 'ready'      // up to date and green: merge it
  | 'update'     // behind the base: bring it forward, then re-check
  | 'check'      // has changes but no usable verdict
  | 'landed'     // its work is already in the base: finished, not blocked
  | 'blocked'    // something a person has to decide

export interface LandingCandidate {
  id: string
  title: string
  need: LandingNeed
  /** Only for `blocked`, in words that say what to do about it. */
  reason?: string
}

export interface LandingShape {
  /** Sessions this run will attempt, in the order it will attempt them. */
  queue: LandingCandidate[]
  /**
   * Why that order, in one line, when there is anything to say.
   *
   * Empty for a queue of one, where there is no order to explain. An
   * unexplained reordering of somebody's work reads as a bug, which is the
   * whole reason this is carried out of here rather than composed on the page.
   */
  why?: string
  /**
   * The dependencies contradict each other, so the order is the cheapest-first
   * one and nothing was avoided. See `orderTrain`.
   */
  cycle?: boolean
  /**
   * Finished: everything in them is in the base already.
   *
   * Their own bucket rather than part of `skipped`, because the two are opposite
   * news wearing the same word. Lumped together, four sessions that had all
   * landed successfully were reported as "0 of 4 could land · cannot land",
   * which reads as four failures.
   */
  landed: LandingCandidate[]
  /** Left alone, and why. */
  skipped: LandingCandidate[]
}

/** Enough of a session to decide. Kept narrow so this stays testable. */
export interface LandingInput {
  id: string
  title: string
  status: Session['status']
  activity?: string
  check?: { status: string } | null
  checkStale?: boolean
  worktree: { exists: boolean; changedFiles: number; dirty: boolean; ahead: number; behind: number }
  /**
   * Whether its work is already in the base branch.
   *
   * Not derivable from `worktree.ahead`, and the difference is the whole reason
   * this field exists. `ahead` is counted from the commit the session branched at,
   * which is frozen when the session is created — so a session whose work has
   * *already landed* still reports sixteen commits ahead forever.
   *
   * A partly-finished landing is exactly this case. Two of four merged, the third
   * failed; press the button again and the two that landed came back into the
   * queue, had their checks re-run at length, and were then refused for having
   * "nothing to merge" — which stopped the run before it reached the two that
   * still needed it.
   *
   * Named for where the work is rather than for what happened to it, because
   * `Session` now carries a `landed` record of its own — when a merge happened,
   * by which of three routes — and this input is built by spreading a session.
   * Two different meanings of the same word on one object is how the wrong one
   * gets read.
   *
   * This one is the authority on the question it answers: it is what git says
   * now, where the record is what this app remembers doing. A branch merged by
   * hand in a terminal is `inBase` with no record at all.
   */
  inBase: boolean
}

function needOf(session: LandingInput): LandingCandidate {
  const head = { id: session.id, title: session.title }

  if (session.status === 'archived') {
    return { ...head, need: 'blocked', reason: 'Already closed.' }
  }
  if (!session.worktree.exists) {
    return { ...head, need: 'blocked', reason: 'Its workspace is no longer on disk.' }
  }
  if (session.status === 'running' || session.activity === 'working') {
    return { ...head, need: 'blocked', reason: 'Still working — it would be merged half-done.' }
  }
  if (session.activity === 'awaiting-permission') {
    return { ...head, need: 'blocked', reason: 'Waiting on a permission answer.' }
  }

  // Nothing to bring forward. Not a problem, just not a merge.
  if (!session.worktree.changedFiles && !session.worktree.dirty && !session.worktree.ahead) {
    return { ...head, need: 'blocked', reason: 'Nothing in it to merge.' }
  }

  /**
   * Already in, which is the end of the story rather than a problem with it.
   *
   * Decided before anything that costs money, because this is the session a retry
   * keeps tripping over: it has commits, it looks green, and every one of them is
   * in the base. Running its checks to find that out is minutes spent to learn
   * nothing.
   */
  if (session.inBase) {
    return { ...head, need: 'landed', reason: 'Its work is in the base branch.' }
  }

  // A known failure is a decision, not a step: re-running it will fail again,
  // and merging it anyway has to be somebody's explicit choice.
  if (session.check?.status === 'failing') {
    return { ...head, need: 'blocked', reason: 'Its checks fail. Fix it, or merge it by hand.' }
  }
  if (session.check?.status === 'errored') {
    return { ...head, need: 'blocked', reason: 'Its checks could not run, so nothing is known about it.' }
  }

  // Behind first: the update invalidates any verdict anyway, so there is no
  // point distinguishing a stale pass from a fresh one here.
  if (session.worktree.behind) return { ...head, need: 'update' }

  if (session.check?.status === 'passing' && !session.checkStale) return { ...head, need: 'ready' }

  return { ...head, need: 'check' }
}

/**
 * Which sessions to attempt and in what order.
 *
 * Cheapest first, and that ordering is doing real work rather than being tidy.
 * Every merge moves the base, so anything merged early adds a `behind` to
 * everything still queued. Landing the ones that are already up to date and
 * green means their merges happen before anybody has paid for an update, and
 * the sessions that were going to need updating get one update covering all of
 * it rather than one per merge ahead of them.
 *
 * `names` is the other half of the question, and optional because the cheap
 * answer has to keep working without it: given what each session defines and
 * uses, a session whose changed names another one calls goes first, whatever
 * either of them costs. See `trainOrder.ts` — including what happens when two
 * sessions use each other, which is nothing, said out loud.
 */
export function planLanding(
  sessions: LandingInput[],
  names?: Map<string, { provides: string[]; uses: string[] }>,
): LandingShape {
  const order: Record<LandingNeed, number> = { ready: 0, check: 1, update: 2, landed: 3, blocked: 4 }

  const decided = sessions.map(needOf).sort((a, b) => order[a.need] - order[b.need])
  const queue = decided.filter(c => c.need !== 'blocked' && c.need !== 'landed')

  const byId = new Map(sessions.map(session => [session.id, session]))
  const ordered = orderTrain(queue.map(candidate => ({
    id: candidate.id,
    title: candidate.title,
    need: candidate.need,
    green: byId.get(candidate.id)?.check?.status === 'passing',
    changedFiles: byId.get(candidate.id)?.worktree.changedFiles ?? 0,
    provides: names?.get(candidate.id)?.provides,
    uses: names?.get(candidate.id)?.uses,
  })))

  const position = new Map(ordered.order.map((id, at) => [id, at]))

  return {
    queue: [...queue].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0)),
    why: ordered.why,
    ...(ordered.cycle ? { cycle: true } : {}),
    landed: decided.filter(c => c.need === 'landed'),
    skipped: decided.filter(c => c.need === 'blocked'),
  }
}

/** How a single attempt ended, for the record and for the person reading it. */
export type LandingOutcome =
  | 'merged'
  /** Its work was already in the base — nothing to do, and not a failure. */
  | 'already-landed'
  | 'checks-failed'
  | 'conflicts'
  | 'update-failed'
  | 'no-checks'
  | 'refused'

export interface LandingStepResult {
  id: string
  title: string
  outcome: LandingOutcome
  detail?: string
}

/**
 * Whether a failure should stop everything or only this one.
 *
 * Only the states that say something about the repository as a whole stop the
 * run. One session failing its checks after an update is that session's
 * problem — the next one may well be fine, and abandoning four good merges
 * because the third had a bad day is the wrong trade.
 *
 * A refusal is different: it means git would not let anything merge here
 * (a dirty checkout, the wrong branch), which will be just as true for
 * everything behind it.
 *
 * `already-landed` deliberately does not stop it, and getting that wrong is what
 * made a partial landing unrecoverable. A session whose work was already in the
 * base came back as `refused`, the run stopped on it, and the two sessions behind
 * it that genuinely needed merging were recorded as "not attempted" — every time
 * the button was pressed.
 */
export function shouldStopRun(outcome: LandingOutcome): boolean {
  return outcome === 'refused'
}

/** What to say when it is over, in one line. */
export function describeLanding(results: LandingStepResult[]): string {
  const merged = results.filter(r => r.outcome === 'merged').length
  const failed = results.filter(r => r.outcome === 'checks-failed').length
  const conflicted = results.filter(r => r.outcome === 'conflicts').length
  const unchecked = results.filter(r => r.outcome === 'no-checks').length
  const already = results.filter(r => r.outcome === 'already-landed').length

  if (!results.length) return 'Nothing was ready to land.'

  /**
   * Zero does not get counted at you.
   *
   * "Merged 0 sessions." was the headline on a run that was refused before it
   * merged anything — a count of nothing, standing where the reason should be.
   * The reason is on the panel directly underneath; what the headline owes the
   * reader is that nothing came across.
   */
  const parts = [
    merged === 0
      ? 'Nothing was merged.'
      : merged === 1 ? 'Merged 1 session.' : `Merged ${merged} sessions.`,
  ]

  if (failed) parts.push(`${failed} failed ${failed === 1 ? 'its' : 'their'} checks after updating.`)
  if (conflicted) parts.push(`${conflicted} would conflict and ${conflicted === 1 ? 'was' : 'were'} left alone.`)
  if (unchecked) parts.push(`${unchecked} had no checks to run, so ${unchecked === 1 ? 'it was' : 'they were'} not merged.`)
  // Said rather than omitted: a retry after a partial landing is mostly these,
  // and a summary of "merged 2 sessions" with no mention of the other two reads
  // as though they were forgotten.
  if (already) parts.push(`${already} ${already === 1 ? 'was' : 'were'} already in the base.`)

  return parts.join(' ')
}
