import { personName, type Identity } from './identity'
import { repositoryRootOf } from './worktrees'

/**
 * What shipped, in sentences somebody outside engineering can act on.
 *
 * Every other view in this app is for the person running the work: branch names,
 * commit counts, check fingerprints, cost per merge. All of it correct and none
 * of it showable to the person who asked for the feature. The desktop tools have
 * the same gap and cannot close it — they show branches, because a branch is what
 * they know about. The one thing this app has that they do not is a sentence per
 * session, written when the work finished (`sessionSummary.ts`), and this is what
 * that sentence was for.
 *
 * Four rules, and the first is the whole design:
 *
 *   - **No jargon in the default view, structurally.** Not "hidden behind a
 *     toggle" — a row simply does not carry a branch, a commit, a fingerprint or
 *     a token count, so no future template change can leak one onto the page.
 *     What is technical is one press away, on the session itself.
 *   - **A day with nothing says so.** Grouped by whole local days with the empty
 *     ones present, because "nothing shipped on Tuesday" is a fact somebody is
 *     entitled to read, and a list that silently skips days reads as a list that
 *     is still loading.
 *   - **Green or not is on every row.** A board that only says what shipped is a
 *     board that flatters. Whether the checks passed when it went in — and
 *     whether somebody merged it anyway — is the one technical fact a
 *     non-engineer genuinely needs.
 *   - **Read-only, by construction.** There is nothing here that returns an id
 *     anything can act on: the session id is carried so a *link* can exist, and
 *     the page it links to is the one with the buttons on it.
 */

/** What a row says about the checks, in the three states a reader can act on. */
export type ShippedVerdict =
  /** The checks passed on the work that went in. */
  | 'green'
  /** They failed and somebody merged it anyway. The row says who. */
  | 'overridden'
  /** They failed, or errored, and it went in — without a recorded override. */
  | 'red'
  /** Nothing was ever run. Not the same as passing. */
  | 'unchecked'

export interface ShippedItem {
  /** Carried so a link can exist. Nothing on this page acts on it. */
  sessionId: string
  /** One sentence, from the summary written when the work finished. */
  what: string
  /** True when there was no summary and this is the session's own title. */
  fromTitle: boolean
  /** A display name — never an address, which is not for a wall. */
  who: string | null
  /** The repository, by name. Never a path and never a branch. */
  where: string | null
  verdict: ShippedVerdict
  at: number
}

export interface ShippedDay {
  /** `YYYY-MM-DD` in local time, which is the day people mean. */
  day: string
  /** Midnight local, for rendering a heading in the reader's own format. */
  at: number
  items: ShippedItem[]
}

export interface ShippedBoard {
  days: ShippedDay[]
  /** Whole days covered, so the page can say "the last fourteen days". */
  windowDays: number
  total: number
}

/** Enough of a session to build a row. Kept narrow so this stays testable. */
export interface ShippedSession {
  id: string
  title: string
  repoDir?: string
  summary?: { text: string }
  check?: { status: string } | null
  landed?: {
    at: number
    overrodeChecks?: boolean
    by?: Identity
  }
}

/**
 * The verdict, from what was recorded at the time.
 *
 * An override is its own answer rather than a flavour of red, because the two
 * are different news: one is "this went in broken", the other is "somebody
 * decided this could go in broken", and only the second has a person to ask.
 */
export function verdictOf(session: ShippedSession): ShippedVerdict {
  const status = session.check?.status

  if (session.landed?.overrodeChecks) return 'overridden'
  if (status === 'passing') return 'green'
  if (status === 'failing' || status === 'errored') return 'red'

  return 'unchecked'
}

/** Local calendar day, which is the unit a person means by "yesterday". */
export function dayKeyOf(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

function startOfDay(at: number): number {
  return new Date(at).setHours(0, 0, 0, 0)
}

/**
 * The board: every whole local day in the window, newest first, empty ones
 * included.
 *
 * The window is counted in whole days rather than in hours, because a board read
 * at 09:00 on a Monday should show the whole of Friday rather than the twelve
 * hours of it that fall inside a rolling week.
 */
export function buildShipped(
  sessions: ShippedSession[],
  opts: { now: number; days?: number },
): ShippedBoard {
  const windowDays = Math.max(1, Math.min(opts.days ?? 14, 90))
  const today = startOfDay(opts.now)
  const since = today - (windowDays - 1) * 86_400_000

  const items = sessions
    .filter(session => session.landed && session.landed.at >= since && session.landed.at <= opts.now)
    .map(session => item(session))
    .sort((a, b) => b.at - a.at)

  const byDay = new Map<string, ShippedItem[]>()
  for (const one of items) {
    const key = dayKeyOf(one.at)
    byDay.set(key, [...(byDay.get(key) ?? []), one])
  }

  const days: ShippedDay[] = []
  for (let back = 0; back < windowDays; back++) {
    const at = today - back * 86_400_000
    const day = dayKeyOf(at)
    days.push({ day, at, items: byDay.get(day) ?? [] })
  }

  return { days, windowDays, total: items.length }
}

/**
 * One sentence, punctuated.
 *
 * The summariser's own prompt says a trailing full stop is fine either way,
 * which is right for a line in a list and wrong for ten of them on a wall: half
 * the rows ending in a stop and half not reads as carelessness to exactly the
 * reader this page is for. Presentation, so it is done here rather than by
 * asking the model again.
 */
function asSentence(text: string): string {
  const trimmed = text.trim()

  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function item(session: ShippedSession): ShippedItem {
  const summary = session.summary?.text?.trim()

  return {
    sessionId: session.id,
    // The session's own title is the fallback rather than a branch name, and the
    // row says which it is — a title is what somebody typed, which reads as
    // English; a branch is not for this page at all.
    what: asSentence(summary || session.title),
    fromTitle: !summary,
    // A name, never an address. `personKey` is for grouping money; a wall gets
    // the thing a person is called.
    who: personName(session.landed?.by) ?? null,
    where: repoNameOf(session.repoDir),
    verdict: verdictOf(session),
    at: session.landed!.at,
  }
}

function repoNameOf(dir?: string): string | null {
  if (!dir) return null

  return repositoryRootOf(dir).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || null
}

/**
 * The sentence at the top, for a board that has nothing on it.
 *
 * A fortnight with nothing shipped is a true and useful thing to show somebody,
 * and it must not read as an error or as a page that failed to load. Said in the
 * same voice as a day with something in it.
 */
export function describeShipped(board: ShippedBoard): string {
  if (!board.total) {
    return `Nothing has shipped in the last ${board.windowDays} days.`
  }

  const withWork = board.days.filter(day => day.items.length).length

  return `${board.total} ${board.total === 1 ? 'thing' : 'things'} shipped on `
    + `${withWork} of the last ${board.windowDays} days.`
}
