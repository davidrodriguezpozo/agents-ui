/**
 * Parallel branches, and the order they can land in.
 *
 * The sequential landing design is the hardest thing here to explain in prose.
 * Every merge moves the base, so the next session is behind the moment the
 * previous one lands and its green verdict was earned against a branch that no
 * longer exists. Written out that is a paragraph read once and forgotten. Drawn,
 * it is a spine that advances and tracks that fall behind it one at a time.
 *
 * **The decision is not made here.** An earlier version of this file worked out
 * for itself whether each session could land, and got five things wrong that the
 * server had already got right — it blocked on uncommitted changes, which the
 * lander commits for you; it let a session whose checks *errored* through as
 * ready, when nothing is known about that code; and it ordered `update` before
 * `check`, which is backwards, because merging the cheap ones first means the
 * rest need one update between them instead of one each. Two plausible numbers
 * on one screen disagreeing is worse than either being absent.
 *
 * So the order and the verdict come from `/api/landing/plan`, which is the same
 * `planLanding` the merge button runs. What is left here is the drawing: joining
 * the plan to the sessions it names, and turning commit counts into widths.
 */

/** Mirrors `LandingNeed` on the server. Cheapest first, which is also the order. */
export type TrainNeed = 'ready' | 'check' | 'update' | 'blocked'

export interface PlanCandidate {
  id: string
  title: string
  need: TrainNeed
  reason?: string
}

/**
 * The state of the checkout everything merges into.
 *
 * Separate from the per-session queue because it is not about any session: a
 * dirty checkout, or one on the wrong branch, refuses all of them equally. The
 * train has to say this *before* the button, because pressing it in this state
 * used to cost a full test-suite run to be told the same thing.
 */
export interface BaseState {
  baseBranch: string
  currentBranch: string
  clean: boolean
  blockedReason?: string
}

export interface LandingPlan {
  repoDir: string | null
  /** In the order landing will attempt them. */
  queue: PlanCandidate[]
  skipped: PlanCandidate[]
  base: BaseState | null
}

export interface TrainSession {
  id: string
  title: string
  branch: string
  baseBranch: string
  repoDir: string
  prUrl?: string
  worktree?: {
    exists: boolean
    ahead: number
    behind: number
    changedFiles: number
    dirty: boolean
  } | null
}

export interface TrainCar {
  candidate: PlanCandidate
  /** Absent when the plan names a session the page has not loaded. */
  session: TrainSession | null
  need: TrainNeed
  reason: string
  ahead: number
  behind: number
  /** Uncommitted work, which the lander commits before merging rather than refusing. */
  dirty: boolean
  order: number
  landable: boolean
}

/**
 * A second line, only where there is a second thing to say.
 *
 * `planLanding` writes a reason for blocked candidates and nothing for the rest,
 * so these fill the gap — but two of them are empty on purpose. The row already
 * carries "Ready" and "Needs checking" as its label, and repeating that
 * underneath in a longer sentence is a line people learn to skip, which then
 * costs the rows that do say something.
 */
const FALLBACK_REASON: Record<TrainNeed, string> = {
  ready: '',
  check: '',
  update: 'Brought forward first, then checked against the moved base',
  blocked: 'Left alone',
}

/**
 * The plan, joined to what the page knows about each session.
 *
 * The queue keeps the server's order exactly. Blocked ones follow it, because
 * they are not in the order at all — they are the list of what is not coming.
 */
export function buildTrain(plan: LandingPlan | null, sessions: TrainSession[]): TrainCar[] {
  if (!plan) return []

  const byId = new Map(sessions.map(s => [s.id, s]))

  const car = (candidate: PlanCandidate, order: number): TrainCar => {
    const session = byId.get(candidate.id) ?? null
    const worktree = session?.worktree

    return {
      candidate,
      session,
      need: candidate.need,
      reason: candidate.reason ?? FALLBACK_REASON[candidate.need],
      ahead: worktree?.ahead ?? 0,
      behind: worktree?.behind ?? 0,
      dirty: Boolean(worktree?.dirty),
      order,
      landable: candidate.need !== 'blocked',
    }
  }

  return [
    ...plan.queue.map((c, i) => car(c, i)),
    ...plan.skipped.map((c, i) => car(c, plan.queue.length + i)),
  ]
}

export interface TrainSummary {
  total: number
  landable: number
  blocked: number
  /** Commits that would arrive on the base if the whole queue merged. */
  commits: number
  needUpdate: number
  /** Sessions carrying work that is not committed yet. */
  dirty: number
}

export function summarizeTrain(cars: TrainCar[]): TrainSummary {
  const landable = cars.filter(c => c.landable)

  return {
    total: cars.length,
    landable: landable.length,
    blocked: cars.length - landable.length,
    commits: landable.reduce((sum, c) => sum + c.ahead, 0),
    needUpdate: cars.filter(c => c.need === 'update').length,
    dirty: landable.filter(c => c.dirty).length,
  }
}

/**
 * Where each car's commits sit along the spine.
 *
 * The spine is the base branch and the scale is the widest divergence on screen,
 * so a session four commits ahead draws twice the run of one that is two ahead.
 * Capped, because one session forty commits ahead beside five that are two ahead
 * would squash the five into nothing.
 */
export const MAX_SPINE_COMMITS = 12

export function spineFraction(commits: number, widest: number): number {
  const scale = Math.max(1, Math.min(widest, MAX_SPINE_COMMITS))
  return Math.min(1, commits / scale)
}

export function widestAhead(cars: TrainCar[]): number {
  return cars.reduce((max, car) => Math.max(max, car.ahead), 0)
}
