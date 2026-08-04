import { describe, expect, it } from 'vitest'
import { isValidRepoRef } from '../server/utils/github'

/**
 * Owner and repo arrive from a request body and become a filesystem path:
 * `<claude dir>/github/<owner>/<repo>`. A `..` in either walks out of the only
 * directory this app should be writing to.
 */
describe('isValidRepoRef', () => {
  it('accepts names GitHub could actually have', () => {
    expect(isValidRepoRef('davidrodriguezpozo', 'agents-ui')).toBe(true)
    expect(isValidRepoRef('a', 'b')).toBe(true)
    expect(isValidRepoRef('some-org', 'repo.name_v2')).toBe(true)
  })

  it('refuses anything that would climb out of the directory', () => {
    expect(isValidRepoRef('..', 'x')).toBe(false)
    expect(isValidRepoRef('../..', 'x')).toBe(false)
    expect(isValidRepoRef('ok', '..')).toBe(false)
    expect(isValidRepoRef('ok', '.')).toBe(false)
    expect(isValidRepoRef('ok', '../../../etc')).toBe(false)
  })

  it('refuses separators and absolute paths', () => {
    expect(isValidRepoRef('a/b', 'c')).toBe(false)
    expect(isValidRepoRef('/etc', 'passwd')).toBe(false)
    expect(isValidRepoRef('a', 'b/c')).toBe(false)
  })

  it('refuses anything that is not a string', () => {
    expect(isValidRepoRef(undefined, 'x')).toBe(false)
    expect(isValidRepoRef('x', null)).toBe(false)
    expect(isValidRepoRef(42, 'x')).toBe(false)
  })

  it('refuses empty and over-long names', () => {
    expect(isValidRepoRef('', 'x')).toBe(false)
    expect(isValidRepoRef('x', '')).toBe(false)
    expect(isValidRepoRef('a'.repeat(40), 'x')).toBe(false)
  })
})
