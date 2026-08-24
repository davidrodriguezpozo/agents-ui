import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isPending, pendingDrafts, retiredSince, type ReviewDraft } from '../server/utils/reviewDraft'
import { forgetLivePulls, retireStale, retirementFor, type LivePull } from '../server/utils/reviewRetire'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * When a composed review stops waiting to be sent.
 *
 * The band on Land used to answer this from the draft store alone, which knew
 * about exactly one ending: this app posting the review itself. Every other way
 * a review finishes — you answered the pull request from a browser tab, the
 * author merged it, three more pushes landed on it — left the row sitting there
 * looking like work, and a to-do list that lists finished work is one you stop
 * reading.
 *
 * `retirementFor` is the whole decision and it is pure, which is what makes it
 * testable at all: `gh` is not mocked anywhere in this repo, and the reading
 * around it is deliberately thin enough to be worth trusting on inspection.
 */

const COMPOSED = Date.parse('2026-08-24T15:00:00Z')
const NOW = Date.parse('2026-08-24T18:00:00Z')

function draft(over: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    sessionId: 's1',
    pr: 5442,
    headSha: '3f9ac2100000000000000000000000000000abcd',
    baseRef: 'master',
    event: 'COMMENT',
    summary: 'Reads fine apart from the one thing.',
    findings: [],
    includeContext: false,
    violations: [],
    composedAt: COMPOSED,
    ...over,
  }
}

function pull(over: Partial<LivePull> = {}): LivePull {
  return {
    number: 5442,
    state: 'OPEN',
    headRefOid: '3f9ac2100000000000000000000000000000abcd',
    reviewedByYouAt: null,
    ...over,
  }
}

describe('retirementFor', () => {
  it('leaves a review nobody has answered alone', () => {
    expect(retirementFor(draft(), pull(), NOW)).toBeNull()
  })

  it('retires one whose pull request has been merged', () => {
    const out = retirementFor(draft(), pull({ state: 'MERGED' }), NOW)
    expect(out?.reason).toBe('pr_closed')
    expect(out?.detail).toContain('merged')
  })

  /** The one this was built for: sent by hand, still on the list forever. */
  it('retires one you reviewed yourself after composing it', () => {
    const out = retirementFor(draft(), pull({ reviewedByYouAt: COMPOSED + 60_000 }), NOW)
    expect(out?.reason).toBe('already_reviewed')
  })

  /**
   * The asymmetry that makes the rule safe. Reviewing something in March and
   * asking for a fresh read of it in August is a draft that really is waiting,
   * so only a review that arrived *after* this one was written counts.
   */
  it('keeps one you reviewed before composing it', () => {
    expect(retirementFor(draft(), pull({ reviewedByYouAt: COMPOSED - 60_000 }), NOW)).toBeNull()
  })

  it('retires one composed against a commit that has been pushed over', () => {
    const out = retirementFor(draft(), pull({ headRefOid: 'ffffffffffffffffffffffffffffffffffffffff' }), NOW)
    expect(out?.reason).toBe('head_moved')
    expect(out?.detail).toContain('ffffffffffff')
  })

  /**
   * Both true at once is the common case — you review it, the author pushes the
   * fix. "You already did this" is the sentence that ends the question; "the
   * commit moved" is a detail about a job that is over.
   */
  it('says you already reviewed it rather than that the commit moved', () => {
    const out = retirementFor(
      draft(),
      pull({ reviewedByYouAt: COMPOSED + 60_000, headRefOid: 'ffffffffffffffffffffffffffffffffffffffff' }),
      NOW,
    )
    expect(out?.reason).toBe('already_reviewed')
  })

  it('says it is closed before anything else', () => {
    const out = retirementFor(
      draft(),
      pull({ state: 'CLOSED', reviewedByYouAt: COMPOSED + 60_000, headRefOid: 'ffffffffffffffffffffffffffffffffffffffff' }),
      NOW,
    )
    expect(out?.reason).toBe('pr_closed')
  })

  /** An empty state field is an answer that did not arrive, not a closed pull request. */
  it('does not read a missing state as closed', () => {
    expect(retirementFor(draft(), pull({ state: '' }), NOW)).toBeNull()
  })
})

describe('isPending', () => {
  it('drops a retired draft', () => {
    const retired = draft({ retired: { at: NOW, reason: 'already_reviewed', detail: 'you did' } })
    expect(isPending(draft())).toBe(true)
    expect(isPending(retired)).toBe(false)
  })

  it('still counts a review that is only a summary', () => {
    expect(isPending(draft({ findings: [], summary: 'Looks right to me.' }))).toBe(true)
    expect(isPending(draft({ findings: [], summary: '   ' }))).toBe(false)
  })
})

describe('against a store', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agents-ui-review-retire-'))
    process.env.CLAUDE_DIR = dir
  })

  afterAll(() => rm(dir, { recursive: true, force: true }))

  beforeEach(() => forgetLivePulls())

  async function seed(drafts: ReviewDraft[]) {
    await mkdir(join(dir, 'agents-ui'), { recursive: true })
    await writeFile(
      join(dir, 'agents-ui', 'review-drafts.json'),
      JSON.stringify({ version: 1, drafts }),
      'utf-8',
    )
  }

  it('leaves a retired draft out of the pending list and finds it by date', async () => {
    await seed([
      draft({ sessionId: 'live' }),
      draft({ sessionId: 'gone', retired: { at: NOW, reason: 'pr_closed', detail: 'merged' } }),
      draft({ sessionId: 'old', retired: { at: NOW - 5 * 86_400_000, reason: 'head_moved', detail: 'moved' } }),
    ])

    expect((await pendingDrafts()).map(d => d.sessionId)).toEqual(['live'])
    expect((await retiredSince(NOW - 86_400_000)).map(d => d.sessionId)).toEqual(['gone'])
  })

  /**
   * The rule that keeps this from losing work: a question that could not be
   * asked retires nothing. A directory with no repository in it is the cheapest
   * honest stand-in for `gh` being missing, signed out, or offline — all four
   * arrive here as the same "no reading".
   */
  it('retires nothing and counts it unchecked when the repository cannot be asked', async () => {
    await seed([draft({ sessionId: 'live' })])

    const result = await retireStale(
      [{ draft: draft({ sessionId: 'live' }), repoDir: join(dir, 'no-such-repository') }],
      NOW,
    )

    expect(result.unchecked).toBe(1)
    expect(result.retired).toHaveLength(0)
    expect(result.live.map(d => d.sessionId)).toEqual(['live'])
    // And nothing was written, so the next reading asks again rather than
    // inheriting a verdict nobody reached.
    expect((await pendingDrafts()).map(d => d.sessionId)).toEqual(['live'])
  })
})
