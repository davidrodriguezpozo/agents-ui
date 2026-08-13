import type { Digest } from '~/composables/useDigest'
import type { Pull, WorkIntent } from '~/composables/useGithubPulls'
import type { AttentionItem } from '~/composables/useAttention'

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
  'ready-session': 4,
  'missed-ritual': 5,
}

export interface NowAction {
  /** What the button says. A control says exactly what happens. */
  label: string
  kind: 'allow-rules' | 'work-on-pull'
  /** Schedule id for `allow-rules`, pull number for `work-on-pull`. */
  target: string | number
  rules?: string[]
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
}

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
}

/**
 * Everything waiting on you, most stuck first.
 *
 * Within a rank, oldest first: a thing that has been blocked since 02:00 has
 * been blocked longer than one blocked ten minutes ago, and the longer it has
 * been stuck the more likely it is the reason your morning is not going well.
 */
export function buildNowQueue({ attention, pulls, digest }: NowInput): NowItem[] {
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

  for (const pull of pulls) {
    // The server's judgement of whether this moves without you. A draft never
    // is, and it already says so.
    if (!pull.verdict.onYou) continue
    items.push(pullItem(pull))
  }

  return items.sort((a, b) =>
    a.urgency - b.urgency || (a.at ?? 0) - (b.at ?? 0) || a.title.localeCompare(b.title),
  )
}

/** The tone each kind carries. Severity, never decoration. */
export const NOW_LOOK: Record<NowKind, { icon: string; colour: string }> = {
  'blocked-session': { icon: 'i-lucide-hand', colour: 'var(--error)' },
  'stopped-ritual': { icon: 'i-lucide-octagon-x', colour: 'var(--error)' },
  'failing-ritual': { icon: 'i-lucide-circle-alert', colour: 'var(--warning)' },
  review: { icon: 'i-lucide-git-pull-request', colour: 'var(--info)' },
  'ready-session': { icon: 'i-lucide-circle-check', colour: 'var(--success)' },
  'missed-ritual': { icon: 'i-lucide-clock-alert', colour: 'var(--text-tertiary)' },
}
