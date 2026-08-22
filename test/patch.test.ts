import { describe, expect, it } from 'vitest'
import { composeNotes, parsePatch, type DiffNote } from '../app/utils/patch'

/**
 * Pointing at a line is the whole feature, so the line numbers have to be the
 * ones a person would count in the file — not positions in the patch.
 */

const PATCH = `diff --git a/src/pricing.ts b/src/pricing.ts
index 1111111..2222222 100644
--- a/src/pricing.ts
+++ b/src/pricing.ts
@@ -10,6 +10,7 @@ export function applyTax(amountCents: number, rate: number) {
 const base = amountCents
-  return base * (1 + rate)
+  return Math.round(base * (1 + rate))
+  // rounding added
 }
`

describe('reading a patch', () => {
  it('attributes every line to the file it belongs to', () => {
    const files = new Set(parsePatch(PATCH).filter(l => l.kind === 'add').map(l => l.file))

    expect([...files]).toEqual(['src/pricing.ts'])
  })

  it('numbers added lines as they will be in the changed file', () => {
    // The hunk starts at line 10, one context line precedes them.
    const added = parsePatch(PATCH).filter(l => l.kind === 'add')

    expect(added.map(l => l.line)).toEqual([11, 12])
  })

  it('classifies each kind of line', () => {
    const kinds = parsePatch(PATCH).map(l => l.kind)

    expect(kinds).toContain('meta')
    expect(kinds).toContain('hunk')
    expect(kinds).toContain('add')
    expect(kinds).toContain('remove')
    expect(kinds).toContain('context')
  })

  it('does not advance the line count for a removal', () => {
    // A removed line is not in the new file, so the line after it keeps the
    // number the removal was pointing at.
    const lines = parsePatch(PATCH)
    const removed = lines.find(l => l.kind === 'remove')!
    const firstAdd = lines.find(l => l.kind === 'add')!

    expect(removed.line).toBe(firstAdd.line)
  })

  it('treats our own uncommitted separator as a note, not a file header', () => {
    const lines = parsePatch(`${PATCH}--- Uncommitted ---\n`)
    const marker = lines.find(l => l.text === '--- Uncommitted ---')!

    expect(marker.kind).toBe('meta')
    expect(marker.file).toBeUndefined()
  })

  it('leaves a deletion with no file to comment on', () => {
    const lines = parsePatch('+++ /dev/null\n@@ -1,2 +0,0 @@\n-gone\n')

    expect(lines.find(l => l.kind === 'remove')?.file).toBeUndefined()
  })

  it('has nothing to say about an empty patch', () => {
    expect(parsePatch('')).toEqual([])
  })
})

/**
 * The composer is the whole of the feature the person sees: what they clicked
 * and typed has to come out as an instruction that reads like something they
 * would have written, and a note that no longer points anywhere has to be said
 * out loud rather than quietly left out.
 */

// Two files, pricing first, so "file order" can be told apart from
// "alphabetical" and from "the order the notes were written in".
const TWO_FILES = `diff --git a/src/pricing.ts b/src/pricing.ts
--- a/src/pricing.ts
+++ b/src/pricing.ts
@@ -10,1 +10,1 @@
-  return base * (1 + rate)
+  return Math.round(base * (1 + rate))
diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -3,1 +3,1 @@
-  let total = 0
+  const total = 0`

const WIDE = [
  'diff --git a/src/big.ts b/src/big.ts',
  '--- a/src/big.ts',
  '+++ b/src/big.ts',
  '@@ -1,0 +1,20 @@',
  ...Array.from({ length: 20 }, (_, i) => `+  const step${i + 1} = ${i + 1}`),
].join('\n')

let seq = 0

const note = (over: Partial<DiffNote> = {}): DiffNote => ({
  id: `n${seq++}`,
  file: 'src/pricing.ts',
  line: 10,
  snippet: '+  return Math.round(base * (1 + rate))',
  body: 'Round half up explicitly.',
  at: 1_000,
  ...over,
})

describe('turning notes into an instruction', () => {
  it('puts the notes in the order the diff puts their files', () => {
    // Written cart-first, on purpose: the order you wrote them in is not the
    // order you read them back in.
    const composed = composeNotes(
      [
        note({ file: 'src/cart.ts', line: 3, body: 'Should be const.' }),
        note({ file: 'src/pricing.ts', line: 10, body: 'Round half up explicitly.' }),
      ],
      parsePatch(TWO_FILES),
    )

    expect(composed.sent.map(n => n.file)).toEqual(['src/pricing.ts', 'src/cart.ts'])
    expect(composed.instruction.indexOf('src/pricing.ts:10'))
      .toBeLessThan(composed.instruction.indexOf('src/cart.ts:3'))
  })

  it('orders notes on one file by line', () => {
    const composed = composeNotes(
      [
        note({ file: 'src/big.ts', line: 12, body: 'Later.' }),
        note({ file: 'src/big.ts', line: 4, body: 'Earlier.' }),
      ],
      parsePatch(WIDE),
    )

    expect(composed.sent.map(n => n.line)).toEqual([4, 12])
  })

  it('writes one note as one note', () => {
    const composed = composeNotes([note({ body: 'Round half up explicitly.' })], parsePatch(TWO_FILES))

    expect(composed.instruction).toContain('a note on one line')
    expect(composed.instruction).toContain('`src/pricing.ts:10`')
    expect(composed.instruction).toContain('Round half up explicitly.')
    expect(composed.dropped).toEqual([])
  })

  it('carries all twenty when there are twenty', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      note({ file: 'src/big.ts', line: i + 1, body: `Note ${i + 1}.` }))

    const composed = composeNotes(many, parsePatch(WIDE))

    expect(composed.sent).toHaveLength(20)
    expect(composed.instruction).toContain('I left 20 notes on the diff')
    for (let line = 1; line <= 20; line++) {
      expect(composed.instruction).toContain(`\`src/big.ts:${line}\``)
      expect(composed.instruction).toContain(`Note ${line}.`)
    }
  })

  it('drops a note on a line the diff no longer contains, and says which', () => {
    const composed = composeNotes(
      [
        note({ line: 10, body: 'Still here.' }),
        note({ line: 99, body: 'The line this was about is gone.' }),
      ],
      parsePatch(TWO_FILES),
    )

    expect(composed.sent.map(n => n.line)).toEqual([10])
    expect(composed.dropped.map(n => n.line)).toEqual([99])
    expect(composed.droppedNote).toContain('src/pricing.ts:99')
    expect(composed.droppedNote).toContain('no longer in this diff')
    // Not silently folded in somewhere plausible.
    expect(composed.instruction).not.toContain('99')
    expect(composed.instruction).not.toContain('The line this was about is gone.')
  })

  it('drops a note on a file the diff never touched', () => {
    const composed = composeNotes(
      [note({ file: 'src/gone.ts', line: 1, body: 'Nowhere.' })],
      parsePatch(TWO_FILES),
    )

    expect(composed.instruction).toBe('')
    expect(composed.droppedNote).toContain('src/gone.ts:1')
  })

  it('drops nothing when there is no patch to check against', () => {
    // An empty patch is the diff not having loaded, not the diff being empty of
    // everything the notes point at. Throwing away typed sentences on that
    // reading would be the worst of the options.
    const composed = composeNotes([note({ line: 4_000 })], [])

    expect(composed.dropped).toEqual([])
    expect(composed.droppedNote).toBeNull()
    expect(composed.instruction).toContain('src/pricing.ts:4000')
  })

  it('invites disagreement rather than demanding compliance', () => {
    // A reviewer who is wrong should be told, not obeyed.
    expect(composeNotes([note()], parsePatch(TWO_FILES)).instruction).toMatch(/disagree/)
    expect(composeNotes([note(), note({ line: 10 })], parsePatch(TWO_FILES)).instruction)
      .toMatch(/disagree/)
  })

  it('frames the notes in one line, then gets out of the way', () => {
    const composed = composeNotes(
      [note({ line: 10, body: 'Round half up explicitly.' })],
      parsePatch(TWO_FILES),
    )
    const [framing, blank, location, body] = composed.instruction.split('\n')

    expect(framing).not.toContain('\n')
    expect(blank).toBe('')
    expect(location).toBe('`src/pricing.ts:10`')
    expect(body).toBe('Round half up explicitly.')
  })

  it('produces nothing at all when there is nothing to say', () => {
    const composed = composeNotes([], parsePatch(TWO_FILES))

    expect(composed.instruction).toBe('')
    expect(composed.droppedNote).toBeNull()
  })
})
