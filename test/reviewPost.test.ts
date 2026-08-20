import { describe, expect, it } from 'vitest'
import { buildReview, guard, renderComment } from '../server/utils/reviewPost'
import type { DraftFinding, ReviewDraft } from '../server/utils/reviewDraft'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * What actually gets sent.
 *
 * `buildReview` is tested apart from the posting because the pane shows its
 * output as the preview — a preview assembled by different code from the thing
 * that posts is a preview that can lie about what you are about to say.
 */

function finding(over: Partial<DraftFinding> = {}): DraftFinding {
  return {
    id: '0:a.ts:1',
    location: 'a.ts:1',
    severity: 'BLOCKING',
    category: 'logic',
    body: 'the guard never runs',
    useSuggestion: false,
    include: true,
    anchor: { kind: 'inline', path: 'a.ts', line: 1, side: 'RIGHT' },
    ...over,
  }
}

function draft(over: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    sessionId: 's1',
    pr: 4812,
    headSha: '3f9ac2100000000000000000000000000000abcd',
    baseRef: 'master',
    event: 'COMMENT',
    summary: 'Solid apart from the one thing.',
    findings: [finding()],
    includeContext: false,
    violations: [],
    composedAt: 1,
    ...over,
  }
}

describe('buildReview', () => {
  it('sends one review with its comments inside, not a comment each', () => {
    const review = buildReview(draft({
      findings: [
        finding({ id: 'a', location: 'a.ts:1' }),
        finding({ id: 'b', location: 'b.ts:9', anchor: { kind: 'inline', path: 'b.ts', line: 9, side: 'RIGHT' } }),
      ],
    }))
    expect(review.comments).toHaveLength(2)
    expect(review.comments[0]).toMatchObject({ path: 'a.ts', line: 1, side: 'RIGHT' })
  })

  it('leaves out what is unchecked', () => {
    const review = buildReview(draft({ findings: [finding({ include: false })] }))
    expect(review.comments).toHaveLength(0)
  })

  /** An emptied body and an unchecked row are the same intent. */
  it('leaves out a body somebody emptied', () => {
    const review = buildReview(draft({ findings: [finding({ body: '   ' })] }))
    expect(review.comments).toHaveLength(0)
  })

  it('posts a file-level finding against the file rather than a line', () => {
    const review = buildReview(draft({
      findings: [finding({ anchor: { kind: 'file', path: 'a.ts', reason: 'line 9 is not in this diff' } })],
    }))
    expect(review.comments[0]).toMatchObject({ path: 'a.ts', subject_type: 'file' })
    expect(review.comments[0]).not.toHaveProperty('line')
  })

  /**
   * The failure this whole feature exists to avoid. A review that quietly
   * dropped its architectural finding reads as a review that did not have one.
   */
  it('folds an unanchorable finding into the body and says it did', () => {
    const review = buildReview(draft({
      findings: [finding({
        location: 'migrations/0042.sql',
        body: 'this has to run before the deploy',
        anchor: { kind: 'summary', reason: 'migrations/0042.sql is not in this diff' },
      })],
    }))
    expect(review.comments).toHaveLength(0)
    expect(review.folded).toBe(1)
    expect(review.body).toContain('this has to run before the deploy')
    expect(review.body).toContain('could not be attached to a line')
    expect(review.body).toContain('not in this diff')
  })

  it('keeps the reviewer\'s scope out unless it was asked for', () => {
    const withContext = draft({ context: 'Base: master   Commits: 3' })
    expect(buildReview(withContext).body).not.toContain('Commits: 3')
    expect(buildReview({ ...withContext, includeContext: true }).body).toContain('Commits: 3')
  })
})

describe('renderComment', () => {
  it('appends a suggestion rather than replacing the explanation', () => {
    const text = renderComment(finding({
      body: 'the assignment is above the comparison',
      suggestion: 'if (now - start > WINDOW) start = now',
      useSuggestion: true,
    }))
    expect(text).toContain('the assignment is above the comparison')
    expect(text).toContain('```suggestion\nif (now - start > WINDOW) start = now\n```')
  })

  it('leaves the suggestion out until it is turned on', () => {
    expect(renderComment(finding({ suggestion: 'x', useSuggestion: false }))).not.toContain('suggestion')
  })
})

describe('guard', () => {
  it('refuses a second send and names the first', async () => {
    const result = await guard(
      draft({ posted: { at: 1, url: 'https://github.com/o/r/pull/4812#pullrequestreview-1', event: 'COMMENT', comments: 2 } }),
      '/tmp',
    )
    expect(result.ok).toBe(false)
    expect((result as any).error).toBe('already_posted')
    expect((result as any).message).toContain('pullrequestreview-1')
  })

  /** An empty review notifies the author to come and read nothing. */
  it('refuses a review with nothing in it', async () => {
    const result = await guard(draft({ summary: '', findings: [finding({ include: false })] }), '/tmp')
    expect(result.ok).toBe(false)
    expect((result as any).error).toBe('nothing_to_post')
  })

  /**
   * Both refusals above are answered without asking GitHub, which is what lets
   * them be tested — and is also the right order: an accidental press should not
   * cost a network round trip.
   */
  it('answers the local refusals before it asks GitHub', async () => {
    // A directory with no git remote at all: reaching `gh` here would throw
    // rather than return a refusal, so a clean refusal proves it did not.
    const result = await guard(draft({ summary: '', findings: [] }), '/nonexistent-directory')
    expect((result as any).error).toBe('nothing_to_post')
  })
})
