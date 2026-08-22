/**
 * Turning a unified diff back into something you can point at.
 *
 * The patch arrives as one string. To say "this line, in this file" — which is
 * what reviewing is — each line has to know which file it belongs to and which
 * line number it would be after the change. Both are recoverable from the diff
 * itself: `+++ b/path` names the file, and `@@ -a,b +c,d @@` says where the
 * next run of lines lands.
 */

export type PatchLineKind = 'add' | 'remove' | 'context' | 'hunk' | 'meta'

export interface PatchLine {
  text: string
  kind: PatchLineKind
  /** The file this line belongs to, once one has been named. */
  file?: string
  /** Line number in the changed file. Absent for removals and headers. */
  line?: number
}

/** The separator the diff endpoint inserts between committed and working changes. */
const UNCOMMITTED_MARKER = '--- Uncommitted ---'

export function parsePatch(patch: string): PatchLine[] {
  if (!patch) return []

  const lines: PatchLine[] = []
  let file: string | undefined
  let next = 0

  for (const text of patch.split('\n')) {
    // Our own separator, which would otherwise read as a file header.
    if (text === UNCOMMITTED_MARKER) {
      lines.push({ text, kind: 'meta' })
      file = undefined
      continue
    }

    if (text.startsWith('+++ ')) {
      const named = text.slice(4).trim()
      // `/dev/null` is a deletion; there is no file to comment on.
      file = named === '/dev/null' ? undefined : named.replace(/^b\//, '')
      lines.push({ text, kind: 'meta', file })
      continue
    }

    if (text.startsWith('@@')) {
      const match = text.match(/@@ -\d+(?:,\d+)? \+(\d+)/)
      next = match ? Number(match[1]) : 0
      lines.push({ text, kind: 'hunk', file })
      continue
    }

    if (text.startsWith('diff --git') || text.startsWith('--- ') || text.startsWith('index ')
      || text.startsWith('new file') || text.startsWith('deleted file') || text.startsWith('similarity ')
      || text.startsWith('rename ')) {
      lines.push({ text, kind: 'meta', file })
      continue
    }

    if (text.startsWith('+')) {
      lines.push({ text, kind: 'add', file, line: next })
      next++
      continue
    }

    if (text.startsWith('-')) {
      // A removed line has no place in the new file, but it is still worth
      // pointing at — the line it sat before is the useful anchor.
      lines.push({ text, kind: 'remove', file, line: next })
      continue
    }

    lines.push({ text, kind: 'context', file, line: next })
    if (text || lines.length) next++
  }

  return lines
}

/** One note, written against one line of the diff. See `server/utils/diffNotes.ts`. */
export interface DiffNote {
  id: string
  file: string
  line: number
  /** The line as it appeared when the note was written, for the pending list. */
  snippet: string
  body: string
  at: number
}

export interface ComposedNotes {
  /** The turn to send. Empty when nothing is left to say. */
  instruction: string
  /** The notes that went in, in the order they are written. */
  sent: DiffNote[]
  /** Notes whose line this diff no longer has. */
  dropped: DiffNote[]
  /** What to tell the person about those. Null when nothing was dropped. */
  droppedNote: string | null
}

/**
 * Gather notes into one instruction.
 *
 * One turn rather than one per note: each turn is a whole agent run, and review
 * notes are meant together — three remarks about the same change are a single
 * piece of feedback, and sending them separately invites three uncoordinated
 * rewrites.
 *
 * A note is checked against the diff on screen before it goes. Notes outlive the
 * turn they were written about — they are durable so a closed tab does not lose
 * them — so by the time somebody presses send, a line one of them points at may
 * have been rewritten out of existence. `path:line` for a line that is no longer
 * there sends the agent to whatever now sits at that number, which is worse than
 * saying nothing. So it is dropped, and `droppedNote` says which and why: a note
 * that vanished without a word is the failure this is avoiding, not the fix.
 *
 * An empty patch means the diff has not loaded, not that the diff is empty of
 * everything the notes point at. Nothing is dropped in that case — we cannot
 * tell, and guessing here throws away something a person typed.
 */
export function composeNotes(notes: DiffNote[], lines: PatchLine[]): ComposedNotes {
  if (!notes.length) return { instruction: '', sent: [], dropped: [], droppedNote: null }

  // File order is the diff's own — the order you read them on screen — and line
  // order within a file. A file the patch does not mention keeps its place after
  // the ones it does.
  const fileOrder = new Map<string, number>()
  const anchored = new Set<string>()
  for (const line of lines) {
    if (!line.file) continue
    if (!fileOrder.has(line.file)) fileOrder.set(line.file, fileOrder.size)
    if (line.line !== undefined) anchored.add(`${line.file}:${line.line}`)
  }

  const sent: DiffNote[] = []
  const dropped: DiffNote[] = []
  for (const note of notes) {
    if (lines.length && !anchored.has(`${note.file}:${note.line}`)) dropped.push(note)
    else sent.push(note)
  }

  sent.sort((a, b) => {
    const fileA = fileOrder.get(a.file) ?? fileOrder.size
    const fileB = fileOrder.get(b.file) ?? fileOrder.size
    if (fileA !== fileB) return fileA - fileB
    if (a.file !== b.file) return a.file < b.file ? -1 : 1
    return a.line - b.line
  })

  const droppedNote = dropped.length
    ? `${dropped.length === 1 ? 'One note was' : `${dropped.length} notes were`} not sent — `
      + `${dropped.map(n => `${n.file}:${n.line}`).join(', ')} `
      + `${dropped.length === 1 ? 'is' : 'are'} no longer in this diff.`
    : null

  if (!sent.length) return { instruction: '', sent, dropped, droppedNote }

  const framing = sent.length === 1
    ? 'I left a note on one line of the diff — address it, and if you disagree say so instead of changing it.'
    : `I left ${sent.length} notes on the diff — address each one, and if you disagree with any of them say so `
      + 'instead of changing it.'

  const body = sent.map(note => `\`${note.file}:${note.line}\`\n${note.body.trim()}`).join('\n\n')

  return { instruction: `${framing}\n\n${body}`, sent, dropped, droppedNote }
}
