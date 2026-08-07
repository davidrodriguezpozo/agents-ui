import { describe, expect, it } from 'vitest'
import { createDeduper, describeFailure, isExpected } from '../app/utils/errorReporting'

/**
 * The net under every failure nobody caught. It is only worth having if it
 * stays quiet about the things that are not failures — an error on screen for
 * using the app correctly would teach everyone to ignore all of them, which is
 * worse than the silence it replaces.
 */

describe('isExpected', () => {
  it('ignores an abort', () => {
    // This app aborts streams constantly: every navigation away from a session
    // cancels its run stream, and each of those rejects.
    const aborted = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    expect(isExpected(aborted)).toBe(true)
  })

  it('ignores an abort that only says so in its message', () => {
    expect(isExpected(new Error('signal is aborted without reason'))).toBe(true)
    expect(isExpected(new Error('The user cancelled the request'))).toBe(true)
  })

  it('does not ignore a real failure', () => {
    expect(isExpected(new Error('500 Internal Server Error'))).toBe(false)
  })
})

describe('describeFailure', () => {
  it('says nothing about an expected rejection', () => {
    expect(describeFailure(Object.assign(new Error('x'), { name: 'AbortError' }))).toBeNull()
  })

  it('gives the server being gone its own words', () => {
    // Nearly always "you stopped it in the terminal". Reporting that as a bug
    // would send someone hunting for one that does not exist.
    const report = describeFailure(new Error('Failed to fetch'))
    expect(report?.title).toBe('Lost the app server')
  })

  it('carries the message the server actually sent', () => {
    const failure = { data: { message: 'That branch already exists.' } }
    expect(describeFailure(failure)?.description).toBe('That branch already exists.')
  })

  it('does not pretend to know what you were doing', () => {
    // A handled failure can say "could not remove that project". Anything that
    // reaches here cannot, and guessing would be worse than being generic.
    expect(describeFailure(new Error('boom'))?.title).toBe('Something failed quietly')
  })
})

describe('createDeduper', () => {
  it('lets the first one through and holds the repeat back', () => {
    // One broken poll is one broken poll every few seconds, and a stack of
    // identical toasts buries whatever else is on screen.
    const should = createDeduper(1000)
    expect(should('same', 0)).toBe(true)
    expect(should('same', 500)).toBe(false)
  })

  it('lets it through again once the window has passed', () => {
    const should = createDeduper(1000)
    expect(should('same', 0)).toBe(true)
    expect(should('same', 1500)).toBe(true)
  })

  it('never holds back a different failure', () => {
    const should = createDeduper(1000)
    expect(should('one', 0)).toBe(true)
    expect(should('two', 1)).toBe(true)
  })

  it('does not grow without bound', () => {
    const should = createDeduper(10)
    for (let i = 0; i < 200; i++) should(`key-${i}`, i * 100)
    // Still answering correctly after the pruning has run many times over.
    expect(should('fresh', 20_000)).toBe(true)
    expect(should('fresh', 20_001)).toBe(false)
  })
})
