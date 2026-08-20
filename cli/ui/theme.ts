import type { Tone } from '../format'

/**
 * What the terminal app looks like.
 *
 * One accent, used for the things you are meant to look at — the selected row,
 * a prompt waiting on you — and grey for everything that is merely there. The
 * temptation in a terminal is to draw a box around every region, which produces
 * something that looks busy and reads worse than the list it contains. So there
 * is one frame in this whole app, around the permission prompt, and the rest is
 * held together by alignment and space.
 *
 * The accent is the product's own indigo, in the value the dark theme uses —
 * `--accent` from `app/assets/css/main.css`. Most terminals are dark, and the
 * light-theme indigo disappears against one.
 */
export const ACCENT = '#7b7bea'

/**
 * The status glyph in the left gutter.
 *
 * A shape as well as a colour, deliberately. Colour alone says nothing on a
 * monochrome terminal, through a screen reader, or to the eight percent of men
 * who cannot separate the red one from the green one.
 */
export const GLYPH: Record<Tone, string> = {
  cyan: '●',
  green: '✓',
  red: '✕',
  yellow: '▲',
  gray: '○',
  white: '·',
}

/** Working is a spinner in the row, but a still frame of it has to exist too. */
export const WORKING_GLYPH = '◐'

/**
 * What marks the selected row.
 *
 * The same argument as the glyphs, applied to the one thing the glyphs did not
 * cover: selection was colour and weight only, so on a monochrome terminal — or
 * over a connection that has lost the accent to a 16-colour approximation — the
 * cursor was invisible. A bar in the margin is a shape.
 */
export const CURSOR = '▌'

/** Ink takes a hex or a name; the accent is a hex, the rest are names. */
export function inkColor(tone: Tone): string {
  return tone === 'cyan' ? ACCENT : tone
}

/**
 * The gutter, the left margin, and the space a row's metadata gets.
 *
 * Kept together because they have to agree: every pane indents by the same
 * amount, and a column that is two characters out is the difference between a
 * list that looks designed and one that looks emitted.
 */
export const LAYOUT = {
  /** Left margin for everything, so no text ever touches the edge. */
  padding: 2,
  /** The selection bar and its trailing space. */
  cursor: 2,
  /** Glyph plus its trailing space. */
  gutter: 2,
  /** The status label column in a session row. */
  status: 15,
  /** Branch column. */
  branch: 20,
  /** Right-hand metadata: files changed, age. */
  meta: 18,
} as const

/**
 * How tall each piece of chrome is.
 *
 * Every view used to carry its own guess — 11 here, 14 there, `rows - 12` in
 * the session pane — and a guess that is two out overflows the frame, which in
 * Ink means the terminal scrolls and you get half of the last frame left above
 * the new one. Naming the parts means the arithmetic can be checked by reading
 * it, and a view that grows a row says so in one place.
 *
 * `message` is reserved whether or not there is a message, so a pane does not
 * resize under you the moment something is said.
 */
export const CHROME = {
  /** The root box's own vertical padding, plus the line Ink keeps for itself. */
  frame: 3,
  /** The status line. */
  status: 1,
  message: 2,
  footer: 2,
  /** What the rail spends on saying what it is showing. */
  railHeader: 2,
  /** A pane's title line, and the status line under it with its air. */
  paneHeader: 4,
  /** A pane's own hint line. */
  paneFooter: 2,
  /** The "there is more below" line every scrolling pane can grow. */
  scrollNotice: 1,
  meters: 2,
  rule: 1,
  compose: 2,
} as const

/**
 * How many rows are left for the rail and the pane.
 *
 * One subtraction, in one place, from named parts. Every view used to carry its
 * own guess — 11 here, 14 there, `rows - 12` in the session pane — and a guess
 * two out overflows the frame, which in Ink means the terminal scrolls and half
 * of the last frame stays above the new one.
 */
export function contentHeight(rows: number, jobs = 0): number {
  return Math.max(
    4,
    rows - CHROME.frame - CHROME.status - CHROME.message - CHROME.footer - jobs,
  )
}

/** How wide the rail is: enough to read a title, never more than a third. */
export function railWidth(columns: number): number {
  return Math.max(28, Math.min(46, Math.floor(columns * 0.34)))
}

/** Below this, the rail and the pane take turns instead of sharing. */
export function isSplit(columns: number): boolean {
  return columns >= 100
}

/** How many rows of a list fit in a given height. */
export function rowsIn(height: number, lineHeight = 2): number {
  return Math.max(1, Math.floor(Math.max(lineHeight, height) / lineHeight))
}

/**
 * How many rail rows to draw.
 *
 * The rail spends lines on things that are not rows: a heading for each band it
 * passes through, and the line that says how many rows it did not draw. Asking
 * for the full height and then adding those pushes the last row off the bottom —
 * which is the good outcome, and only because nothing can be squeezed. Reserving
 * them is better than relying on that.
 */
export function railRowsIn(height: number, lineHeight: 2 | 3): number {
  const reserved = URGENCY_BANDS + 1
  return rowsIn(height - reserved, lineHeight)
}

/** How many bands a window can realistically show at once. */
const URGENCY_BANDS = 3

/**
 * How many lines of transcript or diff a session pane may draw.
 *
 * Its own chrome, added up here rather than guessed at the call site: a title, a
 * status line, the composer, the hint, and the row that says there is more below.
 * Two rows out is not a cosmetic problem — Ink draws the overflow on top of what
 * is already there, and the result reads as corruption.
 */
export function sessionBody(content: number): number {
  return Math.max(
    3,
    content - CHROME.paneHeader - CHROME.compose - CHROME.paneFooter - CHROME.scrollNotice,
  )
}

/** The same, for a run: no composer, so two rows more of output. */
export function runBody(content: number): number {
  return Math.max(3, content - CHROME.paneHeader - CHROME.paneFooter - CHROME.scrollNotice)
}

/**
 * Whether rows get a blank line between them.
 *
 * Two-line rows with nothing between them read as a wall at eight of them. A
 * tall terminal can afford the air; a short one cannot, and cramped beats
 * showing three sessions out of eleven.
 */
export function rowHeight(rows: number): 2 | 3 {
  return rows >= 34 ? 3 : 2
}

/** How much of a list row each column gets at this terminal width. */
export function listLayout(columns: number) {
  const inner = Math.max(36, columns - LAYOUT.padding * 2)
  const branch = inner >= 92 ? 18 : inner >= 76 ? 12 : 0
  const meta = inner >= 70 ? 16 : 8
  const title = Math.max(
    10,
    inner - LAYOUT.cursor - LAYOUT.gutter - LAYOUT.status - 2 - (branch ? branch + 2 : 0) - meta,
  )
  return { inner, title, branch, meta }
}

/** Wide enough for a list and an inspector side by side. */
export function isWide(columns: number): boolean {
  return columns >= 110
}

/** The list's share of a wide terminal, and the inspector's. */
export function splitWidths(columns: number, share = 0.52) {
  const list = Math.floor(columns * share)
  return { list, inspector: Math.max(24, columns - list - 8) }
}
