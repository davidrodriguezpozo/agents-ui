import type { Digest } from '~/composables/useDigest'
import type { Pull, WorkIntent } from '~/composables/useGithubPulls'
import type { AttentionItem } from '~/composables/useAttention'
import type { InboxItem, InboxSourceReading } from '~/composables/useInbox'

/**
 * One queue of everything that will not move until you do something.
 *
 * This existed in five places and nowhere: blocked sessions on /sessions,
 * pull requests on /pulls, failing rituals on /schedules, the morning digest on
 * /, failed runs on /runs. The four red counters in the sidebar were the tell —
 * the app had to badge four nav items precisely because the answer did not live
 * anywhere, and a badge that compensates for a missing view is a missing view.
 *
 * The ranking is the whole design, so it is a pure function with tests rather
 * than an order that emerges from the template.
 */

export type NowKind =
  | 'blocked-session'
  | 'stopped-ritual'
  | 'failing-ritual'
  | 'review'
  | 'inbox'
  | 'ready-session'
  | 'missed-ritual'

/**
 * Lower sorts first. The principle: work frozen *right now* outranks work
 * permanently broken, which outranks work that will break again, which outranks
 * a person waiting, which outranks value sitting idle.
 *
 * A blocked session leads because it is both the most stuck — a turn halted
 * mid-sentence — and the cheapest to fix. A missed ritual comes last because it
 * is the only thing here that heals itself: its turn comes round again.
 */
const URGENCY: Record<NowKind, number> = {
  'blocked-session': 0,
  'stopped-ritual': 1,
  'failing-ritual': 2,
  review: 3,
  // A ticket with your name on it is somebody's expectation of you, like a
  // review — but nobody is blocked on it this minute, so it sits below one.
  inbox: 4,
  'ready-session': 5,
  'missed-ritual': 6,
}

export interface NowAction {
  /** What the button says. A control says exactly what happens. */
  label: string
  kind: 'allow-rules' | 'work-on-pull' | 'work-on-inbox'
  /** Schedule id, pull number, or the URL of the thing to pick up. */
  target: string | number
  rules?: string[]
  /** For `work-on-inbox`: what the session should be told to do. */
  prompt?: string
}

export interface NowItem {
  key: string
  kind: NowKind
  urgency: number
  title: string
  /** Why it wants you, in one sentence. Never "an error occurred". */
  because: string
  /** Where pressing the row goes. */
  to?: string
  href?: string
  /** Resolvable from here, without going to another page first. */
  action?: NowAction
  /** For ordering within a rank, and for "3h ago". */
  at?: number
  /**
   * Nothing has moved on it in a fortnight, so it sinks and says how long.
   *
   * Set here rather than read in the template, because it changes the order and
   * the order is the design.
   */
  quiet?: boolean
}

/**
 * When a row stops being news.
 *
 * A fortnight, and the number matters less than what it separates. Inside one
 * it is ordinary for a thing to wait: a review lands after a holiday, a branch
 * sits over a weekend. Past one, whatever this is, it is not what is stopping
 * you today — it has been offered every morning for two weeks and passed over
 * every time, and that is an answer.
 */
export const QUIET_AFTER = 14 * 24 * 60 * 60 * 1000

/** Mirrors `INTENT_LABELS` on the server, which is what the prompt is built from. */
const INTENT_LABELS: Record<WorkIntent, string> = {
  review: 'Review it',
  address: 'Address it',
  fix: 'Fix CI',
  update: 'Resolve conflicts',
}

/**
 * A pull request, described by the verdict the server already reached.
 *
 * This first read the raw fields and wrote its own sentence from
 * `reviewDecision`, which is precisely the mistake `Pull.verdict` carries a
 * comment warning against: "deciding it a second time in the page is how two
 * numbers on one screen start disagreeing". It did — the sidebar counted
 * `summary.onYou`, which includes your *own* pull requests sitting approved and
 * unmerged, and the queue only looked at ones where you were a requested
 * reviewer. Badge said three, queue showed one.
 */
function pullItem(pull: Pull): NowItem {
  return {
    key: `pull:${pull.number}`,
    kind: 'review',
    urgency: URGENCY.review,
    title: pull.title,
    // `#12 · Approved, nothing reported` — the label is the state, the detail
    // is the nuance, and both come from the server.
    because: `#${pull.number} · ${pull.verdict.detail || pull.verdict.label}`,
    href: pull.url,
    at: pull.updatedAt,
    ...(pull.intent
      ? {
          action: {
            label: INTENT_LABELS[pull.intent],
            kind: 'work-on-pull' as const,
            target: pull.number,
          },
        }
      : {}),
  }
}

/**
 * A ticket assigned to you, as a row that can become a session.
 *
 * This is the point of having an inbox at all rather than a dashboard: every
 * other aggregator ends at "here is your notification". The action turns the
 * row into Claude working on it, in its own checkout, which is the one thing
 * this app can do that a notification list cannot.
 */
function inboxRow(source: InboxSourceReading, item: InboxItem): NowItem {
  return {
    key: `inbox:${source.key}:${item.id}`,
    kind: 'inbox',
    urgency: URGENCY.inbox,
    title: item.title,
    because: item.why,
    href: item.url,
    action: {
      label: 'Work on it',
      kind: 'work-on-inbox',
      target: item.url,
      prompt: `Pick up this ${source.label} item and do the work it describes: ${item.url}\n\n`
        + `Context on why it is waiting: ${item.why}\n\n`
        + 'Read it first, then say what you plan to do before changing anything.',
    },
  }
}

export interface NowInput {
  /**
   * Current state: blocked sessions and broken rituals, as they are right now.
   * These carry the queue, because they are the answer to "what needs me".
   */
  attention: AttentionItem[]
  /**
   * Every open pull request with your name on it, yours and others'. The
   * `verdict.onYou` flag decides which of them are waiting on you — the same
   * flag the sidebar counts, so the two cannot drift apart.
   */
  pulls: Pull[]
  /**
   * A report on a window, used only for the things that are genuinely events
   * within it — a ritual the scheduler gave up on, an occurrence that passed
   * unseen — and for what a finished session produced.
   *
   * Never for blocked sessions or failing rituals: the window closes, and a
   * ritual that broke before it began would vanish from here while still being
   * counted in the sidebar.
   */
  digest: Digest | null
  /**
   * What each inbox source last found. Read from a file, so this costs nothing —
   * finding them is a job that runs on its own, not a request this makes.
   */
  inbox?: InboxSourceReading[]
  /** Passed in so that "has gone quiet" stays part of a pure function. */
  now?: number
}

/**
 * Everything waiting on you, most stuck first.
 *
 * Within a rank, oldest first: a thing that has been blocked since 02:00 has
 * been blocked longer than one blocked ten minutes ago, and the longer it has
 * been stuck the more likely it is the reason your morning is not going well.
 *
 * That reasoning holds for a morning and breaks over a season, which is how
 * this screen came to lead with a pull request nobody had touched since April,
 * drawn above a review somebody had asked for three days earlier. Elapsed time
 * means two opposite things: on a session frozen mid-turn it is the measure of
 * how stuck you are, and on a pull request it is the measure of how little
 * anyone cares. So past `QUIET_AFTER` a row sinks within its rank instead of
 * rising, and among the sunk ones the most recently touched leads — once
 * "longest stuck is most urgent" has stopped being true, its opposite is.
 *
 * Nothing is dropped. It is still open, it still conflicts, it still says so
 * and still has its button; it just stops claiming to be this morning's
 * problem. An expiring queue would be the same lie in the other direction.
 */
export function buildNowQueue({ attention, pulls, digest, inbox, now = Date.now() }: NowInput): NowItem[] {
  const items: NowItem[] = []

  // Current state first, and the only source for these two kinds.
  for (const item of attention) {
    if (item.kind === 'blocked-session') {
      items.push({
        key: `session:${item.id}`,
        kind: 'blocked-session',
        urgency: URGENCY['blocked-session'],
        title: item.title,
        because: item.because,
        to: `/sessions/${item.id}`,
        at: item.at,
      })
      continue
    }

    // The rules it was refused live in the digest, when the run that was
    // refused them falls inside the window. Matched up below.
    const refused = digest?.rituals.find(r => r.scheduleId === item.id)
    const resolvable = refused && !refused.alreadyAllowed && (refused.suggestedRules?.length ?? 0) > 0

    items.push({
      key: `ritual:${item.id}`,
      kind: 'failing-ritual',
      urgency: URGENCY['failing-ritual'],
      title: item.title,
      because: refused?.problem ?? item.because,
      to: '/schedules',
      at: item.at,
      ...(resolvable
        ? {
            action: {
              label: 'Allow this from now on',
              kind: 'allow-rules' as const,
              target: item.id,
              rules: refused!.suggestedRules,
            },
          }
        : {}),
    })
  }

  if (digest) {
    for (const stopped of digest.stopped) {
      items.push({
        key: `stopped:${stopped.id}`,
        kind: 'stopped-ritual',
        urgency: URGENCY['stopped-ritual'],
        title: stopped.title,
        because: stopped.reason,
        to: '/schedules',
      })
    }

    // A gap is not a missed occurrence: it will not come round again, so it
    // ranks with the things that stay broken rather than with the ones that heal.
    for (const gap of digest.gaps) {
      items.push({
        key: `gap:${gap.id}:${gap.at}`,
        kind: 'stopped-ritual',
        urgency: URGENCY['stopped-ritual'],
        title: gap.title,
        because: 'Its turn passed unseen and will not come round again.',
        to: '/schedules',
        at: gap.at,
      })
    }

    for (const session of digest.sessions) {
      if (session.state !== 'ready') continue
      items.push({
        key: `ready:${session.id}`,
        kind: 'ready-session',
        urgency: URGENCY['ready-session'],
        title: session.title,
        because: session.behindBase
          ? 'Done and checked, but the base branch has moved under it.'
          : session.summary ?? 'Done, checked, and waiting for you to land it.',
        to: `/sessions/${session.id}`,
      })
    }

    for (const missed of digest.missed) {
      items.push({
        key: `missed:${missed.id}:${missed.dueAt}`,
        kind: 'missed-ritual',
        urgency: URGENCY['missed-ritual'],
        title: missed.title,
        because: 'It was due while nothing was running here.',
        to: '/schedules',
        at: missed.dueAt,
      })
    }
  }

  for (const source of inbox ?? []) {
    for (const item of source.items) items.push(inboxRow(source, item))
  }

  for (const pull of pulls) {
    // The server's judgement of whether this moves without you. A draft never
    // is, and it already says so.
    if (!pull.verdict.onYou) continue
    items.push(pullItem(pull))
  }

  // Marked in one place, after everything is collected, so no source of rows
  // can forget to do it and no two can decide it differently.
  for (const item of items) {
    if (item.at !== undefined && now - item.at > QUIET_AFTER) item.quiet = true
  }

  return items.sort((a, b) =>
    a.urgency - b.urgency
    || Number(Boolean(a.quiet)) - Number(Boolean(b.quiet))
    || (a.quiet ? (b.at ?? 0) - (a.at ?? 0) : (a.at ?? 0) - (b.at ?? 0))
    || a.title.localeCompare(b.title),
  )
}

/** The tone each kind carries. Severity, never decoration. */
export const NOW_LOOK: Record<NowKind, { icon: string; colour: string }> = {
  'blocked-session': { icon: 'i-lucide-hand', colour: 'var(--error)' },
  'stopped-ritual': { icon: 'i-lucide-octagon-x', colour: 'var(--error)' },
  'failing-ritual': { icon: 'i-lucide-circle-alert', colour: 'var(--warning)' },
  review: { icon: 'i-lucide-git-pull-request', colour: 'var(--info)' },
  'ready-session': { icon: 'i-lucide-circle-check', colour: 'var(--success)' },
  inbox: { icon: 'i-lucide-inbox', colour: 'var(--plugin)' },
  'missed-ritual': { icon: 'i-lucide-clock-alert', colour: 'var(--text-tertiary)' },
}
