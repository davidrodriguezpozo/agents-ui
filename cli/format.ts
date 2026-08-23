import type { WorkStatus } from '~/utils/workList'
import type { WallUrgency } from '~/utils/wall'
import type { RunStatus } from './types'

/**
 * Turning the app's vocabulary into something a terminal can draw.
 *
 * The labels themselves are not decided here. `app/utils/sessionBadge.ts` is
 * the one tested place that decides what a session's state is called, and the
 * terminal reuses it rather than growing a second opinion — a row that says
 * "Checks pass" in the browser and "idle" here would make one of them a lie.
 * What this file adds is the part that genuinely differs: colour, width, and
 * how many lines fit.
 */

/** Ink's colour names, narrowed to the palette this app actually uses. */
export type Tone = 'cyan' | 'yellow' | 'red' | 'green' | 'gray' | 'white'

/**
 * The badge's colour, translated.
 *
 * Keyed on the CSS variable rather than the label, so renaming "Changes ready"
 * does not silently turn a row grey. The values come from `sessionBadge`.
 */
export function toneForBadge(badge: { color: string }): Tone {
  if (badge.color.includes('--accent')) return 'cyan'
  if (badge.color.includes('--warning')) return 'yellow'
  if (badge.color.includes('--error')) return 'red'
  if (badge.color.includes('34, 197, 94')) return 'green'
  return 'gray'
}

export function toneForRun(status: RunStatus): Tone {
  switch (status) {
    case 'running':
    case 'queued':
      return 'cyan'
    case 'completed':
      return 'green'
    case 'failed':
      return 'red'
    case 'cancelled':
      return 'gray'
  }
}

/**
 * The work list's coarse status, in the same colours the browser uses.
 *
 * `needs-you` is warning, not accent: that is the one that will not move until
 * you do something. `yours` is accent because it is your turn, not a problem.
 */
export function toneForWorkStatus(status: WorkStatus): Tone {
  switch (status) {
    case 'running':
      return 'cyan'
    case 'needs-you':
      return 'yellow'
    case 'yours':
      return 'cyan'
    // Merged and still on disk: the same green as done, because it is done —
    // what is left is closing the workspace, not deciding anything.
    case 'landed':
      return 'green'
    case 'done':
      return 'green'
    case 'failed':
      return 'red'
  }
}

export function toneForUrgency(urgency: WallUrgency): Tone {
  switch (urgency) {
    case 'needs-you':
      return 'yellow'
    case 'broken':
      return 'red'
    case 'working':
      return 'cyan'
    case 'settled':
      return 'gray'
  }
}

/** A unified-diff line, coloured the way every diff is coloured. */
export function toneForDiffLine(line: string): Tone {
  if (line.startsWith('+++') || line.startsWith('---')) return 'gray'
  if (line.startsWith('@@')) return 'cyan'
  if (line.startsWith('+')) return 'green'
  if (line.startsWith('-')) return 'red'
  return 'white'
}

/**
 * Text with everything that would move the cursor taken out.
 *
 * A terminal is not a canvas you draw on; it is a stream that some bytes
 * *command*. A carriage return in the middle of a session's text snaps the
 * cursor to column 0 and the rest of the line overwrites whatever was there —
 * which, in a two-column layout, is the rail. An escape sequence can change the
 * colour of everything after it, move the cursor anywhere, or retitle the
 * window.
 *
 * None of that is hypothetical: agents paste, tests print colour, progress bars
 * are made of `\r`, and this text arrives from the machine rather than from a
 * literal. A `\r` becomes the newline the author almost certainly meant, and
 * everything else that is not text is dropped.
 */
export function plain(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // CSI — colours and cursor moves.
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // OSC — window titles, hyperlinks, notifications, terminated either way.
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    // Anything else below a space, and the delete character.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}

/**
 * Cut a string to fit, with an ellipsis when something was lost.
 *
 * Ink will wrap or clip on its own, but neither is right for a list row: a
 * wrapped title silently makes one row two and pushes the rest of the list
 * down, and a clip gives no sign that there was more.
 */
export function truncate(text: string, width: number): string {
  const flat = plain(text).replace(/\s+/g, ' ').trim()
  if (width <= 0) return ''
  if (flat.length <= width) return flat
  return width <= 1 ? flat.slice(0, width) : `${flat.slice(0, width - 1)}…`
}

/**
 * Text as the rows it will occupy, hard-wrapped at `width`.
 *
 * Ink wraps for itself, but scrolling has to know how many lines there are
 * before it can decide which of them to show — and "how many lines" is a
 * different number from "how many newlines" the moment anything is long enough
 * to wrap. Doing the wrap here is what keeps the scroll position honest.
 */
export function toLines(text: string, width: number): string[] {
  if (width <= 0) return []

  const lines: string[] = []

  for (const paragraph of plain(text).split('\n')) {
    if (!paragraph.length) {
      lines.push('')
      continue
    }

    let rest = paragraph
    while (rest.length > width) {
      // Prefer a word boundary, but never lose a character to one: a run of
      // text with no spaces in it — a path, a stack frame — still has to break.
      const cut = rest.lastIndexOf(' ', width)
      const at = cut > width / 2 ? cut : width
      lines.push(rest.slice(0, at))
      rest = rest.slice(cut > width / 2 ? at + 1 : at)
    }
    lines.push(rest)
  }

  return lines
}

/**
 * The slice of `lines` to draw, given how far up the reader has scrolled.
 *
 * `offset` counts lines back from the bottom, because everything this scrolls
 * is a transcript: new output arrives at the end, and "where I was" means a
 * distance from the newest line rather than from the first.
 */
export function windowOf<T>(lines: T[], offset: number, height: number): T[] {
  if (height <= 0) return []
  const clamped = Math.min(Math.max(0, offset), maxOffset(lines.length, height))
  const end = lines.length - clamped
  return lines.slice(Math.max(0, end - height), end)
}

/** How far back scrolling may go before it is just showing the first line again. */
export function maxOffset(total: number, height: number): number {
  return Math.max(0, total - height)
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function spinnerFrame(tick: number): string {
  return SPINNER[tick % SPINNER.length]!
}

/** `~/code/thing` rather than `/Users/somebody/code/thing`. */
export function shortenHome(path: string, home: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

/**
 * Fit `text` into `width`, padding with spaces so columns line up.
 *
 * Ink will happily let adjacent `<Text>`s sit wherever the last glyph left
 * them, which is how a list that looks aligned at 80 columns falls apart at
 * 100. A padded string is one cell per character, which is what a column is.
 */
export function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (width <= 0) return ''
  const clipped = truncate(text, width)
  const gap = Math.max(0, width - clipped.length)
  return align === 'right' ? `${' '.repeat(gap)}${clipped}` : `${clipped}${' '.repeat(gap)}`
}

/**
 * The slice of a list that keeps `index` on screen.
 *
 * Transcripts scroll from the bottom (see `windowOf`); lists scroll around the
 * selected row. Same problem, opposite gravity.
 */
export function windowAround<T>(items: T[], index: number, height: number): T[] {
  if (height <= 0) return []
  if (items.length <= height) return items
  const start = Math.min(
    Math.max(0, index - Math.floor((height - 1) / 2)),
    items.length - height,
  )
  return items.slice(start, start + height)
}

/** How long ago, in a shape that fits a column: `now`, `2m`, `4h`, `3d`. */
export function compactAge(ts: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - ts) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 86_400 * 14) return `${Math.floor(seconds / 86_400)}d`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function matchesFilter(haystack: string, needle: string): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  return haystack.toLowerCase().includes(q)
}
