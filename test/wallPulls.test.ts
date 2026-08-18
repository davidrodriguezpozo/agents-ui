import { describe, expect, it } from 'vitest'
import { summarizeWallPulls } from '../server/utils/wallPulls'
import type { WallPull } from '../app/utils/wall'

/**
 * The figures the header states about pull requests.
 *
 * Worth pinning down for the reason the reviews page pins down `verdictFor`: this
 * screen has a strip of numbers along the top, and the whole value of that strip
 * is that a glance at it can be trusted without opening the panel below. A count
 * of "on you" that includes things that are not is how a screen teaches somebody
 * to stop reading it.
 *
 * `onYou` itself is decided on the server by `verdictFor` and is only carried
 * here, which is deliberate — see `flatten`. What is tested is the counting.
 */

function pull(over: Partial<WallPull> = {}): WallPull {
  return {
    repo: 'agents-ui',
    repoDir: '/repos/agents-ui',
    number: 7,
    title: 'Make it faster',
    url: `https://github.com/o/r/pull/${over.number ?? 7}`,
    author: 'someone',
    mine: false,
    draft: false,
    state: 'awaiting-review',
    label: 'Your review',
    detail: 'Nobody has reviewed it yet',
    onYou: false,
    createdAt: 1_000,
    updatedAt: 2_000,
    changedFiles: 3,
    checks: 'passing',
    unresolved: 0,
    awaiting: [],
    ...over,
  }
}

describe('summarizeWallPulls', () => {
  it('counts what is on you across both lists', () => {
    const summary = summarizeWallPulls(
      [pull({ number: 1, onYou: true })],
      [pull({ number: 2, mine: true, onYou: true }), pull({ number: 3, mine: true, onYou: false })],
    )

    expect(summary.onYou).toBe(2)
  })

  it('counts every review asked of you, on you or not', () => {
    // A draft somebody marked for review is not on you and is still a review
    // requested — the panel lists it, so the badge over the panel counts it.
    const summary = summarizeWallPulls(
      [pull({ number: 1, onYou: true }), pull({ number: 2, state: 'draft', onYou: false })],
      [],
    )

    expect(summary.toReview).toBe(2)
  })

  it('separates yours that are ready from yours that are waiting on somebody', () => {
    const summary = summarizeWallPulls([], [
      pull({ number: 1, mine: true, state: 'ready', onYou: true }),
      pull({ number: 2, mine: true, state: 'awaiting-review', onYou: false }),
      pull({ number: 3, mine: true, state: 'awaiting-review', onYou: false }),
    ])

    expect(summary.toMerge).toBe(1)
    expect(summary.waiting).toBe(2)
  })

  it('counts red CI only on your own work', () => {
    // Somebody else's failing branch is their problem, and a red figure on this
    // screen has to mean "yours is broken" or it is not worth a colour.
    const summary = summarizeWallPulls(
      [pull({ number: 1, state: 'checks-failing' })],
      [pull({ number: 2, mine: true, state: 'checks-failing', onYou: true })],
    )

    expect(summary.failing).toBe(1)
  })

  it('is all zeroes when nothing is open', () => {
    expect(summarizeWallPulls([], [])).toEqual({ onYou: 0, toReview: 0, toMerge: 0, waiting: 0, failing: 0 })
  })
})
