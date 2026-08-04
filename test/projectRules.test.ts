import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * This file decides what runs without stopping to ask, so the failure that
 * matters is granting more than someone meant: a rule leaking to another
 * project, or a damaged file being read as "everything is allowed".
 */

let dir: string
let store: typeof import('../server/utils/projectRules')

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-rules-'))
  process.env.CLAUDE_DIR = dir
  store = await import('../server/utils/projectRules')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
})

describe('granting', () => {
  it('remembers a rule for the project it was granted in', async () => {
    await store.allowInProject('/repo/a', ['Bash(pnpm test:*)'])

    await expect(store.rulesForProject('/repo/a')).resolves.toEqual(['Bash(pnpm test:*)'])
  })

  it('does not leak a rule into another project', async () => {
    // The whole point of scoping to the repository: approving something here
    // must say nothing about anywhere else.
    await store.allowInProject('/repo/a', ['Bash(rm:*)'])

    await expect(store.rulesForProject('/repo/b')).resolves.toEqual([])
  })

  it('does not accumulate the same rule twice', async () => {
    await store.allowInProject('/repo/a', ['Bash(gh:*)'])
    await store.allowInProject('/repo/a', ['Bash(gh:*)'])

    await expect(store.rulesForProject('/repo/a')).resolves.toEqual(['Bash(gh:*)'])
  })

  it('keeps what was already granted when adding another', async () => {
    await store.allowInProject('/repo/a', ['Bash(gh:*)'])
    const rules = await store.allowInProject('/repo/a', ['Write'])

    expect(rules).toContain('Bash(gh:*)')
    expect(rules).toContain('Write')
  })
})

describe('withdrawing', () => {
  it('removes only the rule named', async () => {
    await store.allowInProject('/repo/a', ['Bash(gh:*)', 'Write'])
    const rules = await store.revokeInProject('/repo/a', 'Write')

    expect(rules).toEqual(['Bash(gh:*)'])
  })

  it('forgets a project once its last rule is withdrawn', async () => {
    await store.allowInProject('/repo/a', ['Write'])
    await store.revokeInProject('/repo/a', 'Write')

    await expect(store.rulesForProject('/repo/a')).resolves.toEqual([])
  })

  it('shrugs at withdrawing something that was never granted', async () => {
    await expect(store.revokeInProject('/repo/never', 'Write')).resolves.toEqual([])
  })
})

describe('when the file is unreadable', () => {
  it('asks rather than assuming, and never throws into a run', async () => {
    // Reading this wrongly in the permissive direction would grant everything;
    // failing loudly would stop a run over a preference. Neither is right.
    await mkdir(join(dir, 'agents-ui'), { recursive: true })
    await writeFile(join(dir, 'agents-ui', 'project-rules.json'), 'not json', 'utf-8')

    await expect(store.rulesForProject('/repo/a')).resolves.toEqual([])
  })

  it('has nothing to say about a session with no repository', async () => {
    await expect(store.rulesForProject(undefined)).resolves.toEqual([])
  })
})
