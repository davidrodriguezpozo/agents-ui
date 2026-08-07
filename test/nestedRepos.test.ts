import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findRepositoriesIn } from '../server/utils/nestedRepos'

const run = promisify(execFile)

/**
 * A folder that is not a repository, with the repository one level down:
 *
 *   base/            no git
 *     app/           the repository
 *     specs/         notes
 *
 * Every session against `base/` was refused — correctly, a worktree has to be
 * a worktree of something — while the repository it wanted sat in plain view
 * one directory below.
 */

let base: string

async function repoAt(path: string) {
  await mkdir(path, { recursive: true })
  await run('git', ['init', '-q', '-b', 'main'], { cwd: path })
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'agents-ui-nested-'))
  await repoAt(join(base, 'app'))
  await mkdir(join(base, 'specs'), { recursive: true })
  await writeFile(join(base, 'specs', 'plan.md'), 'the plan\n', 'utf-8')
})

afterAll(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('findRepositoriesIn', () => {
  it('finds the repository a directory down', async () => {
    const found = await findRepositoriesIn(base)
    expect(found.map(r => r.name)).toEqual(['app'])
    expect(found[0]!.depth).toBe(1)
  })

  it('does not offer the folders that are not repositories', async () => {
    const found = await findRepositoriesIn(base)
    expect(found.map(r => r.name)).not.toContain('specs')
  })

  it('finds one two levels down, and puts nearer ones first', async () => {
    const deep = await mkdtemp(join(tmpdir(), 'agents-ui-nested2-'))
    try {
      await repoAt(join(deep, 'packages', 'inner'))
      await repoAt(join(deep, 'top'))

      const found = await findRepositoriesIn(deep)
      expect(found.map(r => r.name)).toEqual(['top', 'inner'])
      expect(found.map(r => r.depth)).toEqual([1, 2])
    } finally {
      await rm(deep, { recursive: true, force: true })
    }
  })

  it('stops at a repository rather than listing the ones inside it', async () => {
    // What lives inside a repository is that repository's business, not a
    // choice worth putting in front of anybody.
    const outer = await mkdtemp(join(tmpdir(), 'agents-ui-nested3-'))
    try {
      await repoAt(join(outer, 'app'))
      await repoAt(join(outer, 'app', 'vendored'))

      const found = await findRepositoriesIn(outer)
      expect(found.map(r => r.name)).toEqual(['app'])
    } finally {
      await rm(outer, { recursive: true, force: true })
    }
  })

  it('skips the directories that are always noise', async () => {
    const noisy = await mkdtemp(join(tmpdir(), 'agents-ui-nested4-'))
    try {
      await repoAt(join(noisy, 'node_modules', 'something'))
      expect(await findRepositoriesIn(noisy)).toEqual([])
    } finally {
      await rm(noisy, { recursive: true, force: true })
    }
  })

  it('says nothing rather than throwing for a path that is not there', async () => {
    expect(await findRepositoriesIn(join(base, 'nope'))).toEqual([])
  })
})
