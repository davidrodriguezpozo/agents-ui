import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'

/**
 * Notes written on a session's own diff, waiting to be sent as one turn.
 *
 * Reviewing a session's work used to mean typing a paragraph into the chat box
 * that repeated what the diff already said — "in pricing.ts, the rounding" —
 * because the only place to point at a line was prose. The Changes view can
 * point at lines directly, and this is where what you point at lives until you
 * press send.
 *
 * It is durable for the same reason a review draft is: it holds sentences
 * somebody typed. Notes were held in the page first, and reading a long diff is
 * exactly the activity that gets interrupted — the reload, the tab you closed to
 * look at something, the turn you started in another session. Losing four notes
 * to any of those teaches you not to write the fifth.
 *
 * A note here is not anchored. `anchorFor` decides where a *review comment* can
 * be posted because GitHub refuses a comment on a line outside the diff, and a
 * 422 loses the whole review; nothing is being posted here, so a note is stored
 * as the file and line the person clicked and checked against the diff once, at
 * the moment of sending, by `composeNotes`. Anchoring at write time would be
 * anchoring against a diff that is still moving.
 */

export interface DiffNote {
  /**
   * Stable for as long as it waits, so the row that shows a note is the row
   * that removes it. Position cannot do that job — the list is rewritten by
   * every add — and neither can file and line, since two notes on one line is a
   * normal thing to write.
   */
  id: string
  file: string
  line: number
  /** The line as it appeared when the note was written, for the pending list. */
  snippet: string
  body: string
  at: number
}

interface SessionNotes {
  sessionId: string
  notes: DiffNote[]
  updatedAt: number
}

interface NotesFile {
  sessions: SessionNotes[]
}

export const diffNoteStore = defineJsonStore<NotesFile>({
  label: 'diff notes',
  path: () => join(getClaudeDir(), 'agents-ui', 'diff-notes.json'),
  empty: () => ({ sessions: [] }),
  decode: (parsed: any) => ({
    sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
  }),
  encode: value => ({ version: 1, sessions: value.sessions }),
})

function noteId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export async function notesFor(sessionId: string): Promise<DiffNote[]> {
  const { sessions } = await diffNoteStore.read()
  return sessions.find(s => s.sessionId === sessionId)?.notes ?? []
}

/**
 * Add one note, and hand back the whole list.
 *
 * The list rather than the note, because that is what the page draws: a count
 * and the notes under it. Returning one and letting the page append it would
 * make the page's copy the truth, which is the thing this store exists to stop
 * being the case.
 */
export async function addNote(
  sessionId: string,
  note: { file: string; line: number; snippet: string; body: string },
): Promise<DiffNote[]> {
  const body = note.body.trim()
  if (!body || !note.file) return notesFor(sessionId)

  const added: DiffNote = {
    id: noteId(),
    file: note.file,
    line: note.line,
    snippet: note.snippet,
    body,
    at: Date.now(),
  }

  return diffNoteStore.update((file) => {
    const existing = file.sessions.find(s => s.sessionId === sessionId)
    if (existing) {
      existing.notes = [...existing.notes, added]
      existing.updatedAt = added.at
      return existing.notes
    }

    file.sessions.push({ sessionId, notes: [added], updatedAt: added.at })
    return [added]
  })
}

/** Remove one note — you changed your mind about it before sending. */
export async function dropNote(sessionId: string, noteId: string): Promise<DiffNote[]> {
  return diffNoteStore.update((file) => {
    const existing = file.sessions.find(s => s.sessionId === sessionId)
    if (!existing) return []

    existing.notes = existing.notes.filter(n => n.id !== noteId)
    existing.updatedAt = Date.now()
    return existing.notes
  })
}

/**
 * Forget every note for this session.
 *
 * Called by the page once the turn carrying them has been accepted, and by
 * discarding them by hand. A note sent is a note gone: there is no second round
 * on the same lines, because the turn it went in is the record of what was said.
 */
export async function clearNotes(sessionId: string): Promise<DiffNote[]> {
  return diffNoteStore.update((file) => {
    file.sessions = file.sessions.filter(s => s.sessionId !== sessionId)
    return []
  })
}
