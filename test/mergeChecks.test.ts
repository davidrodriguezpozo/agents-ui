import { describe, expect, it } from 'vitest'
import { checkBlocks } from '../server/utils/merge'
import type { SessionCheck } from '../server/utils/checks'

function check(over: Partial<SessionCheck> = {}): SessionCheck {
  return {
    status: 'passing',
    command: 'make check',
    fingerprint: 'abc',
    exitCode: 0,
    output: '',
    durationMs: 10,
    at: 0,
    ...over,
  }
}

describe('checkBlocks', () => {
  it('blocks on a real failure', () => {
    expect(checkBlocks(check({ status: 'failing', exitCode: 1 }))).toBe(true)
  })

  it('blocks while the answer is still coming', () => {
    // Merging a moment before the verdict lands is the mistake this prevents.
    expect(checkBlocks(check({ status: 'running' }))).toBe(true)
  })

  it('does not block on a check that could not run', () => {
    // A workspace missing its dependencies says nothing about the change, and
    // blocking on it would teach people to override without reading.
    expect(checkBlocks(check({ status: 'errored', exitCode: 127 }))).toBe(false)
  })

  it('does not block when the checks pass', () => {
    expect(checkBlocks(check())).toBe(false)
  })

  it('does not block a project that has never run them', () => {
    expect(checkBlocks(null)).toBe(false)
    expect(checkBlocks(undefined)).toBe(false)
  })
})
