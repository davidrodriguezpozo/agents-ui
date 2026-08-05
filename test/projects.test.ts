import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The project list is what replaced a single path in local storage, so the
 * things worth pinning down are the ones that would silently corrupt it: the
 * same directory arriving under two spellings and becoming two projects, a
 * removal that leaves you pointing at nothing, and the one-time seed from
 * existing sessions resurrecting a project somebody deliberately removed.
 */

let dir: string
let repoA: string
let repoB: string
let projects: typeof import('../server/utils/projects')

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-projects-'))
  repoA = join(dir, 'repo-a')
  repoB = join(dir, 'repo-b')
  await mkdir(repoA, { recursive: true })
  await mkdir(repoB, { recursive: true })

  process.env.CLAUDE_DIR = dir
  projects = await import('../server/utils/projects')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui', 'projects.json'), { force: true })
  await rm(join(dir, 'agents-ui', 'projects.json.bak'), { force: true })
})

describe('normaliseProjectPath', () => {
  it('gives one spelling to a trailing slash', () => {
    expect(projects.normaliseProjectPath('/tmp/thing/')).toBe('/tmp/thing')
  })

  it('expands a leading tilde, which is what people type', () => {
    expect(projects.normaliseProjectPath('~/code')).toBe(join(homedir(), 'code'))
    expect(projects.normaliseProjectPath('~')).toBe(homedir())
  })

  it('refuses a relative path, which would resolve against the server not you', () => {
    expect(projects.normaliseProjectPath('code/thing')).toBeNull()
    expect(projects.normaliseProjectPath('   ')).toBeNull()
  })
})

describe('the list', () => {
  it('does not add the same repository twice under two spellings', async () => {
    await projects.addProject(repoA)
    await projects.addProject(`${repoA}/`)
    await projects.addProject(join(repoA, '..', 'repo-a'))

    expect(await projects.readProjects()).toHaveLength(1)
  })

  it('refuses a path that is not on disk', async () => {
    expect(await projects.addProject(join(dir, 'nope'))).toBeNull()
    expect(await projects.readProjects()).toHaveLength(0)
  })

  it('names a project after its directory, and lets that be overridden', async () => {
    const added = await projects.addProject(repoA)
    expect(added?.name).toBe('repo-a')

    await projects.renameProject(repoA, 'The good one')
    expect((await projects.readProjects())[0]!.name).toBe('The good one')
  })

  it('orders by when you were last in them, not when they were added', async () => {
    // Named so that alphabetical order would put it last, and clocked by hand
    // so the recency actually differs: three calls in one millisecond tie on
    // lastUsedAt and fall back to the name, which would let this pass without
    // testing anything.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      await projects.addProject(repoA, 'zebra')
      vi.setSystemTime(2_000)
      await projects.addProject(repoB, 'aardvark')
      vi.setSystemTime(3_000)
      await projects.touchProject(repoA)
    } finally {
      vi.useRealTimers()
    }

    expect((await projects.readProjects()).map(p => p.path)).toEqual([repoA, repoB])
  })
})

describe('the active project', () => {
  it('adds a project it is asked to activate', async () => {
    await projects.setActiveProject(repoB)

    const state = await projects.readProjectState()
    expect(state.activePath).toBe(repoB)
    expect(state.projects.map(p => p.path)).toEqual([repoB])
  })

  it('takes null as a real answer rather than a missing one', async () => {
    await projects.setActiveProject(repoA)
    const state = await projects.setActiveProject(null)

    expect(state.activePath).toBeNull()
    // Deselecting is not forgetting.
    expect(state.projects.map(p => p.path)).toEqual([repoA])
  })

  it('throws rather than pointing at a directory that is not there', async () => {
    await expect(projects.setActiveProject(join(dir, 'nope'))).rejects.toThrow()
  })

  it('falls back to another project when the active one is removed', async () => {
    await projects.setActiveProject(repoA)
    await projects.setActiveProject(repoB)
    await projects.removeProject(repoB)

    expect((await projects.readProjectState()).activePath).toBe(repoA)
  })

  it('ends up with nothing active when the last project is removed', async () => {
    await projects.setActiveProject(repoA)
    await projects.removeProject(repoA)

    const state = await projects.readProjectState()
    expect(state.activePath).toBeNull()
    expect(state.projects).toHaveLength(0)
  })
})

describe('seeding from work that already exists', () => {
  it('fills an unwritten list from the repositories sessions name', async () => {
    await projects.seedProjectsIfUnwritten([repoA, repoB, repoA, null], repoB)

    const state = await projects.readProjectState()
    expect(state.projects.map(p => p.path).sort()).toEqual([repoA, repoB].sort())
    expect(state.activePath).toBe(repoB)
  })

  it('skips repositories that are no longer on disk', async () => {
    await projects.seedProjectsIfUnwritten([join(dir, 'gone'), repoA])

    expect((await projects.readProjects()).map(p => p.path)).toEqual([repoA])
  })

  it('never runs again, so a project you removed stays removed', async () => {
    await projects.seedProjectsIfUnwritten([repoA, repoB])
    await projects.removeProject(repoB)

    await projects.seedProjectsIfUnwritten([repoA, repoB])

    expect((await projects.readProjects()).map(p => p.path)).toEqual([repoA])
  })
})
