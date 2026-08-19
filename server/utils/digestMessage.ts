import type { Digest, DigestRitual, DigestSession } from './digest'

/**
 * The morning report, written for somewhere that is not this app.
 *
 * The digest is the first thing you open, and the whole problem is that you do
 * not open it. A notification reaches you at the machine you were working on —
 * and the same sentence condemns the report it points at, which is a page on
 * that machine. A digest nobody reads is a digest that was not written.
 *
 * So it goes where you already are. Which makes this the first thing in the app
 * that composes text for another product, and everything below follows from two
 * constraints that do not apply to a Vue component:
 *
 *   - **It gets one glance.** A message with eleven sections is a message you
 *     scroll past. Three bands, in the order a person asks them: what needs me,
 *     what came out of it, what did it cost.
 *   - **It cannot be clicked into.** In the page, every row expands. Here the
 *     text is all there is, so a line has to carry its own reason — "Morning
 *     brief" means nothing, "Morning brief — refused Notion, so the job is half
 *     done" is the whole message.
 *
 * Pure, and separate from the sending, for the reason everything in this
 * codebase is: the judgement about what is worth saying should be testable
 * without a Slack workspace and without spending anything.
 */

/**
 * How many lines a band gets before it starts counting instead.
 *
 * Five is about what fits in a glance before Slack collapses the message behind
 * "show more" — and a band that has more than five things in it has already
 * said what it needs to. The number that follows is the useful part.
 */
export const MAX_PER_BAND = 5

/**
 * The most this will send.
 *
 * Slack accepts far more than this and will render it as a wall. The limit is
 * about the reader, not the API — a report that has to be scrolled has lost the
 * argument for being a message rather than a page.
 */
export const MESSAGE_LIMIT = 2_800

/** A ritual's own words about what it did, cut to a line that fits beside it. */
const PREVIEW_LIMIT = 110

/**
 * How long a stretch this covers, said without a clock.
 *
 * Deliberately a duration rather than a timestamp. A formatted time depends on
 * the timezone of whatever process happened to render it, which is a strange
 * thing for a test to have an opinion about — and Slack already stamps the
 * message with when it arrived, which is the only absolute time the reader
 * needs.
 */
export function windowLabel(since: number, now: number): string {
  const hours = Math.round(Math.max(0, now - since) / 3_600_000)

  if (hours <= 1) return 'the last hour'
  if (hours < 36) return `the last ${hours} hours`

  return `the last ${Math.round(hours / 24)} days`
}

/**
 * The three characters mrkdwn reads as markup for links and entities.
 *
 * Everything in a digest is a title somebody else wrote — a branch name, a
 * ritual called `deploy <staging>`. Left alone, that swallows the rest of the
 * line into a link Slack cannot resolve.
 */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** One line, cut where it stops being readable rather than mid-word if avoidable. */
export function oneLine(text: string, limit = PREVIEW_LIMIT): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat

  const cut = flat.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return `${space > limit * 0.6 ? cut.slice(0, space) : cut}…`
}

/** Money, at the precision the number deserves. */
function money(usd: number): string {
  if (usd <= 0) return '$0'
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

/** `• ` lines, with the tail counted rather than dropped silently. */
function band(lines: string[], limit = MAX_PER_BAND): string[] {
  if (lines.length <= limit) return lines

  const rest = lines.length - limit
  return [...lines.slice(0, limit), `_and ${rest} more_`]
}

/**
 * Why a ritual is in the first band, in its own words where it has them.
 *
 * `problem` is already a sentence written for a person — the digest builder
 * assembles it from what the run was refused or where it stopped. Repeating
 * that work here would give two features two opinions about the same morning.
 */
function ritualTrouble(item: DigestRitual): string {
  // Same alphabet as `sessionMark`, for the same reason: one band, one list.
  const mark = item.outcome === 'failed' ? ':x:' : ':warning:'
  const problem = oneLine(item.problem ?? 'It needs looking at.')

  // The offer, not the rules. Six `Bash(gh issue edit:*)` in a message is
  // unreadable, and granting them is something you do in the app anyway.
  const fix = item.suggestedRules?.length
    ? ` _${item.suggestedRules.length} rule${item.suggestedRules.length === 1 ? '' : 's'} would fix it_`
    : item.alreadyAllowed
      ? ' _already allowed since_'
      : ''

  return `${mark} *${escapeMrkdwn(item.title)}* — ${escapeMrkdwn(problem)}${fix}`
}

/** A ritual that worked, at the length a ritual that worked deserves. */
function ritualFine(item: DigestRitual): string {
  const preview = oneLine(item.preview ?? '', 90)
  const cost = item.costUsd ? ` · ${money(item.costUsd)}` : ''
  const partial = item.partial ? ` :grey_question: _${escapeMrkdwn(oneLine(item.partial, 90))}_` : ''

  return `• *${escapeMrkdwn(item.title)}*${cost}${preview ? ` — ${escapeMrkdwn(preview)}` : ''}${partial}`
}

/**
 * A session, described by what it produced rather than by its state.
 *
 * The summary is the sentence a small model wrote from the diff, and it is the
 * only part of a session a reader who is not at their machine can act on. The
 * check verdict follows it, because "it works" is worth nothing until you know
 * what "it" is.
 */
function sessionLine(item: DigestSession, lead = '•'): string {
  const words = item.check === 'failing'
    ? '_checks failed_'
    : item.check === 'errored'
      ? '_checks could not run_'
      : item.check === 'passing'
        ? '_checks pass_'
        : ''

  /*
   * The verdict keeps its own symbol only where the line does not already lead
   * with one. In the first band it does — `sessionMark` reads the same field —
   * and `:x: Broken thing … :x: checks failed` went out in a real message,
   * which reads as two problems on one line.
   */
  const mark = lead === '•' && words ? `${sessionMark(item)} ` : ''
  const verdict = words ? ` ${mark}${words}` : ''

  const behind = item.behindBase ? ' _behind its base_' : ''
  const summary = item.summary ? ` — ${escapeMrkdwn(oneLine(item.summary, 100))}` : ''

  return `${lead} *${escapeMrkdwn(item.title)}*${summary}${verdict}${behind}`
}

/**
 * It shipped.
 *
 * Its own line rather than a variant of the one below, because none of what that
 * one says applies: the check verdict describes a workspace whose work is now in
 * the base, and how far behind its base it was stopped mattering when it went in.
 * What is worth reading is the sentence about what it did, and where it went.
 */
function landedLine(item: DigestSession): string {
  const summary = item.summary ? ` — ${escapeMrkdwn(oneLine(item.summary, 100))}` : ''
  const how = ` :ship: _${escapeMrkdwn(oneLine(item.landed ?? 'landed', 60))}_`

  // Bullet-led with the marker where a verdict would sit, which is the shape
  // every other line in this band has. The first band leads with symbols and
  // this one leads with bullets; mixing them inside a band reads as two lists.
  return `• *${escapeMrkdwn(item.title)}*${summary}${how}`
}

/**
 * What marks a session out in the first band.
 *
 * Every line in that band leads with a symbol rather than a bullet, and the
 * mixture was visible the first time a real message went out: two lines about
 * two problems, one led by `:no_entry:` and one by `•`, which reads as two
 * different kinds of thing rather than as one list.
 */
function sessionMark(item: DigestSession): string {
  if (item.check === 'failing') return ':x:'
  if (item.check === 'errored') return ':grey_question:'
  // Reached from the second band, where a session is here because it worked. In
  // the first band this case does not arise: a passing session does not need you.
  if (item.check === 'passing') return ':white_check_mark:'
  return ':warning:'
}

/**
 * The report as one mrkdwn message.
 *
 * A quiet digest is not rendered here — the caller skips it rather than paying
 * to send "nothing happened", and the reason lives with the decision to spend
 * money. See `shouldSend`.
 */
export function renderDigest(digest: Digest, opts: { now?: number; url?: string } = {}): string {
  const now = opts.now ?? Date.now()
  const parts: string[] = []

  parts.push(`*While you were away* · _${windowLabel(digest.since, now)}_`)

  /*
   * Rendered rather than refused, because a forced send has to say something.
   *
   * `shouldSend` keeps this off the schedule — nobody wants a daily "nothing
   * happened". But somebody who pressed the button is owed a message, and an
   * empty one reads as a broken feature rather than as a quiet night.
   */
  if (digest.quiet) {
    parts.push('', 'Nothing ran and nothing is waiting on you.')
  }

  /*
   * Band one: everything whose next move is yours.
   *
   * Deliberately one band rather than four. A blocked ritual, a session with
   * failing checks and a ritual the scheduler switched off are different
   * problems with the same answer — go and look — and splitting them by
   * mechanism is a taxonomy for the app's benefit rather than the reader's.
   */
  const needsYou = [
    ...digest.rituals.filter(r => r.problem).map(ritualTrouble),
    ...digest.stopped.map(s =>
      `:no_entry: *${escapeMrkdwn(s.title)}* — stopped firing. ${escapeMrkdwn(oneLine(s.reason, 90))}`),
    ...digest.sessions.filter(s => s.state === 'needs-you')
      .map(session => sessionLine(session, sessionMark(session))),
  ]

  if (needsYou.length) {
    parts.push('', `*Needs you (${needsYou.length})*`, ...band(needsYou))
  }

  /*
   * Band two: what came out of it.
   *
   * Sessions before rituals, because a session that produced working code is
   * the thing you came back for and a ritual that worked is a ritual you do
   * not need to read.
   */
  const produced = [
    // Landed first, and above everything else in the band. It is the only line
    // here that describes work that is finished rather than work that is
    // waiting to be read.
    ...digest.sessions.filter(s => s.state === 'landed').map(landedLine),
    // Wrapped rather than passed by reference: `map` hands the callback an index
    // as its second argument, which `sessionLine` would take as the bullet.
    ...digest.sessions.filter(s => s.state === 'ready').map(session => sessionLine(session)),
    ...digest.rituals.filter(r => !r.problem).map(ritualFine),
  ]

  if (produced.length) {
    parts.push('', `*Came out of it (${produced.length})*`, ...band(produced))
  }

  /*
   * Band three: the absences.
   *
   * A morning with no briefing in it and no explanation anywhere is
   * indistinguishable from the thing being broken — which is the whole reason
   * the digest tracks these. They are not counted as needing you, because the
   * machine being asleep is not something to go and do.
   */
  const absent = [
    ...digest.missed.map(m => `• *${escapeMrkdwn(m.title)}* — its turn came round while nothing was running`),
    ...digest.gaps.map(g => `• *${escapeMrkdwn(g.title)}* — events went by unseen`),
  ]

  if (absent.length) {
    parts.push('', '*Did not happen*', ...band(absent, 3))
  }

  const working = digest.sessions.filter(s => s.state === 'working').length
  const still = working ? ` · ${working} still going` : ''
  parts.push('', `${money(digest.costUsd)} spent${still}`)

  /*
   * One link, at the bottom, rather than one per line.
   *
   * Every row in the page expands into the thing it is about, and the instinct
   * is to reproduce that here. But this server binds to loopback: a link to
   * `localhost:3000` opens nothing from the phone that is the reason this
   * feature exists, and a message where nine links out of ten are dead reads
   * as broken software. One link is honest — it works where it works, and the
   * message is complete without it.
   */
  if (opts.url) parts.push(`<${opts.url}|Open Agents Studio>`)

  return clamp(parts.join('\n'))
}

/**
 * Cut to length at a line boundary, saying that it was cut.
 *
 * Truncating mid-sentence is how a report ends up claiming something it does
 * not mean. Losing whole lines and admitting the count keeps every line that
 * survives true.
 */
export function clamp(text: string, limit = MESSAGE_LIMIT): string {
  if (text.length <= limit) return text

  const lines = text.split('\n')
  const kept: string[] = []
  let size = 0
  // Leaves room for the note that replaces what was dropped.
  const room = limit - 40

  for (const line of lines) {
    if (size + line.length + 1 > room) break
    kept.push(line)
    size += line.length + 1
  }

  const dropped = lines.length - kept.length
  return [...kept, '', `_${dropped} more line${dropped === 1 ? '' : 's'} — the rest is in the app._`]
    .join('\n')
}

/**
 * Whether this is worth sending, and why it is not when it is not.
 *
 * The only thing in this app that spends money and posts to somebody else's
 * product without being asked, so the bar is higher than "it is 08:15".
 *
 * A quiet window is the case that matters. Nothing ran, nothing was missed,
 * nothing is waiting — and a daily "nothing happened" is how a channel teaches
 * you to ignore it. Skipping is also the honest reading: `quiet` includes
 * missed occurrences and event gaps, so a morning where the machine was asleep
 * is *not* quiet and does get sent. Genuine silence means nothing was due.
 */
export function shouldSend(digest: Digest): { send: true } | { send: false; because: string } {
  if (digest.quiet) {
    return {
      send: false,
      because: 'Nothing happened in the window — no runs, nothing missed, nothing waiting. '
        + 'A daily message saying so is how a channel gets muted, so none was sent.',
    }
  }

  return { send: true }
}
