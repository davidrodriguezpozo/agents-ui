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
  header: 1,
  tabs: 3,
  message: 2,
  footer: 2,
  chips: 2,
  meters: 2,
  rule: 1,
  filter: 2,
  compose: 2,
  /** Title, a few lines and the divider, when the inspector sits under a list. */
  inspector: 7,
} as const

/**
 * How many rows a list may draw, given what else is on screen.
 *
 * `extras` are the `CHROME` pieces this particular view adds. Passing them in
 * rather than branching on view name keeps the one subtraction honest.
 */
export function listCapacity(rows: number, extras: number[] = [], lineHeight = 2): number {
  const chrome = CHROME.frame + CHROME.header + CHROME.tabs + CHROME.message + CHROME.footer
    + extras.reduce((total, extra) => total + extra, 0)
  return Math.max(1, Math.floor(Math.max(lineHeight, rows - chrome) / lineHeight))
}

/** How many lines a full-height pane — a transcript, a diff — may draw. */
export function paneHeight(rows: number, extras: number[] = []): number {
  const chrome = CHROME.frame + CHROME.header + CHROME.message + CHROME.footer
    + extras.reduce((total, extra) => total + extra, 0)
  return Math.max(1, rows - chrome)
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
