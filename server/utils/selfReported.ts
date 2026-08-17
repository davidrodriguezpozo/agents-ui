/**
 * What a run said about itself.
 *
 * Everything else this app knows about a half-done run comes from the harness:
 * a tool was denied, a host was refused, the turns ran out. All of it is
 * something that happened *to* the run, observed from outside.
 *
 * There is a second kind, and it was invisible. A run can complete, be charged
 * for, return an outcome of `ok` — and have reached three of its six sources.
 * Nothing was denied; the connector answered with an authorization error, or a
 * workspace hit a usage limit mid-pull. The only record of it is a line the
 * model wrote in its own output, and until now nothing read those.
 *
 * The morning brief on this machine did exactly that: `ok`, $1.67, and a digest
 * saying "1 scheduled run went through without trouble" over a briefing whose
 * first three lines were Google Calendar, Gmail and the Notion tasks database
 * saying they were not there. One of its six ranked priorities came from Notion.
 *
 * The convention is the skill's, not ours — `/hd:goodmorning` is told to "note
 * it as a one-line `[SKIP]` in the briefing and continue", because a partial
 * brief beats no brief. That is the right instruction. Reading the marker is
 * the half that was missing.
 *
 * Why this matters more than it sounds: without it you cannot tell an empty
 * source from an absent one. "Slack is quiet" and no mention of Slack at all
 * look identical in a summary, and they mean opposite things.
 */

export interface SkippedSource {
  /** What could not be read — `Google Calendar`, `Notion tasks DB`. */
  source: string
  /** Why, in the run's own words. Empty when it did not say. */
  reason: string
}

/**
 * More than this and something has gone wrong with the output rather than with
 * the sources. The list is read at breakfast; it is not a log.
 */
const MOST = 8

/**
 * Written by a model, so matched loosely on purpose.
 *
 * The observed shape is ``​`[SKIP]` **Google Calendar** — connector not
 * authorized in this session``, but the skill only specifies "a one-line
 * `[SKIP]`". Bullets, bold, backticks and a plain unadorned marker all arrive,
 * and being strict about decoration would mean reading three sources one
 * morning and none the next for no reason a person could see.
 *
 * Anchored to the start of the line, after that decoration and nothing else: a
 * `[SKIP]` in the middle of a sentence is prose *about* skipping, and the skill
 * documenting its own convention is the most likely thing to say it.
 */
const MARKER = /^[-*+>\s]*[`*_]*\[SKIP\][`*_:]*\s*/i

/** ` **Google Calendar** ` → `Google Calendar`. */
function plain(text: string): string {
  return text.replace(/[`*_]/g, '').trim()
}

/**
 * Split the source from the reason.
 *
 * An em dash is what the skill writes and what a model reaches for, but a colon
 * or a hyphen mean the same thing here. Split on the first one only — reasons
 * contain dashes of their own, and taking the last would put half the sentence
 * in the name of the service.
 */
function split(line: string): SkippedSource {
  const at = line.search(/\s+[—–]\s+|\s+-\s+|:\s+/)
  if (at === -1) return { source: plain(line), reason: '' }

  const separator = line.slice(at).match(/^\s+[—–]\s+|^\s+-\s+|^:\s+/)![0]
  return {
    source: plain(line.slice(0, at)),
    reason: line.slice(at + separator.length).trim(),
  }
}

/**
 * The sources a run reported it could not read.
 *
 * Pure and cheap — a regex over the output, run once where a run is summarized,
 * so every list that shows runs gets it without asking for it.
 *
 * Fenced code is stepped over. A brief ends with a shell command to paste and a
 * run *about* this convention would quote it; neither is a source that failed.
 */
export function parseSkipped(output: string | undefined): SkippedSource[] {
  if (!output || !output.includes('[SKIP]')) return []

  const found: SkippedSource[] = []
  const seen = new Set<string>()
  let fenced = false

  for (const raw of output.split('\n')) {
    const line = raw.trim()

    if (line.startsWith('```') || line.startsWith('~~~')) {
      fenced = !fenced
      continue
    }
    if (fenced) continue

    const marker = line.match(MARKER)
    if (!marker) continue

    const entry = split(line.slice(marker[0].length).trim())
    if (!entry.source) continue

    // The same source skipped twice in one output is one fact. A chained ritual
    // whose every step reads the calendar is the case that produces it.
    const key = entry.source.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    found.push(entry)
    if (found.length >= MOST) break
  }

  return found
}

/**
 * The line that goes above the list.
 *
 * Says the consequence rather than the count. A number tells you three things
 * failed; the sentence tells you what to do with the rest of the brief, which
 * is the part you were about to act on.
 */
export function describeSkipped(skipped: SkippedSource[]): string {
  if (!skipped.length) return ''

  const names = skipped.map(entry => entry.source)
  const listed = names.length <= 3
    ? names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`

  return `Ran without ${listed}, so anything it did not mention from `
    + `${skipped.length === 1 ? 'that source' : 'those sources'} is missing rather than empty.`
}

/**
 * The output with the caveats taken out of it.
 *
 * For the preview line and nothing else — the full output is never edited, and
 * the caveats are not being hidden; they are being shown properly somewhere the
 * 160 characters of a list row cannot.
 *
 * Written first is right in the document and wrong in a preview. The one line
 * of this morning's brief that reached the Now page was most of an apology for
 * a connector, cut off mid-word — `No focus note given… [SKIP] Google Calendar
 * — connecto` — and the briefing it was previewing did not appear in it at all.
 */
export function withoutSkipped(output: string): string {
  if (!output.includes('[SKIP]')) return output

  const kept: string[] = []
  let fenced = false

  for (const raw of output.split('\n')) {
    const line = raw.trim()

    if (line.startsWith('```') || line.startsWith('~~~')) fenced = !fenced
    if (!fenced && MARKER.test(line)) continue

    kept.push(raw)
  }

  return kept.join('\n')
}
