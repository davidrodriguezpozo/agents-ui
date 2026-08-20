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
  /** Glyph plus its trailing space. */
  gutter: 2,
  /** The status label column in a session row. */
  status: 15,
  /** Branch column. */
  branch: 20,
  /** Right-hand metadata: files changed, age. */
  meta: 18,
} as const

/** How much of a list row each column gets at this terminal width. */
export function listLayout(columns: number) {
  const inner = Math.max(36, columns - LAYOUT.padding * 2)
  const branch = inner >= 92 ? 18 : inner >= 76 ? 12 : 0
  const meta = inner >= 70 ? 16 : 8
  const title = Math.max(10, inner - LAYOUT.gutter - LAYOUT.status - 2 - (branch ? branch + 2 : 0) - meta)
  return { inner, title, branch, meta }
}

/** Wide enough for a list and an inspector side by side. */
export function isWide(columns: number): boolean {
  return columns >= 110
}

/**
 * How many list items fit, given chrome above and below and how tall a row is.
 *
 * Two-line rows are the default now: a single-line list was the thing that
 * made every view look like a command palette.
 */
export function listCapacity(rows: number, chrome: number, lineHeight = 2): number {
  return Math.max(1, Math.floor(Math.max(1, rows - chrome) / lineHeight))
}
