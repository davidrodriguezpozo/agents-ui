import type { RunEvent } from './runStore'
import { sourceOf, type RunSource } from './runFilter'
import { landedSince, type LandedHow, type SessionLanded } from './landed'
import type { SessionReverted } from './revertWatch'
import type { CheckStatus, SessionCheck } from './checks'
import type { SideCost } from './spend'

/**
 * What the money bought.
 *
 * Three files each hold a third of the answer and none of them can reach the
 * other two. `spend.ts` knows what everything cost and nothing about whether it
 * was worth it. `landed.ts` knows what went into a base branch and by which of
 * three routes, and nothing about what that took. `checks.ts` knows whether the
 * code held up, per session, one session at a time. So the question anybody
 * actually has after a night of unattended work — *was that a good trade* — was
 * unanswerable, not for want of records but for want of a join.
 *
 * This is the join, and only that: pure functions over records somebody else
 * loaded. No store, no reads, nothing to mock. Every later surface that wants a
 * ledger asks this and renders the result.
 *
 * **Which numbers are exact.** Worth being blunt about, because a ledger that
 * overclaims is worse than no ledger:
 *
 *   - *Turn counts and landing counts are exact.* They are counted records.
 *   - *Dollar figures are as exact as the SDK's own.* On an API key they are
 *     real charges. On a subscription nothing is billed per turn, so the same
 *     number is what the work would have cost at list price — a sense of scale,
 *     not an invoice. This file cannot tell the two apart and does not pretend
 *     to; the caller knows which it is.
 *   - *Cost per landing is indicative, and generously so.* A session's cost is
 *     the sum of its turns, and its turns include the ones that were a person
 *     changing their mind, a wrong guess, or a conversation about something
 *     else entirely. Nothing here separates work from rework, so the figure is
 *     an upper bound on the work and a lower bound on the waste.
 *   - *A landing by `elsewhere` is somebody else's merge.* It is counted as a
 *     landing, because the work was accepted either way, and kept separately,
 *     because this machine did not do it and should not take the credit.
 *   - *Reverts are a floor, not a count.* `revertedLandings` counts the merges in
 *     a window that have since been taken back out, and it can only see the ones
 *     a commit message says so about — see `revertWatch.ts`. Nothing here reads it
 *     as a failure: a revert is often the right thing to have happened, and the
 *     number is here so that "it merged" stops being the last word rather than to
 *     mark anybody's work.
 *
 * **How a session ends up in one bucket.** Spend is attributed per turn, from
 * the fate of the session that turn belonged to, so within any group the buckets
 * add back up to the group's cost. Landings are attributed per session, to the
 * group of the last costed turn in the window — the last hand on it. A session
 * run under two models therefore counts its landing under one of them rather
 * than both: group landing counts sum to the total and never exceed it, which is
 * the property worth having when somebody adds up a column.
 */

/** Tool calls that mean a file on disk is different afterwards. */
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/**
 * Whether a turn changed anything, read off its event log.
 *
 * Nothing records this on the run, and it is the difference between a night of
 * work and a night of reading. An edit whose result came back an error did not
 * happen; one with no result at all is counted, because a turn cut off after
 * writing a file has still written the file. `Bash` is not read: a shell line
 * that patches a file is indistinguishable here from one that runs the tests,
 * so turns that only ever edited through the shell undercount.
 */
export function turnChangedFiles(events: RunEvent[] = []): boolean {
  const edits = new Set<string>()

  for (const event of events) {
    if (event.type === 'tool_use') {
      if (EDIT_TOOLS.has(String(event.toolName))) edits.add(String(event.id))
      continue
    }
    if (event.type === 'tool_result' && event.isError) edits.delete(String(event.id))
  }

  return edits.size > 0
}

/**
 * Which skill or command a turn was, when it was one.
 *
 * `invocation` is set when something in this app started the run and knew what
 * it was invoking. A turn typed by hand has only its prompt, where the same
 * fact is the first word — so a session where somebody ran `/code-review` is
 * still attributable to that skill. Anything that is not a slash invocation has
 * no skill, which is not the same as belonging to an "other" bucket.
 */
export function skillOf(turn: { invocation?: string; input?: string }): string | undefined {
  const invocation = turn.invocation?.trim()
  if (invocation) return invocation.replace(/^\//, '') || undefined

  const first = turn.input?.trim().split(/\s/)[0] ?? ''
  const match = /^\/([a-z][\w-]*(?::[\w-]+)*)$/i.exec(first)
  return match?.[1]
}

// --- What goes in ------------------------------------------------------------

/**
 * A turn, structurally.
 *
 * Deliberately not typed against `RunSummary`: that type is what a list view
 * needs and carries neither the model nor the repository, both of which this
 * groups by. Anything with these fields will do — see `outcomeTurnOf` for the
 * run record, which has all of them.
 */
export interface OutcomeTurn {
  id: string
  /** Asked for at. */
  createdAt: number
  /** Began at, which is not when it was asked for — runs queue per repository. */
  startedAt?: number
  costUsd?: number
  source: RunSource
  /** The session that owns this turn, when one does. */
  sessionId?: string
  /** The ritual that fired it, when one did. */
  scheduleId?: string
  agentSlug?: string
  invocation?: string
  input?: string
  model?: string
  /** The repository, for a turn that is not a session's. */
  projectDir?: string
  /**
   * Whether this turn changed a file. Absent means nobody worked it out, which
   * is reported as unmeasured rather than counted as a turn that changed
   * nothing — see `turnChangedFiles`.
   */
  changedFiles?: boolean
}

/** A session, structurally: where it lives, how it ended, and what the checks said. */
export interface OutcomeSession {
  id: string
  repoDir?: string
  agentSlug?: string
  status?: string
  landed?: SessionLanded
  /** That the landing was taken back out again. See `revertWatch.ts`. */
  reverted?: SessionReverted
  check?: SessionCheck
  /** When the person said they were done with it. See `Session.filedAt`. */
  filedAt?: number
}

/** The run record, as far as this needs it. */
export interface OutcomeRunRecord {
  id: string
  title: string
  kind: string
  status: string
  createdAt: number
  startedAt?: number
  input?: string
  invocation?: string
  agentSlug?: string
  projectDir?: string
  scheduleId?: string
  sessionId?: string
  stats?: { costUsd?: number; model?: string }
  events?: RunEvent[]
}

/**
 * A run record as a turn.
 *
 * Here rather than in the caller because two of the fields are only obvious
 * once: the cost lives under `stats`, and whether the turn changed anything has
 * to be recovered from the event log.
 */
export function outcomeTurnOf(run: OutcomeRunRecord): OutcomeTurn {
  return {
    id: run.id,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    costUsd: run.stats?.costUsd,
    source: sourceOf(run),
    sessionId: run.sessionId,
    scheduleId: run.scheduleId,
    agentSlug: run.agentSlug,
    invocation: run.invocation,
    input: run.input,
    model: run.stats?.model,
    projectDir: run.projectDir,
    // Only claimed when there is an event log to claim it from. A run whose
    // events were never loaded is unmeasured, not unchanged.
    changedFiles: run.events ? turnChangedFiles(run.events) : undefined,
  }
}

export interface OutcomeInput {
  turns: OutcomeTurn[]
  sessions: OutcomeSession[]
  /** Model calls that cost money without being runs. Kept out of the totals. */
  side?: SideCost[]
  since: number
  /** Absent means no upper bound. */
  until?: number
}

// --- What comes out ---------------------------------------------------------

export interface LandingCounts {
  total: number
  /** A git merge into the base branch, by this machine. */
  merged: number
  /** This app merged the pull request once it was green. */
  pullRequest: number
  /** Found already merged — somebody did it on github.com. */
  elsewhere: number
}

export interface ChangedShare {
  /** Turns that edited at least one file. */
  turns: number
  /** Turns it could be worked out for. The denominator, stated. */
  measured: number
  /** Null rather than zero when nothing was measured — they are different facts. */
  share: number | null
}

export interface CheckTally {
  passing: number
  failing: number
  /** Could not be run, so there is no verdict about the code. */
  errored: number
  running: number
  /** Sessions whose checks have never run here, which is not the same as passing. */
  unknown: number
  /** Landings that went in over a failing check, on purpose. */
  landedOverFailing: number
}

export interface OutcomeTotals {
  turns: number
  costUsd: number
  landings: LandingCounts
  /**
   * Landings in this window whose work has since been taken back out.
   *
   * A subset of `landings.total` rather than a separate event, and counted where
   * the landing is counted rather than where the revert happened — the question
   * it answers is "of what we merged, how much held", which only makes sense
   * against the merges. Kept outside `landings`, whose four numbers are one
   * partition of the same total and add up to it; this one cuts across them.
   *
   * It is a figure as of now, not as of the end of the window: a window that
   * closed a fortnight ago has had a fortnight in which its merges could be
   * reverted, and one that closes tonight has not. The two are not directly
   * comparable and the page says so. See `revertWatch.ts` for what is detectable
   * at all — this is a floor, never a total.
   */
  revertedLandings: number
  /** Spend on sessions that landed. */
  landedCostUsd: number
  /** Spend that produced nothing: sessions set aside or closed without landing. */
  abandonedCostUsd: number
  /** Spend on sessions still open — not yet a win and not yet a loss. */
  openCostUsd: number
  /** Spend no session owns: rituals, one-off commands, agent runs. */
  unattributedCostUsd: number
  /** Indicative. See the note at the top of this file. */
  costPerLandingUsd: number | null
  changedFiles: ChangedShare
  checks: CheckTally
}

export interface OutcomeGroup extends OutcomeTotals {
  /** The ritual id, agent slug, model, skill or repository path. */
  key: string
}

export interface OutcomeReport extends OutcomeTotals {
  window: { since: number; until: number }
  /**
   * Costs that were not runs — the summary line, mostly. Reported beside the
   * totals rather than inside them, so "what did the work cost" and "what did
   * the app cost around the work" stay separable.
   */
  side: { costUsd: number; calls: number }
  /** Largest spend first, in every dimension. */
  byRitual: OutcomeGroup[]
  byAgent: OutcomeGroup[]
  byModel: OutcomeGroup[]
  bySkill: OutcomeGroup[]
  byRepository: OutcomeGroup[]
}

// --- The join ---------------------------------------------------------------

/** JSON-safe, unlike Infinity, which serialises to null. */
const NO_UPPER_BOUND = Number.MAX_SAFE_INTEGER

interface Tally {
  turns: number
  costUsd: number
  changed: number
  measured: number
  merged: number
  pullRequest: number
  elsewhere: number
  reverted: number
  landedCostUsd: number
  abandonedCostUsd: number
  openCostUsd: number
  unattributedCostUsd: number
  passing: number
  failing: number
  errored: number
  running: number
  unknown: number
  landedOverFailing: number
}

function tally(): Tally {
  return {
    turns: 0,
    costUsd: 0,
    changed: 0,
    measured: 0,
    merged: 0,
    pullRequest: 0,
    elsewhere: 0,
    reverted: 0,
    landedCostUsd: 0,
    abandonedCostUsd: 0,
    openCostUsd: 0,
    unattributedCostUsd: 0,
    passing: 0,
    failing: 0,
    errored: 0,
    running: 0,
    unknown: 0,
    landedOverFailing: 0,
  }
}

function totalsOf(t: Tally): OutcomeTotals {
  const landings = {
    total: t.merged + t.pullRequest + t.elsewhere,
    merged: t.merged,
    pullRequest: t.pullRequest,
    elsewhere: t.elsewhere,
  }

  return {
    turns: t.turns,
    costUsd: t.costUsd,
    landings,
    revertedLandings: t.reverted,
    landedCostUsd: t.landedCostUsd,
    abandonedCostUsd: t.abandonedCostUsd,
    openCostUsd: t.openCostUsd,
    unattributedCostUsd: t.unattributedCostUsd,
    // Divided by the landings, not by the sessions: what a merge cost is the
    // question, and a window with no merge has no answer rather than a zero.
    costPerLandingUsd: landings.total > 0 ? t.landedCostUsd / landings.total : null,
    changedFiles: {
      turns: t.changed,
      measured: t.measured,
      share: t.measured > 0 ? t.changed / t.measured : null,
    },
    checks: {
      passing: t.passing,
      failing: t.failing,
      errored: t.errored,
      running: t.running,
      unknown: t.unknown,
      landedOverFailing: t.landedOverFailing,
    },
  }
}

/** Which bucket a turn's cost belongs in, from what became of its session. */
type Fate = 'landed' | 'abandoned' | 'open' | 'unattributed'

function fateOf(session: OutcomeSession | undefined): Fate {
  if (!session) return 'unattributed'
  if (session.landed) return 'landed'
  // Set aside by hand, or closed. Either way somebody decided it was finished
  // and nothing came out of it.
  if (session.filedAt || session.status === 'archived') return 'abandoned'
  return 'open'
}

const LANDED_FIELD: Record<LandedHow, 'merged' | 'pullRequest' | 'elsewhere'> = {
  'merged': 'merged',
  'pull-request': 'pullRequest',
  'elsewhere': 'elsewhere',
}

const CHECK_FIELD: Record<CheckStatus, 'passing' | 'failing' | 'errored' | 'running'> = {
  passing: 'passing',
  failing: 'failing',
  errored: 'errored',
  running: 'running',
}

/** When a turn happened: when it began if that is known, else when it was asked for. */
function turnAt(turn: OutcomeTurn): number {
  return turn.startedAt ?? turn.createdAt
}

/**
 * What was spent, what landed, and what the checks said — for one window,
 * grouped five ways.
 *
 * Grouping leaves a turn out of a dimension it has no value for rather than
 * inventing a bucket for it: a group called "unknown" reads like a real ritual
 * with a bad name. So a dimension's groups can sum to less than the total, and
 * that gap is the honest shape of the records.
 */
export function joinOutcomes(input: OutcomeInput): OutcomeReport {
  const since = input.since
  const until = input.until ?? NO_UPPER_BOUND

  const sessions = new Map(input.sessions.map(session => [session.id, session]))
  const turns = input.turns.filter(turn => turnAt(turn) >= since && turnAt(turn) <= until)

  const overall = tally()
  const dimensions = {
    byRitual: new Map<string, Tally>(),
    byAgent: new Map<string, Tally>(),
    byModel: new Map<string, Tally>(),
    bySkill: new Map<string, Tally>(),
    byRepository: new Map<string, Tally>(),
  }

  type Dimension = keyof typeof dimensions
  const keysOf = (turn: OutcomeTurn): Partial<Record<Dimension, string>> => {
    const session = turn.sessionId ? sessions.get(turn.sessionId) : undefined
    return {
      byRitual: turn.scheduleId,
      // The session's own agent stands in for a turn that did not name one:
      // every turn of a session run by an agent is that agent's work.
      byAgent: turn.agentSlug ?? session?.agentSlug,
      byModel: turn.model,
      bySkill: skillOf(turn),
      // A session's repository is on the session; a ritual or a command carries
      // its own.
      byRepository: session?.repoDir ?? turn.projectDir,
    }
  }

  /** Add to the overall tally and to each group this turn belongs to. */
  const into = (turn: OutcomeTurn | undefined, apply: (t: Tally) => void) => {
    apply(overall)
    if (!turn) return

    const keys = keysOf(turn)
    for (const [dimension, map] of Object.entries(dimensions) as [Dimension, Map<string, Tally>][]) {
      const key = keys[dimension]
      if (!key) continue
      let bucket = map.get(key)
      if (!bucket) map.set(key, bucket = tally())
      apply(bucket)
    }
  }

  /** The last costed turn of each session in this window — the last hand on it. */
  const lastTurn = new Map<string, OutcomeTurn>()
  /** Every session with a turn in this window, costed or not. */
  const touched = new Set<string>()

  for (const turn of turns) {
    const session = turn.sessionId ? sessions.get(turn.sessionId) : undefined
    const cost = typeof turn.costUsd === 'number' && turn.costUsd > 0 ? turn.costUsd : 0
    const fate = fateOf(session)

    into(turn, (t) => {
      t.turns += 1
      t.costUsd += cost
      if (turn.changedFiles !== undefined) {
        t.measured += 1
        if (turn.changedFiles) t.changed += 1
      }
      if (fate === 'landed') t.landedCostUsd += cost
      else if (fate === 'abandoned') t.abandonedCostUsd += cost
      else if (fate === 'open') t.openCostUsd += cost
      else t.unattributedCostUsd += cost
    })

    if (!turn.sessionId) continue
    touched.add(turn.sessionId)
    if (cost > 0) {
      const previous = lastTurn.get(turn.sessionId)
      if (!previous || turnAt(turn) >= turnAt(previous)) lastTurn.set(turn.sessionId, turn)
    }
  }

  /*
   * A session is counted once, against the group of its last costed turn. When a
   * session landed in this window but did all its work before it, there is no
   * such turn — the landing still counts in the totals and belongs to no group,
   * for the same reason an unattributable turn does.
   *
   * Counted by when they landed rather than by when the work was done: a
   * window's landings are the merges that happened in it. `landedSince` is what
   * knows the difference between a session with no landing and one that landed
   * at zero.
   */
  for (const session of landedSince(input.sessions, since)) {
    const { id, landed, reverted } = session
    // `landedSince` filters on the record but is typed on the session, so the
    // narrowing does not survive the call.
    if (!landed || landed.at > until) continue
    into(lastTurn.get(id), (t) => {
      t[LANDED_FIELD[landed.how]] += 1
      if (landed.overrodeChecks) t.landedOverFailing += 1
      /*
       * Not gated on `until`, unlike everything else here, and that is a choice
       * rather than an oversight. The revert is a fact about the *landing*: a
       * merge from last Tuesday that was reverted this morning did not hold, and
       * hiding that from last week's window to keep the arithmetic tidy would be
       * reporting a merge as having held when it is known not to have.
       */
      if (reverted) t.reverted += 1
    })
  }

  // The verdicts belong to the sessions worked on in this window. A session
  // nobody touched has a verdict about code this window did not produce, and
  // counting it would make a quiet day look like a day of passing tests.
  for (const sessionId of touched) {
    const session = sessions.get(sessionId)
    if (!session) continue
    into(lastTurn.get(sessionId), (t) => {
      if (session.check) t[CHECK_FIELD[session.check.status]] += 1
      else t.unknown += 1
    })
  }

  const side = (input.side ?? []).filter(entry => entry.costUsd > 0 && entry.at >= since && entry.at <= until)

  const groups = (map: Map<string, Tally>): OutcomeGroup[] =>
    [...map.entries()]
      .map(([key, t]) => ({ key, ...totalsOf(t) }))
      .sort((a, b) => b.costUsd - a.costUsd || a.key.localeCompare(b.key))

  return {
    ...totalsOf(overall),
    window: { since, until },
    side: {
      costUsd: side.reduce((sum, entry) => sum + entry.costUsd, 0),
      calls: side.length,
    },
    byRitual: groups(dimensions.byRitual),
    byAgent: groups(dimensions.byAgent),
    byModel: groups(dimensions.byModel),
    bySkill: groups(dimensions.bySkill),
    byRepository: groups(dimensions.byRepository),
  }
}
