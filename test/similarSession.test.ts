import { describe, expect, it } from 'vitest'
import { findSimilar, similarity, SIMILAR_ENOUGH } from '../app/utils/similarSession'

/**
 * Built from three real pairs found on one machine, every pair started
 * twenty-one minutes apart and the second of each carrying typos the first
 * does not — retyped from memory, by someone who could not tell the work was
 * already underway.
 */
const REAL_PAIRS: [string, string][] = [
  ['Allow users to start new posts every day', 'Allow users to start new posts every day'],
  ['Add a daily recommendation page', 'Add a daily recommendations page'],
  ['Allow users to have profile pictures', 'allow users to have profiel pictures'],
]

function session(over: Partial<Parameters<typeof findSimilar>[1][number]> = {}) {
  return {
    id: 's1',
    title: 'Add a daily recommendation page',
    repoDir: '/repo',
    status: 'idle',
    updatedAt: 0,
    ...over,
  }
}

describe('similarity', () => {
  it('catches every pair that actually happened', () => {
    for (const [a, b] of REAL_PAIRS) {
      expect(similarity(a, b), `${a} vs ${b}`).toBeGreaterThanOrEqual(SIMILAR_ENOUGH)
    }
  })

  it('survives a typo, which word matching would not', () => {
    // "profiel" and "profile" are different words and nearly the same letters,
    // so comparing words would score this zero.
    expect(similarity('profile pictures', 'profiel pictures')).toBeGreaterThan(0.6)
  })

  it('is surer about a typo the more context there is around it', () => {
    // Two words with a letter swapped is genuinely a weaker signal than a whole
    // sentence with one — which is why the short form sits under the threshold
    // and the real pair, a full instruction, sits over it.
    const short = similarity('profile pictures', 'profiel pictures')
    const full = similarity(
      'Allow users to have profile pictures',
      'allow users to have profiel pictures',
    )
    expect(short).toBeLessThan(SIMILAR_ENOUGH)
    expect(full).toBeGreaterThan(SIMILAR_ENOUGH)
  })

  it('ignores case and punctuation', () => {
    expect(similarity('Add a page.', 'add a page')).toBe(1)
  })

  it('keeps genuinely different work apart', () => {
    const pairs: [string, string][] = [
      ['Add a daily recommendation page', 'Fix the failing CI on this branch'],
      ['Allow users to have profile pictures', 'Allow users to delete their account'],
      ['Write the release notes', 'Update the README'],
    ]
    for (const [a, b] of pairs) {
      expect(similarity(a, b), `${a} vs ${b}`).toBeLessThan(SIMILAR_ENOUGH)
    }
  })

  it('does not call two sessions about the same file the same job', () => {
    // Too eager and the notice appears constantly, which makes it worthless.
    const score = similarity('Add tests for the parser', 'Fix a bug in the parser')
    expect(score).toBeLessThan(SIMILAR_ENOUGH)
  })
})

describe('findSimilar', () => {
  it('finds what you already asked for', () => {
    const hit = findSimilar('Add a daily recommendations page', [session()], '/repo')
    expect(hit?.session.id).toBe('s1')
  })

  it('says nothing when there is nothing like it', () => {
    expect(findSimilar('Rewrite the deploy script', [session()], '/repo')).toBeNull()
  })

  it('does not look across projects', () => {
    // The same sentence against two repositories is two different jobs.
    expect(findSimilar('Add a daily recommendation page', [session()], '/other')).toBeNull()
  })

  it('ignores work that is already finished', () => {
    // Asking again after something is closed is the obvious thing to do.
    const archived = [session({ status: 'archived' })]
    expect(findSimilar('Add a daily recommendation page', archived, '/repo')).toBeNull()
  })

  it('stays quiet until there is enough to compare', () => {
    // Mid-typing, two words match half the things you have ever asked for.
    expect(findSimilar('Add a', [session()], '/repo')).toBeNull()
  })

  it('needs a project before it can compare anything', () => {
    expect(findSimilar('Add a daily recommendation page', [session()], null)).toBeNull()
  })

  it('returns the closest when several are close', () => {
    const hit = findSimilar('Add a daily recommendations page', [
      session({ id: 'near', title: 'Add a daily recommendation pages' }),
      session({ id: 'exact', title: 'Add a daily recommendations page' }),
    ], '/repo')
    expect(hit?.session.id).toBe('exact')
  })
})
