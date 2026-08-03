import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Session } from '../server/utils/sessions'

const exec = promisify(execFile)

/**
 * Worktrees used to live under the app's own directory. Moving them into their
 * repositories touches real, possibly uncommitted work, so the cases that
 * matter are: it preserves everything, and when it cannot proceed it changes
 * nothing rather than half-moving a session.
 */

let claudeDir: string
let repoRoot: string
let repo: string
let migration: typeof import('../server/utils/worktreeMigration')
let sessions: typeof import('../server/utils/sessions')

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-mig-home-'))
  repoRoot = await mkdtemp(join(tmpdir(), 'agents-ui-mig-repos-'))
  process.env.CLAUDE_DIR = claudeDir
  migration = await import('../server/utils/worktreeMigration')
  sessions = await import('../server/utils/sessions')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(repoRoot, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

/** Build a repo with a session worktree at the old location. */
async function legacySession(id: string): Promise<Session> {
  repo = await mkdtemp(join(repoRoot, 'repo-'))
  await exec('git', ['init', '-q'], { cwd: repo })
  await exec('git', ['config', 'user.email', 't@t.t'], { cwd: repo })
  await exec('git', ['config', 'user.name', 'T'], { cwd: repo })
  await writeFile(join(repo, 'a.txt'), 'hello\n', 'utf-8')
  await exec('git', ['add', '-A'], { cwd: repo })
  await exec('git', ['commit', '-q', '-m', 'init'], { cwd: repo })

  const legacyPath = join(migration.legacyWorktreeRoot(), 'repo', id)
  await mkdir(join(legacyPath, '..'), { recursive: true })
  await exec('git', ['worktree', 'add', legacyPath, '-b', `agents-ui/x-${id}`, '-q'], { cwd: repo })

  return sessions.saveSession({
    id,
    title: `Session ${id}`,
    repoDir: repo,
    worktreePath: legacyPath,
    branch: `agents-ui/x-${id}`,
    baseBranch: 'main',
    baseSha: '',
    status: 'idle',
    runIds: [],
    createdAt: 1,
    updatedAt: 1,
  })
}

beforeEach(async () => {
  await rm(join(claudeDir, 'agents-ui'), { recursive: true, force: true })
})

describe('moving worktrees into their repositories', () => {
  it('moves the directory and updates the record to match', async () => {
    const session = await legacySession('aaa')

    const result = await migration.migrateWorktrees()
    expect(result.failed).toEqual([])
    expect(result.moved).toHaveLength(1)

    const updated = await sessions.findSession('aaa')
    expect(updated!.worktreePath).toBe(join(session.repoDir, '.worktrees', 'aaa'))
    expect(existsSync(updated!.worktreePath)).toBe(true)
    expect(existsSync(session.worktreePath)).toBe(false)
  })

  it('keeps uncommitted work', async () => {
    const session = await legacySession('bbb')
    await writeFile(join(session.worktreePath, 'draft.md'), 'not committed\n', 'utf-8')
    await writeFile(join(session.worktreePath, 'a.txt'), 'edited\n', 'utf-8')

    await migration.migrateWorktrees()

    const moved = (await sessions.findSession('bbb'))!.worktreePath
    expect(await readFile(join(moved, 'draft.md'), 'utf-8')).toBe('not committed\n')
    expect(await readFile(join(moved, 'a.txt'), 'utf-8')).toBe('edited\n')
  })

  it('leaves git aware of the worktree at its new path', async () => {
    const session = await legacySession('ccc')
    await migration.migrateWorktrees()

    const { stdout } = await exec('git', ['worktree', 'list'], { cwd: session.repoDir })
    expect(stdout).toContain(join(session.repoDir, '.worktrees', 'ccc'))
  })

  it('is a no-op the second time', async () => {
    await legacySession('ddd')
    await migration.migrateWorktrees()

    const again = await migration.migrateWorktrees()
    expect(again.moved).toEqual([])
    expect(again.failed).toEqual([])
  })

  it('leaves the session alone when its directory is already gone', async () => {
    // Nothing to move, and the record must survive so the recovery path can
    // still offer to rebuild it from the branch.
    const session = await legacySession('eee')
    await exec('git', ['worktree', 'remove', '--force', session.worktreePath], { cwd: session.repoDir })

    const result = await migration.migrateWorktrees()
    expect(result.moved).toEqual([])
    expect(result.failed).toEqual([])
    expect(await sessions.findSession('eee')).not.toBeNull()
  })

  it('refuses rather than overwriting something already at the target', async () => {
    const session = await legacySession('fff')
    const target = join(session.repoDir, '.worktrees', 'fff')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'keep.txt'), 'do not clobber\n', 'utf-8')

    const result = await migration.migrateWorktrees()
    expect(result.moved).toEqual([])
    expect(result.failed).toHaveLength(1)

    expect(await readFile(join(target, 'keep.txt'), 'utf-8')).toBe('do not clobber\n')
    // The record still points somewhere real, so the session keeps working.
    expect((await sessions.findSession('fff'))!.worktreePath).toBe(session.worktreePath)
    expect(existsSync(session.worktreePath)).toBe(true)
  })

  it('excludes the directory from git as part of moving', async () => {
    const session = await legacySession('ggg')
    await migration.migrateWorktrees()

    const exclude = await readFile(join(session.repoDir, '.git', 'info', 'exclude'), 'utf-8')
    expect(exclude).toContain('.worktrees/')

    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd: session.repoDir })
    expect(stdout.trim()).toBe('')
  })
})
