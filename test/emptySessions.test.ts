import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeOutcome, verifyEmpty } from '../server/utils/emptySessions'
import type { Session } from '../server/utils/sessions'

const run = promisify(execFile)

/**
 * This deletes branches, so "it looked empty on the page" is not good enough.
 * Every verdict is taken from a fresh look at the workspace on disk.
 */

let repo: string

async function git(...args: string[]) {
  await run('git', args, { cwd: repo })
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'a session',
    repoDir: repo,
    worktreePath: repo,
    branch: 'main',
    baseBranch: 'main',
    baseSha: 'HEAD',
    status: 'idle',
    runIds: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as Session
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'agents-ui-empty-'))
  await git('init', '-b', 'main')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'Test')
  await writeFile(join(repo, 'a.txt'), 'one\n', 'utf-8')
  await git('add', '.')
  await git('commit', '-m', 'first')
})

afterAll(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('verifyEmpty', () => {
  it('accepts a clean workspace with nothing to show', async () => {
    const verdict = await verifyEmpty(session())
    expect(verdict.empty).toBe(true)
  })

  it('refuses one with uncommitted work, whatever the page believed', async () => {
    // The list in the browser can be minutes old, and a branch deleted on the
    // strength of a stale view is not recoverable from the UI.
    await writeFile(join(repo, 'b.txt'), 'two\n', 'utf-8')
    try {
      const verdict = await verifyEmpty(session())
      expect(verdict).toMatchObject({ empty: false, reason: 'has-changes' })
    } finally {
      await rm(join(repo, 'b.txt'), { force: true })
    }
  })

  it('refuses one that is still working', async () => {
    const verdict = await verifyEmpty(session({ status: 'running' }))
    expect(verdict).toMatchObject({ empty: false, reason: 'busy' })
  })

  it('refuses an archived one rather than deleting it twice', async () => {
    const verdict = await verifyEmpty(session({ status: 'archived' }))
    expect(verdict).toMatchObject({ empty: false, reason: 'archived' })
  })

  it('does not report a vanished workspace as cleaned up', async () => {
    // Nothing to remove, but the record still needs a decision — quietly
    // counting it as closed would hide that.
    const verdict = await verifyEmpty(session({ worktreePath: join(repo, 'not-here') }))
    expect(verdict).toMatchObject({ empty: false, reason: 'missing' })
  })
})

describe('describeOutcome', () => {
  it('counts what it did', () => {
    expect(describeOutcome(3, [])).toBe('Closed 3 sessions.')
    expect(describeOutcome(1, [])).toBe('Closed 1 session.')
  })

  it('says separately why each kind was left alone', () => {
    // "Some were skipped" is useless: work that turned up wants a look, and a
    // session still running just wants a minute.
    const said = describeOutcome(1, [
      { id: 'a', title: 'a', empty: false, reason: 'has-changes' },
      { id: 'b', title: 'b', empty: false, reason: 'busy' },
    ])
    expect(said).toContain('had changes after all')
    expect(said).toContain('still working')
  })
})
