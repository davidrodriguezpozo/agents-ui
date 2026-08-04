import { describe, expect, it } from 'vitest'
import { formatReview, parsePatch } from '../app/utils/patch'

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

describe('turning comments into an instruction', () => {
  const comments = [
    { file: 'src/pricing.ts', line: 12, snippet: '+  // rounding added', body: 'Drop this comment.' },
    { file: 'src/pricing.ts', line: 11, snippet: '+  return Math.round(x)', body: 'Round half up explicitly.' },
    { file: 'src/cart.ts', line: 3, snippet: '+  let total', body: 'Should be const.' },
  ]

  it('groups by file and orders by line, the way you would read it', () => {
    const review = formatReview(comments)
    const pricing = review.indexOf('src/pricing.ts')
    const cart = review.indexOf('src/cart.ts')

    expect(pricing).toBeLessThan(cart)
    expect(review.indexOf('Line 11')).toBeLessThan(review.indexOf('Line 12'))
  })

  it('carries the line itself, so the note does not depend on line numbers holding still', () => {
    expect(formatReview(comments)).toContain('+  return Math.round(x)')
  })

  it('counts the comments so the reply knows how many to address', () => {
    expect(formatReview(comments)).toContain('I have 3 comments')
    expect(formatReview([comments[0]!])).toContain('I have 1 comment on')
  })

  it('invites disagreement rather than demanding compliance', () => {
    // A reviewer who is wrong should be told, not obeyed.
    expect(formatReview(comments)).toMatch(/disagree/)
  })

  it('produces nothing at all when there is nothing to say', () => {
    expect(formatReview([])).toBe('')
  })
})
