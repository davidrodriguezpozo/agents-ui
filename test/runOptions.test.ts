import { describe, expect, it } from 'vitest'
import { toQueryOptions } from '../server/utils/runOptions'

const base = {
  cwd: '/tmp', permissionMode: 'acceptEdits' as const, maxTurns: 10,
  loadSettings: true, plugins: [], systemAppend: '', agent: null,
  additionalDirectories: [],
  sandbox: { enabled: true, allowedDomains: [] },
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

  /**
   * A repository picked out of a larger folder keeps the rest of that folder
   * readable — the specs beside the app are usually the point of choosing the
   * parent. They are readable only: `cwd` is still the worktree, so git has
   * nothing to say about them and nothing there can be committed by accident.
   */
  it('passes extra readable directories through', () => {
    const opts = toQueryOptions({ ...base, allowRules: [], additionalDirectories: ['/work/specs'] }) as any
    expect(opts.additionalDirectories).toEqual(['/work/specs'])
    expect(opts.cwd).toBe('/tmp')
  })

  it('omits them entirely when there are none, rather than sending an empty list', () => {
    expect((toQueryOptions({ ...base, allowRules: [] }) as any).additionalDirectories).toBeUndefined()
  })

  it('still carries the permission mode alongside the allowlist', () => {
    const opts = toQueryOptions({ ...base, permissionMode: 'plan', allowRules: ['Read'] }) as any
    expect(opts.permissionMode).toBe('plan')
    expect(opts.settings.permissions.allow).toEqual(['Read'])
  })

  it('sandboxes the run, and does not let it out again', () => {
    const opts = toQueryOptions({ ...base, allowRules: [] }) as any
    expect(opts.sandbox.enabled).toBe(true)
    // The whole point: a run nobody is watching cannot decide to leave.
    expect(opts.sandbox.allowUnsandboxedCommands).toBe(false)
    expect(opts.sandbox.autoAllowBashIfSandboxed).toBe(true)
  })

  it('omits the sandbox entirely when a project has turned it off', () => {
    const opts = toQueryOptions({
      ...base, allowRules: [], sandbox: { enabled: false, allowedDomains: ['registry.npmjs.org'] },
    }) as any
    // Not `{ enabled: false }` — an absent key leaves no doubt about what ran.
    expect(opts.sandbox).toBeUndefined()
  })

  it('carries the hosts a project was told to allow', () => {
    const opts = toQueryOptions({
      ...base, allowRules: [], sandbox: { enabled: true, allowedDomains: ['registry.npmjs.org'] },
    }) as any
    expect(opts.sandbox.network.allowedDomains).toEqual(['registry.npmjs.org'])
    // Binding a port locally is ordinary work, not a way out.
    expect(opts.sandbox.network.allowLocalBinding).toBe(true)
  })
})
