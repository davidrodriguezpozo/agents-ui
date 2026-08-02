import { describe, expect, it } from 'vitest'
import { errorCode, errorMessage, isOffline } from '../app/utils/errors'

describe('errorMessage', () => {
  it('reads createError({ message })', () => {
    expect(errorMessage({ data: { message: 'Agent not found: reviewer' } }))
      .toBe('Agent not found: reviewer')
  })

  it('reads createError({ data: { message } }) — the shape cli.ts throws', () => {
    expect(errorMessage({ data: { data: { error: 'cli_not_found', message: 'Claude Code CLI not found.' } } }))
      .toBe('Claude Code CLI not found.')
  })

  it('prefers the innermost message when both are present', () => {
    expect(errorMessage({
      data: { message: 'Internal Server Error', data: { message: 'That repository has no marketplace.json' } },
    })).toBe('That repository has no marketplace.json')
  })

  it('never surfaces ofetch noise to a person', () => {
    // This is what 24 call sites were showing users before.
    expect(errorMessage(new Error('[POST] "/api/marketplace/sources/add": 500 Internal Server Error')))
      .toBe('Something went wrong.')
    expect(errorMessage({ message: '[GET] "/api/runs": <no response> Failed to fetch' }))
      .toBe('Something went wrong.')
  })

  it('keeps a genuine Error message', () => {
    expect(errorMessage(new Error('Git is not installed'))).toBe('Git is not installed')
  })

  it('accepts a bare string', () => {
    expect(errorMessage('Could not save')).toBe('Could not save')
  })

  it('uses the caller fallback for empty or missing input', () => {
    expect(errorMessage(null, 'Could not load skills')).toBe('Could not load skills')
    expect(errorMessage({}, 'Could not load skills')).toBe('Could not load skills')
    expect(errorMessage({ data: { message: '   ' } }, 'Could not load skills')).toBe('Could not load skills')
  })

  it('trims stray whitespace', () => {
    expect(errorMessage({ data: { message: '  Already exists  ' } })).toBe('Already exists')
  })
})

describe('errorCode', () => {
  it('finds a machine-readable code', () => {
    expect(errorCode({ data: { data: { error: 'cli_not_found' } } })).toBe('cli_not_found')
    expect(errorCode({ data: { error: 'rate_limited' } })).toBe('rate_limited')
  })

  it('returns null when there is none', () => {
    expect(errorCode(new Error('boom'))).toBeNull()
    expect(errorCode({ data: { message: 'no code here' } })).toBeNull()
  })
})

describe('isOffline', () => {
  it('recognises the server being unreachable', () => {
    expect(isOffline(new Error('fetch failed'))).toBe(true)
    expect(isOffline(new Error('connect ECONNREFUSED 127.0.0.1:3000'))).toBe(true)
    expect(isOffline(new Error('Failed to fetch'))).toBe(true)
  })

  it('does not mistake a server-side failure for being offline', () => {
    expect(isOffline({ data: { message: 'Agent not found' } })).toBe(false)
  })
})
