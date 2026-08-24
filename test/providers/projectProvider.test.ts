import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Which agent a repository's new sessions start on.
 *
 * The failures worth guarding against are both of the "refuses to work rather
 * than fall back" kind: a preferences file that cannot be read must not stop a
 * session being created, and a value nobody recognises must not be handed
 * onwards to a provider registry that does not have it.
 */

let dir: string
let mod: typeof import('../../server/utils/projectProvider')

beforeAll(async () => {
  // Never the real ~/.claude, which holds live sessions and worktrees.
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-provider-'))
  process.env.CLAUDE_DIR = dir
  mod = await import('../../server/utils/projectProvider')
})

afterAll(async () => {
  delete process.env.CLAUDE_DIR
  await rm(dir, { recursive: true, force: true })
})

// The store reads its path per call, so emptying the directory is enough to
// give each test a machine that has never been configured.
beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
  await mkdir(join(dir, 'agents-ui'), { recursive: true })
})

const REPO = '/work/some-repo'

describe('the default agent for a repository', () => {
  it('is Claude Code when nothing was chosen', async () => {
    expect(await mod.providerForProject(REPO)).toBe('claude')
  })

  it('is Claude Code when no repository was named at all', async () => {
    expect(await mod.providerForProject(undefined)).toBe('claude')
  })

  it('is what was set, once something was', async () => {
    await mod.setProjectProvider(REPO, 'cursor')
    expect(await mod.providerForProject(REPO)).toBe('cursor')
  })

  it('is per repository, so setting one does not set the others', async () => {
    await mod.setProjectProvider(REPO, 'cursor')
    expect(await mod.providerForProject('/work/other')).toBe('claude')
  })

  /**
   * Forgetting the choice, not choosing Claude Code. The two have to stay
   * distinguishable, or Reset disappears for everybody who never set anything —
   * the same reasoning the sandbox setting is built on.
   */
  it('goes back to unset when the choice is cleared', async () => {
    await mod.setProjectProvider(REPO, 'cursor')
    await mod.clearProjectProvider(REPO)

    expect(await mod.providerForProject(REPO)).toBe('claude')
    expect(await mod.projectProviderStore.read()).toEqual({})
  })

  /**
   * A build that has dropped an agent still has to open the repositories that
   * were set to it. Reading the name as Claude Code loses the preference and
   * keeps the session.
   */
  it('reads a name it does not recognise as Claude Code', async () => {
    await writeFile(
      join(dir, 'agents-ui', 'project-provider.json'),
      JSON.stringify({ version: 1, projects: { [REPO]: 'codex' } }),
      'utf8',
    )

    expect(await mod.providerForProject(REPO)).toBe('claude')
  })

  /** A session must not fail to start over a preferences file. */
  it('reads an unparseable file as Claude Code rather than throwing', async () => {
    await writeFile(join(dir, 'agents-ui', 'project-provider.json'), '{ not json', 'utf8')
    expect(await mod.providerForProject(REPO)).toBe('claude')
  })
})
