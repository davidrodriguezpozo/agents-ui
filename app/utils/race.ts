import { providerLabel } from '~/utils/providers'
import type { Session } from '~/composables/useSessions'

/**
 * Several agents on one instruction, and how you tell which of them to keep.
 *
 * This is the thing the provider seam was cut for. Three agents given the same
 * brief, in three worktrees, gated on the same `make check`, and whichever one
 * passed is the one that lands. None of the CLIs can do that for itself — each
 * of them is one agent in one checkout — and the app already had every hard
 * half: the worktrees, the branch naming, the checks that run themselves after a
 * turn, the merge train. What was missing was the sentence that says these N
 * sessions are one question rather than N unrelated pieces of work.
 *
 * **Nothing here picks a winner.** It sorts the entrants into what is true of
 * them and stops. A race with two passing entrants has two answers and the
 * person reads the diffs; a tool that quietly landed the first one to go green
 * would be choosing on alphabetical order and calling it a verdict. What this
 * does do is make the useless outcomes unmistakable — everybody failed, nobody
 * produced anything — because those are the ones worth knowing early, and they
 * are the ones N separate rows in a list hide.
 */

/** Where one entrant got to. Ordered worst-to-best; see `RANK`. */
export type RaceStanding =
  /** Its work is in the base branch. The race is over and this is what won. */
  | 'landed'
  /** Checks pass and there are commits to land. The candidates. */
  | 'passed'
  /** Checks pass but nothing was committed — it answered rather than changed. */
  | 'passed-empty'
  /** A turn is still going, or the checks are still running. */
  | 'working'
  /** Checks have never run here, which is not the same as passing. */
  | 'unknown'
  /** Committed work the project's own checks reject. */
  | 'failed'
  /** The checks could not be run at all, so there is no verdict about the code. */
  | 'errored'

export interface RaceEntrant {
  session: Session
  /** Which agent ran it. Absent means Claude Code. */
  provider?: string
  standing: RaceStanding
  /** Commits this entrant has that the base branch does not. */
  ahead: number
}

export interface Race {
  id: string
  entrants: RaceEntrant[]
  /**
   * What the race has come to.
   *
   * `open` while anything is still moving — a race is not decided by the first
   * entrant home, because a second one may pass in a minute and be the better
   * diff. `decided` once nothing is moving and at least one entrant is
   * landable. `nothing` when everything has stopped and none of them is: all
   * failed, or all answered without changing anything. `over` once one landed.
   */
  outcome: 'open' | 'decided' | 'nothing' | 'over'
  /**
   * Entrants that passed and have something to land, best first.
   *
   * Populated whatever the outcome, including while the race is still `open`, and
   * that is deliberate: an entrant that has already passed is landable now, and
   * refusing to offer it until the slowest agent finishes would be the tool
   * making somebody wait for a comparison they did not ask to complete.
   *
   * So the two fields answer different questions and neither stands in for the
   * other. `candidates` is *what could be landed*; `outcome` is *whether the race
   * is worth waiting on any longer*. A page that wants to say "the winner" needs
   * both.
   */
  candidates: RaceEntrant[]
}

/**
 * Worst first, so `sort` puts the entrant most worth looking at last and
 * `[...].reverse()` reads as a leaderboard. Kept as a table rather than a
 * comparator chain because the order *is* the opinion, and an opinion is easier
 * to argue with when it is a list.
 */
const RANK: Record<RaceStanding, number> = {
  errored: 0,
  failed: 1,
  unknown: 2,
  working: 3,
  'passed-empty': 4,
  passed: 5,
  landed: 6,
}

/**
 * Where one session in a race got to.
 *
 * `landed` outranks everything, including a later failing check: once the
 * commits are in the base branch the question this race asked has been answered,
 * and a red verdict about the workspace afterwards is a fact about the workspace.
 *
 * A stale verdict counts as no verdict. It describes code that has since
 * changed, and reading it as a pass would land a diff nothing has tested — the
 * one mistake in this whole file that could put broken code in a base branch.
 */
export function standingOf(session: Session): RaceStanding {
  if (session.landed) return 'landed'

  const ahead = session.worktree?.ahead ?? 0

  // Still moving. Asked before the verdict, because a verdict from before the
  // turn that is running now is about to be replaced.
  if (session.status === 'running' || session.activity === 'working') return 'working'
  if (session.check?.status === 'running') return 'working'

  if (!session.check || session.checkStale) return 'unknown'

  switch (session.check.status) {
    case 'passing':
      return ahead > 0 ? 'passed' : 'passed-empty'
    case 'failing':
      return 'failed'
    case 'errored':
      return 'errored'
    default:
      return 'unknown'
  }
}

/** The sessions of one race, in the order a leaderboard reads: best first. */
export function raceOf(sessions: Session[], raceId: string): RaceEntrant[] {
  return sessions
    .filter(session => session.raceId === raceId)
    .map(session => ({
      session,
      provider: session.provider,
      standing: standingOf(session),
      ahead: session.worktree?.ahead ?? 0,
    }))
    .sort((a, b) =>
      RANK[b.standing] - RANK[a.standing]
      // More commits first among equals, then a stable name so the order does
      // not shuffle between polls on a row nobody has touched.
      || b.ahead - a.ahead
      || a.session.title.localeCompare(b.session.title))
}

export function describeRace(id: string, entrants: RaceEntrant[]): Race {
  const landed = entrants.filter(e => e.standing === 'landed')
  const moving = entrants.filter(e => e.standing === 'working')
  const candidates = entrants.filter(e => e.standing === 'passed')

  const outcome: Race['outcome'] = landed.length
    ? 'over'
    : moving.length
      ? 'open'
      : candidates.length
        ? 'decided'
        : 'nothing'

  return { id, entrants, outcome, candidates }
}

/** Every race among these sessions, newest first. */
export function racesIn(sessions: Session[]): Race[] {
  const ids: string[] = []
  for (const session of sessions) {
    if (session.raceId && !ids.includes(session.raceId)) ids.push(session.raceId)
  }

  return ids
    .map(id => describeRace(id, raceOf(sessions, id)))
    .sort((a, b) => newest(b.entrants) - newest(a.entrants))
}

function newest(entrants: RaceEntrant[]): number {
  return entrants.reduce((at, e) => Math.max(at, e.session.updatedAt ?? 0), 0)
}

/**
 * The race a session belongs to, from the whole list. Null when it is an
 * ordinary session, which is nearly all of them.
 */
export function raceFor(sessions: Session[], session: Session): Race | null {
  if (!session.raceId) return null
  return describeRace(session.raceId, raceOf(sessions, session.raceId))
}

/**
 * What the race is doing, in one line, for a heading.
 *
 * Written as a state of affairs rather than an instruction: the surrounding UI
 * already carries the buttons, and a heading that says "Pick one" above a race
 * where everything failed would be telling somebody to do the impossible.
 */
export function raceSummary(race: Race): string {
  const n = race.entrants.length

  switch (race.outcome) {
    case 'over': {
      const winner = race.entrants.find(e => e.standing === 'landed')
      return `Landed — ${providerLabel(winner?.provider)} won this one.`
    }
    case 'open': {
      const done = race.entrants.filter(e => e.standing !== 'working').length
      return `${done} of ${n} finished, the rest still working.`
    }
    case 'decided':
      return race.candidates.length === 1
        ? `${providerLabel(race.candidates[0]!.provider)} is the only one that passed.`
        : `${race.candidates.length} of ${n} passed — read the diffs and pick one.`
    case 'nothing':
      return race.entrants.some(e => e.standing === 'passed-empty')
        ? `None of the ${n} committed anything to land.`
        : `None of the ${n} passed.`
  }
}

/**
 * What a standing says to a reader, and in what colour.
 *
 * Beside the standings rather than in the page, so the vocabulary is decided in
 * the same file that decides the states. The wording is what is *true of the
 * entrant*, never an instruction — the page carries the buttons, and a row that
 * said "land this" would be making the call this module deliberately does not.
 */
export function standingLabel(entrant: RaceEntrant): string {
  const { standing, ahead } = entrant
  const commits = `${ahead} commit${ahead === 1 ? '' : 's'}`

  switch (standing) {
    case 'landed':
      return 'landed'
    case 'passed':
      return `passed · ${commits}`
    case 'passed-empty':
      return 'passed, but committed nothing'
    case 'working':
      return 'still working'
    case 'failed':
      return `checks failed · ${commits}`
    case 'errored':
      return 'checks could not run'
    case 'unknown':
      return ahead > 0 ? `${commits}, not checked yet` : 'nothing yet'
  }
}

export function standingColour(standing: RaceStanding): string | undefined {
  switch (standing) {
    case 'landed':
    case 'passed':
      return 'var(--success)'
    case 'failed':
    case 'errored':
      return 'var(--warning)'
    // Working, unknown and passed-empty are all "no news", and colouring them
    // would put three tones on a row where only two facts matter.
    default:
      return undefined
  }
}
