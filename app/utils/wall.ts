import type { CheckStatus, SessionActivity } from '~/composables/useSessions'

/**
 * How a session's work got into the base branch. Mirrors `landed.ts` on the
 * server, which is where the three routes are explained — the client's own
 * session type carries a boolean instead, because `/api/sessions` answers
 * "is it in" from git rather than from the record.
 */
export type LandedHow = 'merged' | 'pull-request' | 'elsewhere'

/**
 * The fleet, for a screen nobody is sitting at.
 *
 * Every other surface in this app is read by somebody who came to it with a
 * question — which session needs me, what did last night cost. A wall is read
 * from four feet away by somebody walking past, and that changes what it may
 * contain: no rows to scan, no counts to add up, nothing that needs a click to
 * mean something. One glance has to answer *is anything wrong* and *is anything
 * happening*, in that order, and nothing else on it may compete with those two.
 *
 * Three rules follow from that, and they are what this file enforces:
 *
 * **It shows the fleet, not the archive.** A session touched last Tuesday is
 * not news. Only work that is live now, has broken, or landed today earns a
 * tile — and when there are more of those than fit, the wall says how many it
 * is not showing rather than silently dropping the twelfth.
 *
 * **Order is by whether the next move is yours**, never by recency. A session
 * waiting on a permission answer outranks five that are working, because the
 * five will carry on without you and it will not.
 *
 * **Nothing here costs a git spawn.** The wall polls forever, unattended, and
 * `/api/sessions` already learned what asking git per session per poll does to
 * the rest of the server. So a tile is built only from what is free to know:
 * the session record on disk, the run store in memory, and the events of the
 * turn currently in flight. That is why there is no "files changed" on a tile —
 * it is the one obvious thing a wall would want that cannot be had for nothing,
 * and inventing a cheaper wrong number would be worse than leaving it out.
 */

/**
 * A tool call a session has stopped to ask about.
 *
 * Carried in full — id included — rather than counted, because the count is a
 * report and the id is an answer. A screen somebody sits at should be able to
 * unblock the fleet from the row that says it is blocked; walking to the session
 * page to press the same two buttons is the trip this screen exists to save.
 *
 * The arguments come through `compactInput`, so a `Write` of a whole file arrives
 * as a line of text rather than the file.
 */
export interface WallPrompt {
  id: string
  toolName: string
  input: Record<string, unknown>
  /** The narrow rule the CLI proposed, e.g. `Bash(gh:*)`, when it proposed one. */
  rule?: string
  /** Whether "allow for the rest of this run" is a meaningful answer. */
  canRemember: boolean
  at: number
}

/** What a tile is doing right now, from the live run's latest tool call. */
export interface WallDoing {
  toolName: string
  /** Already trimmed by `compactInput` — a tile never carries a file's contents. */
  input: Record<string, unknown>
  at: number
}

export interface WallTile {
  sessionId: string
  title: string
  /** The repository's folder name. The full path means nothing at four feet. */
  repo: string
  branch: string
  activity: SessionActivity
  check: { status: CheckStatus; at: number } | null
  /** Set when the recorded verdict describes a workspace that has moved on. */
  checkStale?: boolean
  landedAt?: number
  landedHow?: LandedHow
  turns: number
  updatedAt: number
  /** When the turn now in flight began, which is what the elapsed clock counts. */
  startedAt?: number
  /** Permission prompts waiting for an answer, with enough to answer them. */
  prompts: WallPrompt[]
  /**
   * How many are waiting.
   *
   * Not `prompts.length`: the list is capped so one confused run cannot put forty
   * cards on a screen, and the count is what it is. Every ordering rule reads this
   * one rather than the list, so a capped list can never make a blocked session
   * look unblocked.
   */
  pending: number
  /**
   * The turn in flight, when there is one.
   *
   * Carried so the wall can stop it. Stopping is a *run* operation — a session
   * has no cancel of its own, because what gets stopped is the turn and not the
   * work, and everything already written stays in the workspace.
   */
  runId?: string
  doing: WallDoing | null
  prUrl?: string
  /** It is trying to fix its own failing checks. */
  repairing?: boolean
}

/** A tool call, from any session, for the ticker. */
export interface WallTick {
  sessionId: string
  repo: string
  toolName: string
  input: Record<string, unknown>
  at: number
}

export interface WallLanded {
  sessionId: string
  title: string
  repo: string
  how: LandedHow
  at: number
}

export interface WallRitual {
  id: string
  title: string
  at: number
  repo?: string
}

export interface WallQuota {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  window: string
  utilization: number | null
  resetsAt: number | null
  stale: boolean
}

/**
 * The last day, counted.
 *
 * `failed` is here rather than left to be read off the chart because it is the
 * one figure on this screen that is bad news, and bad news that has to be
 * inferred from a colour is bad news nobody acts on.
 */
export interface WallDay {
  runs: number
  failed: number
  /** Runs begun in the last hour, which is throughput now rather than average. */
  lastHour: number
}

export interface WallSnapshot {
  at: number
  /**
   * The whole current fleet, uncapped.
   *
   * The table draws all of them and scrolls, which is what the screen turned out
   * to be for. Anything that does cap a list — the panels in the rail — reports
   * what it left out, and that is the rule this field exists to make possible: a
   * screen showing four of eleven while looking exactly like a screen showing all
   * four is the one failure that would make the whole thing untrustworthy.
   */
  tiles: WallTile[]
  ticker: WallTick[]
  landedToday: WallLanded[]
  /**
   * Today's spend, and the cap that will actually stop things.
   *
   * The total is up to half a minute old by design — see `MONEY_TTL_MS` in the
   * endpoint. The cap is not: it is one small file, and a limit somebody has just
   * set should appear at once.
   */
  spend: { todayUsd: number; capUsd: number }
  /**
   * The last day's work as figures rather than as a shape.
   *
   * These are what is left of the chart that used to run along the bottom of the
   * wall. A picture answers *when*, which is a retrospective question and belongs
   * on Now; three figures answer *how many* and *how many came to nothing*, which
   * is all a screen about the present needs from yesterday.
   */
  day: WallDay
  quota: WallQuota | null
  /**
   * What the clock has queued, soonest first.
   *
   * More than the next one, because a screen read to plan the next hour needs to
   * tell "nothing until six" from "three things in the next ten minutes", and
   * only a list can say which of those it is.
   */
  upcoming: WallRitual[]
  /** Rituals the scheduler turned off because they had stopped working. */
  pausedRituals: number
  /**
   * Live sessions on this machine, including the ones too old to earn a row.
   *
   * The table shows *now*; this is the denominator it is a slice of. Without it a
   * quiet screen reads the same whether there are three sessions or thirty.
   */
  liveSessions: number
}

/**
 * Why a tile is on the wall, which is also where it sits.
 *
 * Deliberately coarser than the session badge. That badge has nine states and
 * is right to: it is read by somebody deciding what to do about one session.
 * This is read across a room, where anything past four groups stops being a
 * grouping and becomes a list again.
 */
export type WallUrgency = 'needs-you' | 'broken' | 'working' | 'settled'

export const URGENCY_ORDER: WallUrgency[] = ['needs-you', 'broken', 'working', 'settled']

export const URGENCY_LABELS: Record<WallUrgency, string> = {
  'needs-you': 'Needs you',
  broken: 'Broken',
  working: 'Working',
  settled: 'Settled',
}

/** How long since it moved before a session stops being part of "now". */
export const SETTLED_WINDOW_MS = 12 * 3_600_000

export function urgencyOf(tile: WallTile): WallUrgency {
  // Somebody is at the other end of this one. Nothing outranks that.
  if (tile.activity === 'awaiting-permission' || tile.pending > 0) return 'needs-you'

  if (tile.activity === 'failed' || tile.activity === 'missing') return 'broken'
  if (tile.activity === 'working') return 'working'

  /**
   * A landed session is finished, whatever its last local verdict says — the
   * work is in the base branch and a red check here describes code that has
   * already shipped. Ranked before the failing test below for that reason;
   * `sessionBadge` makes the same call for the same reason.
   */
  if (tile.landedAt) return 'settled'

  if (tile.check?.status === 'failing') return 'broken'

  return 'settled'
}

/**
 * Whether this session is part of *now*.
 *
 * Live work always is. So is anything broken, however long ago it broke — a
 * failing session that scrolls off the wall after twelve hours is a failing
 * session nobody is ever told about again. Everything else has to be recent.
 */
export function isCurrent(tile: WallTile, now: number): boolean {
  const urgency = urgencyOf(tile)
  if (urgency !== 'settled') return true
  return now - tile.updatedAt < SETTLED_WINDOW_MS
}

/**
 * Most urgent first, and within a group the one that moved most recently.
 *
 * Recency second rather than first is the whole point: a wall sorted by time is
 * a log, and a log is the thing this exists instead of.
 */
export function orderTiles<T extends WallTile>(tiles: T[]): T[] {
  return [...tiles].sort((a, b) => {
    const byUrgency = URGENCY_ORDER.indexOf(urgencyOf(a)) - URGENCY_ORDER.indexOf(urgencyOf(b))
    if (byUrgency !== 0) return byUrgency
    return b.updatedAt - a.updatedAt
  })
}

/**
 * What git knows about a session, which the wall snapshot deliberately does not.
 *
 * The snapshot is built without spawning git so it can be polled every couple of
 * seconds forever. These are the facts that *do* cost a process — files changed,
 * how far behind the base is — and they come from `/api/sessions`, polled far more
 * slowly, on the screen somebody is sitting at rather than the one on a wall.
 *
 * Each fact has exactly one owner, and that is the whole point of keeping them
 * apart: liveness (what it is doing, whether it is blocked, how long the turn has
 * run) comes only from the snapshot, and the git figures come only from here. Two
 * sources that both claim to know whether a session is working is how a row ends
 * up arguing with itself.
 */
export interface WallDetail {
  changedFiles?: number
  /** Commits on the base branch this session does not have. */
  behind?: number
  /** The recorded verdict describes a workspace that has since moved on. */
  checkStale?: boolean
  /** One sentence about what the session did, written from its diff. */
  summary?: string
  prUrl?: string
}

/** A row: the live tile, plus whatever git has been asked since. */
export interface WallRowData extends WallTile {
  detail?: WallDetail
}

/**
 * Rows for the screen, grouped by repository.
 *
 * Groups are ordered by their most urgent row rather than alphabetically, because
 * the reason to group at all is that somebody with four repositories open needs the
 * one with a problem in it first. Within a group the ordinary ordering applies.
 */
export function groupByRepo<T extends WallTile>(tiles: T[]): { repo: string; tiles: T[] }[] {
  const lanes: { repo: string; tiles: T[] }[] = []

  for (const tile of orderTiles(tiles)) {
    const lane = lanes.find(l => l.repo === tile.repo)
    if (lane) lane.tiles.push(tile)
    else lanes.push({ repo: tile.repo, tiles: [tile] })
  }

  return lanes
}

/** How many of a group need somebody, for the count beside its name. */
export function countUrgency(tiles: WallTile[]): Record<WallUrgency, number> {
  const counts: Record<WallUrgency, number> = {
    'needs-you': 0, broken: 0, working: 0, settled: 0,
  }

  for (const tile of tiles) counts[urgencyOf(tile)]++
  return counts
}

/**
 * The git half, attached to the live half.
 *
 * Left absent rather than zeroed when the slower poll has not answered yet, so a
 * row can say nothing about files changed instead of claiming there are none —
 * which, on a screen used to decide what to look at next, is the difference between
 * "no work here" and "we have not asked".
 */
export function withDetail<T extends WallTile>(
  tiles: T[],
  details: Map<string, WallDetail>,
): (T & { detail?: WallDetail })[] {
  return tiles.map(tile => ({ ...tile, detail: details.get(tile.sessionId) }))
}

/**
 * What the room should feel like.
 *
 * The wall's background and its one ambient signal come from this rather than
 * from any individual tile, because the question somebody glancing at it is
 * asking is about the whole machine. It is also the hook a sound layer would
 * hang on later: three states, each with an obvious note.
 */
export type WallMood = 'attention' | 'busy' | 'quiet'

export function moodOf(tiles: WallTile[]): WallMood {
  if (tiles.some(tile => urgencyOf(tile) === 'needs-you' || urgencyOf(tile) === 'broken')) return 'attention'
  if (tiles.some(tile => urgencyOf(tile) === 'working')) return 'busy'
  return 'quiet'
}

export interface Meter {
  /** 0–1, already clamped. */
  fraction: number
  label: string
  tone: 'quiet' | 'accent' | 'warning' | 'error'
}

/**
 * Money, for a wall rather than for a row.
 *
 * `formatCost` in `time.ts` is the one every list uses and returns `null` for
 * nothing, which is right there — an empty cell says "no cost" better than
 * `$0.00` does. A meter cannot be empty, so this always answers, and it drops
 * the pence from a whole number because a cap is something a person typed and
 * `$5` is what they typed.
 */
export function moneyLabel(usd: number): string {
  if (usd <= 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  if (usd >= 10) return `$${Math.round(usd)}`
  return `$${usd.toFixed(2)}`.replace(/\.00$/, '')
}

/**
 * Today's spend against the cap that will actually stop things.
 *
 * With no cap set there is no fraction to draw and the bar is left empty rather
 * than filled against an invented ceiling: a meter reading 60% of a limit
 * nobody set would be a number the app made up.
 */
export function spendMeter(todayUsd: number, capUsd: number): Meter {
  if (!capUsd || capUsd <= 0) {
    // No "today" on the end: the meter this fills is captioned Today, and the
    // header read "TODAY $48 today".
    return { fraction: 0, label: moneyLabel(todayUsd), tone: 'quiet' }
  }

  const fraction = Math.max(0, Math.min(1, todayUsd / capUsd))
  const label = `${moneyLabel(todayUsd)} of ${moneyLabel(capUsd)}`

  if (fraction >= 1) return { fraction, label: `${label} — work is being skipped`, tone: 'error' }
  if (fraction >= 0.75) return { fraction, label, tone: 'warning' }
  return { fraction, label, tone: 'accent' }
}

/**
 * How much of the subscription is left, when that is known.
 *
 * Null when nothing has run recently enough for the SDK to have said, and null
 * when the reading is stale — a rate limit shown as it stood six hours ago is
 * worse than an empty space, because it looks current.
 *
 * `utilization` arrives as either a fraction or a percentage depending on the
 * shape of the event, which is not a thing to guess about on a wall.
 */
export function quotaMeter(quota: WallQuota | null): Meter | null {
  if (!quota || quota.stale) return null

  const raw = quota.utilization
  const fraction = typeof raw === 'number'
    ? Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw))
    : quota.status === 'rejected' ? 1 : quota.status === 'allowed_warning' ? 0.85 : 0
  const tone = quota.status === 'rejected' ? 'error' : quota.status === 'allowed_warning' ? 'warning' : 'accent'

  /**
   * The number wins whenever there is one, and the colour carries the warning.
   * The words are the fallback, not the headline: "close to the weekly limit"
   * wraps to two lines in a header meter, and a wrapped caption reads as an
   * error message rather than as a reading.
   */
  if (typeof raw === 'number') {
    return { fraction, label: `${Math.round(fraction * 100)}% of ${quota.window}`, tone }
  }

  /**
   * Short, because this sits in a header meter beside another one.
   *
   * "room on the five-hour limit" is better English and 190px of it, which on a
   * real screen ran straight over the spend figure next to it. The window is the
   * part worth keeping — it is the fact somebody cannot work out for themselves —
   * and the word "limit" is dropped because the meter it sits in is called Limit.
   */
  if (quota.status === 'rejected') return { fraction: 1, label: `${quota.window} used up`, tone }
  if (quota.status === 'allowed_warning') return { fraction, label: `${quota.window} nearly used`, tone }

  return { fraction, label: `${quota.window} has room`, tone }
}

/** `4:31` while a turn runs, which is the only clock a wall needs. */
export function elapsedLabel(since: number | undefined, now: number): string {
  if (!since || now < since) return ''

  const seconds = Math.floor((now - since) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60

  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`
}

const HOW_LABELS: Record<LandedHow, string> = {
  merged: 'merged here',
  'pull-request': 'pull request merged',
  elsewhere: 'merged on github.com',
}

/**
 * How it got in. `elsewhere` is named as somebody else's doing on purpose —
 * this app taking credit for a merge a person made in a browser is the one way
 * a wall of what the machine did could quietly lie.
 */
export function landedLabel(how: LandedHow): string {
  return HOW_LABELS[how] ?? 'landed'
}

/** `in 12m`, `in 3h`, `now` — a next-run time read at a glance. */
export function untilLabel(at: number, now: number): string {
  const ms = at - now
  if (ms <= 30_000) return 'now'

  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `in ${minutes}m`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours}h`

  return `in ${Math.round(hours / 24)}d`
}

/**
 * What is waiting for you somewhere that is not this machine.
 *
 * The snapshot above is deliberately parochial: everything in it is a field on a
 * record or a run already in memory, which is what lets it be polled every couple
 * of seconds forever. None of that is true of a pull request. It lives on
 * github.com, it costs four `gh` calls per repository to read, and it changes on
 * somebody else's schedule rather than this machine's.
 *
 * That is an argument for reading it *differently*, not for leaving it off. Most
 * of what actually stops a day is not in a session at all — a review requested
 * while you were inside something else, your own branch red for two hours, a
 * thread in Slack somebody is waiting on. A screen that reports twenty agents in
 * detail and none of that is a screen you still have to check four tabs beside.
 *
 * So it arrives on its own clock: cached on the server for a minute, polled once
 * a minute rather than every two seconds, and stamped so the screen can say how
 * old it is instead of implying it is now.
 */

/**
 * Where a pull request has got to, in one word.
 *
 * Mirrors `PullState` in `server/utils/reviews.ts` — deliberately, and safely:
 * `wallPulls.ts` assigns the server's own verdict into this field, so the two
 * drifting apart is a type error at build time rather than a wrong badge.
 */
export type WallPullState =
  | 'draft'
  | 'conflicted'
  | 'changes-requested'
  | 'unanswered'
  | 'checks-failing'
  | 'checks-running'
  | 'ready'
  | 'awaiting-review'

/**
 * One pull request, flattened for a row.
 *
 * The verdict is not recomputed here. It arrives already decided by the same
 * function the reviews page draws, because two implementations of "is this on me"
 * on one screen is how a wall and the page it links to start disagreeing.
 */
export interface WallPull {
  /** The project's name on this machine, which is what the table's rows say too. */
  repo: string
  /** Its path, so a row can be told which checkout it belongs to. */
  repoDir: string
  /**
   * The branch it merges from, which is how a session finds its own pull request.
   *
   * Carried so nothing has to ask GitHub a second time: this reading covers every
   * project once a minute, and a session's pull request is either one you opened
   * or one you were asked to review — both of which are already in it. A branch
   * that is in neither list simply has no pull request to show, which is the same
   * answer the card gave before.
   */
  headBranch: string
  number: number
  title: string
  url: string
  author: string
  /** Whether you opened it. The two lists read completely differently. */
  mine: boolean
  draft: boolean
  state: WallPullState
  /** The badge, two or three words, as the reviews page words it. */
  label: string
  /** The line under it, when there is more to say. */
  detail: string
  /** Whether this does not move until you do something. */
  onYou: boolean
  createdAt: number
  updatedAt: number
  changedFiles: number
  checks: 'pending' | 'passing' | 'failing' | 'none'
  /** Review comments nobody resolved, or null when GitHub could not be asked. */
  unresolved: number | null
  /** Who has been asked and has not answered. Logins and team slugs. */
  awaiting: string[]
}

/** A repository that could not be read, and why — never silently absent. */
export interface WallPullProblem {
  repo: string
  reason: string
}

export interface WallPullsReading {
  /** When this was read. The screen says it, because it is up to a minute old. */
  at: number
  /** How many projects answered. Zero with problems is very different from zero. */
  repos: number
  /**
   * Projects passed over because they are not GitHub repositories at all.
   *
   * Counted rather than listed, and kept apart from `problems`: a notes folder
   * registered as a project is not a failure to read, and a screen that warns
   * about it every minute is a screen whose warnings get ignored.
   */
  skipped: number
  problems: WallPullProblem[]
  /** Asked of you, across every project. */
  reviewing: WallPull[]
  /** Yours, still open. */
  mine: WallPull[]
  summary: WallPullsSummary
}

export interface WallPullsSummary {
  /** Will not move until you do something, either list. */
  onYou: number
  toReview: number
  /** Yours, approved and green. */
  toMerge: number
  /** Yours, waiting on somebody else. */
  waiting: number
  /** Yours with CI red, which is the one worth a colour of its own. */
  failing: number
}

export const EMPTY_PULLS: WallPullsReading = {
  at: 0,
  repos: 0,
  skipped: 0,
  problems: [],
  reviewing: [],
  mine: [],
  summary: { onYou: 0, toReview: 0, toMerge: 0, waiting: 0, failing: 0 },
}

/**
 * The colour a state earns.
 *
 * Coarser than the eight states, for the reason `WallUrgency` is coarser than the
 * session badge: across a room, or down a list of nine rows, more than four
 * meanings in a colour is not a code any more.
 */
export type WallTone = 'quiet' | 'accent' | 'success' | 'warning' | 'error'

export const PULL_TONES: Record<WallPullState, WallTone> = {
  conflicted: 'error',
  'checks-failing': 'error',
  'changes-requested': 'warning',
  unanswered: 'warning',
  'awaiting-review': 'accent',
  ready: 'success',
  'checks-running': 'quiet',
  draft: 'quiet',
}

/**
 * On you first, then whichever has been sitting longest.
 *
 * Age rather than last activity, and the reviews page makes the same call for the
 * same reason: a pull request nobody has touched in a week is the one going bad,
 * and sorting by activity buries it under whatever somebody pushed to five
 * minutes ago.
 */
export function orderPulls(pulls: WallPull[]): WallPull[] {
  return [...pulls].sort((a, b) => (Number(b.onYou) - Number(a.onYou)) || (a.createdAt - b.createdAt))
}

/**
 * As many as the panel has room for, and how many it could not fit.
 *
 * The count is the whole point — see `WallSnapshot.tiles`. A panel showing four
 * of eleven reviews looks exactly like a panel showing all four, and that is the
 * one failure that would make somebody stop believing the screen.
 */
export function takeSome<T>(items: T[], cap: number): { shown: T[]; hidden: number } {
  return { shown: items.slice(0, cap), hidden: Math.max(0, items.length - cap) }
}

/** `20m`, `5h`, `3d` — how long something has been sitting, in one column. */
export function sinceLabel(at: number, now: number): string {
  const ms = Math.max(0, now - at)
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  return `${Math.floor(hours / 24)}d`
}

/**
 * How long ago somebody last went and looked.
 *
 * Says "never" rather than nothing, because an inbox that has never been checked
 * and an inbox with nothing in it look identical on a screen and are opposite
 * facts: one is good news and the other is a feature that was never switched on.
 */
export function checkedLabel(at: number | undefined, now: number): string {
  return at ? `checked ${sinceLabel(at, now)} ago` : 'never checked'
}

/**
 * How stale a reading off the network is, in the words a stamp wants.
 *
 * Everything else on this screen is a couple of seconds old and does not have to
 * say so. This is up to a minute old by design, and a panel that does not admit
 * that is a panel claiming a review request arrived the moment it appeared.
 */
export function asOfLabel(at: number, now: number): string {
  if (!at) return 'not read yet'
  const seconds = Math.floor(Math.max(0, now - at) / 1000)
  return seconds < 60 ? `as of ${seconds}s ago` : `as of ${sinceLabel(at, now)} ago`
}
