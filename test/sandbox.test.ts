import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Sandboxing is on by default, which makes the failure that matters here
 * *quietly ending up unsandboxed*: a damaged file, a missing key, or a config
 * written before this existed must all resolve to "sandboxed", never to "off".
 * Off has to be somebody's decision, recorded on purpose.
 */

let dir: string
let store: typeof import('../server/utils/sandbox')

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-sandbox-'))
  process.env.CLAUDE_DIR = dir
  store = await import('../server/utils/sandbox')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
})

describe('what a project gets when nobody has said', () => {
  it('sandboxes a project that has never been configured', async () => {
    const resolved = await store.sandboxForProject('/repo/never-configured')
    expect(resolved.enabled).toBe(true)
    expect(resolved.source).toBe('default')
  })

  it('sandboxes a run with no project at all', async () => {
    // Work against your own ~/.claude is still a shell running unattended.
    const resolved = await store.sandboxForProject(undefined)
    expect(resolved.enabled).toBe(true)
  })

  it('allows no hosts by default', async () => {
    const resolved = await store.sandboxForProject('/repo/never-configured')
    expect(resolved.allowedDomains).toEqual([])
  })
})

describe('what a project was told', () => {
  it('remembers being turned off, and says it was chosen', async () => {
    await store.setProjectSandbox('/repo/a', { enabled: false })

    const resolved = await store.sandboxForProject('/repo/a')
    expect(resolved.enabled).toBe(false)
    expect(resolved.source).toBe('configured')
  })

  it('does not leak a decision into another project', async () => {
    await store.setProjectSandbox('/repo/a', { enabled: false })

    // Turning it off for one repository must say nothing about the next.
    await expect(store.sandboxForProject('/repo/b')).resolves.toMatchObject({ enabled: true })
  })

  it('keeps the hosts when only the switch is changed', async () => {
    await store.setProjectSandbox('/repo/a', { allowedDomains: ['registry.npmjs.org'] })
    await store.setProjectSandbox('/repo/a', { enabled: false })

    const resolved = await store.sandboxForProject('/repo/a')
    expect(resolved.allowedDomains).toEqual(['registry.npmjs.org'])
  })

  it('forgets the choice entirely when reset, so the default applies again', async () => {
    await store.setProjectSandbox('/repo/a', { enabled: false })
    await store.clearProjectSandbox('/repo/a')

    await expect(store.sandboxForProject('/repo/a')).resolves.toMatchObject({
      enabled: true,
      source: 'default',
    })
  })

  it('drops blank and duplicate hosts rather than storing them', async () => {
    const saved = await store.setProjectSandbox('/repo/a', {
      allowedDomains: ['  registry.npmjs.org  ', '', 'registry.npmjs.org', '   '],
    })
    expect(saved.allowedDomains).toEqual(['registry.npmjs.org'])
  })
})

describe('when the file cannot be trusted', () => {
  it('sandboxes rather than reading damage as permission', async () => {
    await mkdir(join(dir, 'agents-ui'), { recursive: true })
    await writeFile(join(dir, 'agents-ui', 'project-sandbox.json'), '{ not json at all')

    await expect(store.sandboxForProject('/repo/a')).resolves.toMatchObject({ enabled: true })
  })

  it('treats a config written before this existed as sandboxed', () => {
    // The key is simply absent — which says nothing, and must not read as "no".
    expect(store.normaliseSandbox({ allowedDomains: ['example.com'] }).enabled).toBe(true)
  })

  it('ignores a non-boolean switch', () => {
    expect(store.normaliseSandbox({ enabled: 'yes' }).enabled).toBe(true)
  })
})

/**
 * Sandboxing arrived switched on and reaches projects configured before it
 * existed, so the failure this guards against is somebody's 08:00 briefing
 * breaking for a reason that is nowhere on their screen. The opposite failure
 * matters too: a banner on every project would be dismissed unread by the
 * people who most need to see it.
 */
describe('who gets told', () => {
  const ritual = (patch = {}) => ({ projectDir: '/repo/a', enabled: true, lastRunAt: 1, ...patch })
  const warn = (patch = {}) => store.shouldWarn({
    dir: '/repo/a',
    source: 'default' as const,
    rituals: [ritual()],
    acknowledged: false,
    ...patch,
  })

  it('warns a project with unattended work that predates the sandbox', () => {
    expect(warn()).toBe(true)
  })

  it('says nothing to somebody who has already chosen', () => {
    // They have been to Settings. Telling them again is noise.
    expect(warn({ source: 'configured' as const })).toBe(false)
  })

  it('says nothing twice', () => {
    expect(warn({ acknowledged: true })).toBe(false)
  })

  it('says nothing to a project with no rituals at all', () => {
    // Nothing runs here unattended, so there is nothing to break.
    expect(warn({ rituals: [] })).toBe(false)
  })

  it('says nothing about a ritual that has never actually run', () => {
    // It cannot have been relying on a host it never reached for.
    expect(warn({ rituals: [ritual({ lastRunAt: undefined })] })).toBe(false)
  })

  it('says nothing about a ritual that is turned off', () => {
    expect(warn({ rituals: [ritual({ enabled: false })] })).toBe(false)
  })

  it('does not warn one project about another project\'s rituals', () => {
    expect(warn({ rituals: [ritual({ projectDir: '/repo/b' })] })).toBe(false)
  })

  it('warns when any one ritual qualifies, not only when all do', () => {
    expect(warn({ rituals: [ritual({ enabled: false }), ritual()] })).toBe(true)
  })
})

describe('remembering that somebody was told', () => {
  it('records it per project, and leaves the setting alone', async () => {
    await store.acknowledgeSandboxNotice('/repo/a')

    // Acknowledging must not read as configuring, or "reset to the default"
    // would disappear for somebody who never chose anything.
    await expect(store.sandboxForProject('/repo/a')).resolves.toMatchObject({ source: 'default' })
    await expect(store.sandboxNoticeStore.read()).resolves.toEqual(['/repo/a'])
  })

  it('does not record the same project twice', async () => {
    await store.acknowledgeSandboxNotice('/repo/a')
    await store.acknowledgeSandboxNotice('/repo/a')

    await expect(store.sandboxNoticeStore.read()).resolves.toEqual(['/repo/a'])
  })
})

describe('handing it to the SDK', () => {
  it('gives nothing at all when it is off', () => {
    expect(store.toSandboxSettings({ enabled: false, allowedDomains: [] })).toBeUndefined()
  })

  it('does not let a run out of its own sandbox', () => {
    const settings = store.toSandboxSettings({ enabled: true, allowedDomains: [] })!
    expect(settings.allowUnsandboxedCommands).toBe(false)
  })

  it('stops an unattended sandboxed command having to ask', () => {
    // The unattended win: fewer rituals coming back refused a tool.
    const settings = store.toSandboxSettings(
      { enabled: true, allowedDomains: [] },
      { unattended: true },
    )!
    expect(settings.autoAllowBashIfSandboxed).toBe(true)
  })

  it('leaves the prompt in place for a turn somebody typed', () => {
    // "Edit files" trust promises it stops if it needs anything riskier.
    // Approving every shell command because the run is sandboxed made that
    // description untrue for the person who chose it.
    const settings = store.toSandboxSettings({ enabled: true, allowedDomains: [] })!
    expect(settings.autoAllowBashIfSandboxed).toBe(false)
  })

  it('omits the host list rather than sending an empty one', () => {
    const settings = store.toSandboxSettings({ enabled: true, allowedDomains: [] })!
    expect(settings.network.allowedDomains).toBeUndefined()
    expect(settings.network.allowLocalBinding).toBe(true)
  })
})

/**
 * Where the setting is filed, which a code review found was not where it was
 * read.
 *
 * A session's working directory is its *worktree* — created per session and
 * deleted when it closes. The sandbox was resolved from that, while Settings
 * and the "Allow these hosts" button both wrote against the repository. The
 * two never met: allowing a host reported success and changed nothing, and
 * turning the sandbox off left every session run sandboxed with no way back.
 */
describe('which directory the setting belongs to', () => {
  it('reads what the repository was told, not what the worktree was', async () => {
    const repo = '/repo/a'
    const worktree = '/repo/a/.worktrees/session-1'

    await store.setProjectSandbox(repo, { enabled: false, allowedDomains: ['registry.npmjs.org'] })

    const { resolveRunOptionsFor } = await import('../server/utils/runOptions')
    const options = await resolveRunOptionsFor({ projectDir: worktree, repoDir: repo })

    expect(options.sandbox.enabled).toBe(false)
    expect(options.sandbox.allowedDomains).toEqual(['registry.npmjs.org'])
  })

  it('falls back to the working directory when no repository is named', async () => {
    // Rituals run in the repository itself, so the fallback stays correct.
    // A real directory, because `projectDir` is ignored unless it is on disk.
    await store.setProjectSandbox(dir, { allowedDomains: ['github.com'] })

    const { resolveRunOptionsFor } = await import('../server/utils/runOptions')
    const options = await resolveRunOptionsFor({ projectDir: dir })

    expect(options.sandbox.allowedDomains).toEqual(['github.com'])
  })
})
