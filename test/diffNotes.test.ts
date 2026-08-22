import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Notes are sentences somebody typed while reading a diff, and reading a diff is
 * exactly the activity that gets interrupted. The two ways they can be lost —
 * a reload, and two writes at once — are both decided here.
 */

let dir: string
let notes: typeof import('../server/utils/diffNotes')

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-diff-notes-'))
  process.env.CLAUDE_DIR = dir
  notes = await import('../server/utils/diffNotes')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
})

const note = (over: Partial<{ file: string; line: number; snippet: string; body: string }> = {}) => ({
  file: 'src/pricing.ts',
  line: 11,
  snippet: '+  return Math.round(base * (1 + rate))',
  body: 'Round half up explicitly.',
  ...over,
})

describe('notes on a session diff', () => {
  it('reads back what was written, so a reload does not cost you them', async () => {
    await notes.addNote('s1', note())
    await notes.addNote('s1', note({ line: 12, body: 'Drop this comment.' }))

    const saved = await notes.notesFor('s1')
    expect(saved.map(n => n.body)).toEqual(['Round half up explicitly.', 'Drop this comment.'])
    expect(saved.every(n => n.id && n.at)).toBe(true)
  })

  it('has nothing for a session nobody has written a note on', async () => {
    expect(await notes.notesFor('never-touched')).toEqual([])
  })

  it('keeps one session’s notes out of another’s', async () => {
    await notes.addNote('s1', note({ body: 'About this session.' }))
    await notes.addNote('s2', note({ body: 'About that one.' }))

    expect((await notes.notesFor('s1')).map(n => n.body)).toEqual(['About this session.'])
    expect((await notes.notesFor('s2')).map(n => n.body)).toEqual(['About that one.'])
  })

  it('keeps every note when several are written at once', async () => {
    // The real collision: clicking down a diff faster than the requests return.
    const bodies = ['one', 'two', 'three', 'four', 'five']
    await Promise.all(bodies.map(body => notes.addNote('s1', note({ body }))))

    const saved = await notes.notesFor('s1')
    expect(saved.map(n => n.body).sort()).toEqual([...bodies].sort())
  })

  it('gives every note an id of its own, even two on one line', async () => {
    await notes.addNote('s1', note({ body: 'First thought.' }))
    await notes.addNote('s1', note({ body: 'Second thought.' }))

    const saved = await notes.notesFor('s1')
    expect(new Set(saved.map(n => n.id)).size).toBe(2)
  })

  it('removes the one you changed your mind about and no others', async () => {
    await notes.addNote('s1', note({ body: 'Keep.' }))
    const [, second] = await notes.addNote('s1', note({ body: 'Drop.' }))

    const left = await notes.dropNote('s1', second!.id)
    expect(left.map(n => n.body)).toEqual(['Keep.'])
  })

  it('refuses a note with nothing written in it', async () => {
    await notes.addNote('s1', note({ body: '   ' }))

    expect(await notes.notesFor('s1')).toEqual([])
  })

  it('trims what you typed, so a stray newline is not part of the note', async () => {
    const [saved] = await notes.addNote('s1', note({ body: '  Round half up.\n' }))

    expect(saved!.body).toBe('Round half up.')
  })

  it('forgets every note once the turn carrying them has gone', async () => {
    await notes.addNote('s1', note())
    await notes.addNote('s2', note())

    expect(await notes.clearNotes('s1')).toEqual([])
    expect(await notes.notesFor('s1')).toEqual([])
    // A note sent is a note gone — for that session only.
    expect(await notes.notesFor('s2')).toHaveLength(1)
  })
})
