/**
 * Turning things pointed at in the preview into one instruction.
 *
 * The same shape as `composeNotes` in `patch.ts`, for the same reason: three
 * remarks about one screen are a single piece of feedback, and sending them as
 * three turns invites three uncoordinated rewrites. What differs is what a note
 * is anchored to. A diff note has a file and a line; this has a selector, the
 * text the element showed and the box it occupied — the three things that let
 * an agent find it in the source without the screenshot nobody took.
 *
 * Nothing is dropped here. A diff note can outlive the line it points at, so
 * `composeNotes` checks; a note written against a page open on screen is about
 * that page, and the preview is running while the notes are being written.
 */

/** What the picker in the previewed page reports for one click. */
export interface PickedElement {
  selector: string
  tag: string
  /** The element's visible text, already collapsed to one line by the picker. */
  text: string
  /** The route it was on, so a note about Settings is not read as one about Home. */
  path: string
  box: { x: number, y: number, width: number, height: number }
}

export interface PointNote extends PickedElement {
  id: string
  body: string
  at: number
}

export interface ComposedPointNotes {
  /** The turn to send. Empty when there is nothing to say. */
  instruction: string
  /** The notes that went in, in the order they were written. */
  sent: PointNote[]
}

/** Enough of a label to recognise the element; past this it is the whole page. */
const MAX_TEXT = 120

function quoted(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (!one) return ''
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT)}…` : one
}

/**
 * One note, as the agent reads it.
 *
 * Selector first, then what the element looked like, then what the person said —
 * so the two lines the agent has to act on are the first and the last, and the
 * middle one is there for when the selector alone matches something that has
 * since moved.
 */
function describe(note: PointNote): string {
  const text = quoted(note.text)
  const size = note.box.width > 0 && note.box.height > 0
    ? `${note.box.width}×${note.box.height} at (${note.box.x}, ${note.box.y})`
    : ''

  let middle = ''
  if (text) middle = `A <${note.tag}> that reads "${text}"${size ? `, ${size}` : ''}.\n`
  else if (size) middle = `A <${note.tag}>, ${size}.\n`

  const head = note.path ? `\`${note.selector}\` on ${note.path}` : `\`${note.selector}\``

  return `${head}\n${middle}${note.body.trim()}`
}

/**
 * Gather what was pointed at into one turn.
 *
 * In the order they were pointed at, which is the order they are listed in and
 * the order somebody looked at the screen in. A diff has a file order to sort
 * by; a page does not, and inventing one out of the boxes would put a note about
 * the footer before a note about the header on a page that scrolls.
 *
 * A note with nothing typed in it is skipped rather than sent as a bare
 * selector: pointing at something is not on its own a complaint about it.
 */
export function composePointNotes(notes: PointNote[]): ComposedPointNotes {
  const sent = notes.filter(note => note.body.trim() && note.selector)
  if (!sent.length) return { instruction: '', sent: [] }

  const framing = sent.length === 1
    ? 'I pointed at one element in the running preview — find it in the source and fix it. '
      + 'If you disagree, say so instead of changing it.'
    : `I pointed at ${sent.length} elements in the running preview — address each one, and if you `
      + 'disagree with any of them say so instead of changing it. The selectors are from the live '
      + 'page, so find each one in the source rather than trusting the path.'

  return { instruction: `${framing}\n\n${sent.map(describe).join('\n\n')}`, sent }
}
