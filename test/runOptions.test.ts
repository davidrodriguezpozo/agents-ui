import { describe, expect, it } from 'vitest'
import { toQueryOptions } from '../server/utils/runOptions'

const base = {
  cwd: '/tmp', permissionMode: 'acceptEdits' as const, maxTurns: 10,
  loadSettings: true, plugins: [], systemAppend: '', agent: null,
}

describe('toQueryOptions', () => {
  it('passes a ritual allowlist through as settings.permissions.allow', () => {
    const opts = toQueryOptions({ ...base, allowRules: ['Bash(gh:*)', 'Read'] }) as any
    expect(opts.settings).toEqual({ permissions: { allow: ['Bash(gh:*)', 'Read'] } })
  })

  it('omits settings entirely when there is no allowlist', () => {
    // An empty settings object would still override what is on disk.
    expect((toQueryOptions({ ...base, allowRules: [] }) as any).settings).toBeUndefined()
  })

  it('still carries the permission mode alongside the allowlist', () => {
    const opts = toQueryOptions({ ...base, permissionMode: 'plan', allowRules: ['Read'] }) as any
    expect(opts.permissionMode).toBe('plan')
    expect(opts.settings.permissions.allow).toEqual(['Read'])
  })
})
