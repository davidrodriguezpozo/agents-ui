import { escapeMrkdwn, oneLine } from './digestMessage'
import type { Decision, DecisionAlternative, DecisionSource } from './decisions'

/**
 * A decision, written for somewhere that is not this app.
 *
 * `notifyBus.ts` states the limit in its own words — *"a browser that is shut
 * posts nothing"* — and unit 39's records are the proof of it: perfect, and
 * unread, on one laptop.
 *
 * `digestMessage.ts` solved this shape once and its two constraints are
 * inherited here verbatim, because both apply harder to a decision than to a
 * morning report:
 *
 *   - **It gets one glance.** A card is the decision, the roads it had, the
 *     reason or its absence, the files, and nothing else. There is no fifth
 *     thing worth the scroll.
 *   - **It cannot be clicked into.** Every line carries its own reason. "Used a
 *     queue" means nothing; "Used a queue over a lock — jsonStore already
 *     serialises by path" is the whole message.
 *
 * And one that is this unit's own. The best reviewer of a *product* decision is
 * often not an engineer: a designer or a PM will never have this repository
 * cloned, and a review system that can only reach people who do has quietly
 * decided that product decisions get reviewed by whoever happens to have a
 * checkout. So the card has to stand alone — no paths into a UI that the reader
 * cannot open, no ids, no jargon from the harness.
 *
 * Pure, and separate from the sending, like every composer here: the judgement
 * about what is worth saying is testable without a Slack workspace and without
 * spending anything.
 */

/** Enough of a decision to read at a glance; the record keeps the whole of it. */
const WHAT_LIMIT = 220

/** An alternative is a label, not an essay. */
const ALTERNATIVE_LIMIT = 90

/** A reason somebody typed in a hurry, at the length a hurry produces. */
const REASON_LIMIT = 300

/**
 * How many roads a card will name before it counts the rest.
 *
 * Four, because a question with more options than that was a question nobody
 * could answer either, and the card is not the place to relitigate it.
 */
const MAX_ALTERNATIVES = 4

/** Files, at the number that still reads as a list rather than a manifest. */
const MAX_FILES = 5

/**
 * The most this will send. Slack accepts far more and renders it as a wall.
 *
 * Smaller than the digest's limit on purpose: that is a report about a morning
 * and this is one choice. A card that has to be scrolled has stopped being a
 * card.
 */
export const CARD_LIMIT = 1_600

/**
 * What kind of moment this was, in words a reader with no checkout knows.
 *
 * Never the source name itself. `ask_user_question` is the name of a tool in a
 * harness the reader has never heard of, and a card that opens with it has
 * spent its first line explaining this app instead of the decision.
 */
const OCCASION: Record<DecisionSource, string> = {
  ask_user_question: 'Asked, and answered',
  denied: 'Refused',
  steer: 'Corrected mid-work',
  marker: 'Decided while working',
}

/**
 * The roads, with the taken one marked.
 *
 * A decision with none says so rather than rendering an empty list — a card
 * with a heading and nothing under it reads as a bug in the sender, and "no
 * alternatives recorded" is a true and useful sentence: it means this was a
 * choice nobody was offered options for.
 */
function alternativeLines(alternatives: DecisionAlternative[]): string[] {
  if (!alternatives.length) return []

  const shown = alternatives.slice(0, MAX_ALTERNATIVES).map((alternative) => {
    const mark = alternative.chosen ? ':white_check_mark:' : ':heavy_minus_sign:'
    const what = escapeMrkdwn(oneLine(alternative.what, ALTERNATIVE_LIMIT))
    const detail = alternative.detail
      ? ` — _${escapeMrkdwn(oneLine(alternative.detail, ALTERNATIVE_LIMIT))}_`
      : ''
    return `${mark} ${what}${detail}`
  })

  const rest = alternatives.length - MAX_ALTERNATIVES
  return rest > 0 ? [...shown, `_and ${rest} more_`] : shown
}

/**
 * The reason, or the fact that there is not one.
 *
 * *No reason given* is a sentence this unit refuses to hide, and it is the
 * decision unit 40 defends: a reviewer seeing an unexplained choice has learned
 * something real — either it was obvious, or nobody could say why, and both are
 * worth knowing. An empty field would say neither.
 */
function reasonLine(decision: Decision): string {
  return decision.reason?.trim()
    ? `*Why:* ${escapeMrkdwn(oneLine(decision.reason, REASON_LIMIT))}`
    : '*Why:* _no reason given_'
}

/** The files it named itself. Never a diff, never a path into anybody's disk. */
function fileLine(files: string[]): string | null {
  const named = files.filter(file => file.trim()).slice(0, MAX_FILES)
  if (!named.length) return null

  const rest = files.length - named.length
  const list = named.map(file => `\`${escapeMrkdwn(file)}\``).join(' ')
  return rest > 0 ? `${list} _and ${rest} more_` : list
}

export interface CardContext {
  /** The session's own title, so the reader knows what work this is about. */
  sessionTitle?: string
  /** Who took it, as a person is named rather than as an address. */
  by?: string
}

/**
 * One decision, as a message.
 *
 * Returns null for a decision with nothing readable in it. Nothing composes a
 * card out of a record it cannot describe — the same rule as everywhere else in
 * this system, and here it also protects a colleague's channel from a message
 * that says nothing.
 */
export function renderDecision(decision: Decision, context: CardContext = {}): string | null {
  const what = oneLine(decision.what, WHAT_LIMIT)
  if (!what) return null

  const lines: string[] = []

  const where = context.sessionTitle ? ` · ${escapeMrkdwn(oneLine(context.sessionTitle, 80))}` : ''
  const who = context.by ? ` · ${escapeMrkdwn(oneLine(context.by, 40))}` : ''
  lines.push(`*${OCCASION[decision.source]}*${where}${who}`)
  lines.push(`> ${escapeMrkdwn(what)}`)

  const roads = alternativeLines(decision.alternatives)
  if (roads.length) lines.push(roads.join('\n'))

  lines.push(reasonLine(decision))

  const files = fileLine(decision.files)
  if (files) lines.push(files)

  // The one sentence that tells a reader with no checkout what to do with this.
  // Without it the card is an announcement, and an announcement is not a review.
  lines.push('_Reply in this thread to say what you think. It reaches the work._')

  const card = lines.join('\n')
  return card.length <= CARD_LIMIT ? card : `${card.slice(0, CARD_LIMIT - 1)}…`
}

/**
 * Whether a decision is worth anybody's attention.
 *
 * Two are not, and both would train a reader to ignore the channel. A steer
 * that interrupted nothing is an ordinary instruction wearing a decision's
 * clothes — see `steerDecision`, which records it with no alternatives — and a
 * decision with nothing to say has already failed `renderDecision`.
 */
export function worthSending(decision: Decision): boolean {
  if (!decision.what.trim()) return false
  if (decision.source === 'steer' && !decision.alternatives.length) return false
  return true
}
