import { describe, expect, it } from 'vitest'
import { parseStartRef } from '../server/utils/pullRequest'

/**
 * One field takes both a pull request and a branch, so the guess it makes is
 * the whole feature. Getting it wrong sends someone to a branch called "1234"
 * or looks up a pull request named after their branch.
 */

describe('recognising a pull request', () => {
  it('takes a URL straight from the address bar', () => {
    expect(parseStartRef('https://github.com/acme/monorepo/pull/5065'))
      .toEqual({ kind: 'pr', ref: '5065' })
  })

  it('copes with the tab you were actually on', () => {
    // Copying the URL while reading the diff is the common case.
    expect(parseStartRef('https://github.com/o/r/pull/12/files')).toEqual({ kind: 'pr', ref: '12' })
    expect(parseStartRef('https://github.com/o/r/pull/12/commits/abc')).toEqual({ kind: 'pr', ref: '12' })
  })

  it('works for an enterprise host, not just github.com', () => {
    expect(parseStartRef('https://git.internal.corp/team/app/pull/7')).toEqual({ kind: 'pr', ref: '7' })
  })

  it('takes the shorthand people use in conversation', () => {
    expect(parseStartRef('#5065')).toEqual({ kind: 'pr', ref: '5065' })
    expect(parseStartRef('5065')).toEqual({ kind: 'pr', ref: '5065' })
  })
})

describe('recognising a branch', () => {
  it('takes a plain branch name', () => {
    expect(parseStartRef('fix/cogs-per-product-calculation'))
      .toEqual({ kind: 'branch', ref: 'fix/cogs-per-product-calculation' })
  })

  it('strips a remote prefix, which names a tracking ref rather than a branch', () => {
    expect(parseStartRef('origin/build/typescript-7'))
      .toEqual({ kind: 'branch', ref: 'build/typescript-7' })
  })

  it('does not mistake the first segment of a nested branch for a remote', () => {
    // `feature/team/thing` is one branch, not `thing` on remote `feature`.
    expect(parseStartRef('feature/team/thing')).toEqual({ kind: 'branch', ref: 'feature/team/thing' })
  })

  it('leaves a branch whose name merely contains a slash alone', () => {
    // `fix/5065` is a branch, not pull request 5065.
    expect(parseStartRef('fix/5065')).toEqual({ kind: 'branch', ref: 'fix/5065' })
  })

  it('does not mistake a branch with digits for a number', () => {
    expect(parseStartRef('release-2024')).toEqual({ kind: 'branch', ref: 'release-2024' })
  })

  it('ignores surrounding whitespace from a paste', () => {
    expect(parseStartRef('  main  ')).toEqual({ kind: 'branch', ref: 'main' })
  })
})

describe('nothing to start from', () => {
  it('says so rather than guessing', () => {
    expect(parseStartRef('')).toBeNull()
    expect(parseStartRef('   ')).toBeNull()
  })
})
