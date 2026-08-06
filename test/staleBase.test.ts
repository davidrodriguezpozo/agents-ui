import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Sessions going stale against each other.
 *
 * The failure this exists for: six sessions branch from main and all go green;
 * you merge one, and the other five are still showing the pass they earned
 * against a main that no longer exists. Git refuses a textual conflict, but it
 * has nothing to say about one branch renaming what another one calls.
 *
 * Real git throughout, because every claim here is a claim about git.
 */

let repoDir: string
let worktrees: typeof import('../server/utils/worktrees')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

beforeAll(async () => {
  repoDir = await mkdtemp(join(tmpdir(), 'agents-ui-stale-'))
  git(repoDir, 'init', '-q', '-b', 'main')
  git(repoDir, 'config', 'user.email', 'test@example.com')
  git(repoDir, 'config', 'user.name', 'Test')
  await writeFile(join(repoDir, 'shared.txt'), 'one\n')
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-q', '-m', 'initial')
  await writeFile(join(repoDir, '.git', 'info', 'exclude'), '.worktrees/\n')

  worktrees = await import('../server/utils/worktrees')
})

afterAll(async () => {
  await rm(repoDir, { recursive: true, force: true })
})

/** A session's workspace, exactly as startSession cuts one. */
function session(name: string) {
  const path = join(repoDir, '.worktrees', name)
  git(repoDir, 'worktree', 'add', '-q', '-b', name, path, 'main')
  return { path, baseSha: git(repoDir, 'rev-parse', 'main') }
}

/** Someone else's work landing on main — a merge, or a commit straight to it. */
function moveMain(file: string, contents: string) {
  execFileSync('sh', ['-c', `printf '%s' "${contents}" > "${join(repoDir, file)}"`])
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-q', '-m', `main moves: ${file}`)
}

describe('knowing a session is behind', () => {
  it('is level with the base when nothing has happened', async () => {
    const a = session('level')
    const status = await worktrees.worktreeStatus(a.path, a.baseSha, 'main')
    expect(status.behind).toBe(0)
  })

  it('notices the base moving on without it', async () => {
    const a = session('left-behind')
    moveMain('other.txt', 'from main')

    const status = await worktrees.worktreeStatus(a.path, a.baseSha, 'main')
    expect(status.behind).toBe(1)
  })

  it('reports zero when asked against the sha it branched from', async () => {
    // The bug this guards: `baseSha` is what the diff is taken against and it
    // never moves, so asking it about staleness always answers "fine".
    const a = session('sha-not-branch')
    moveMain('another.txt', 'more from main')

    const status = await worktrees.worktreeStatus(a.path, a.baseSha, a.baseSha)
    expect(status.behind).toBe(0)
  })

  it('counts ahead and behind separately', async () => {
    const a = session('both-ways')
    await writeFile(join(a.path, 'mine.txt'), 'my work\n')
    git(a.path, 'add', '-A')
    git(a.path, 'commit', '-q', '-m', 'my work')
    moveMain('theirs.txt', 'their work')

    const status = await worktrees.worktreeStatus(a.path, a.baseSha, 'main')
    expect(status.ahead).toBe(1)
    expect(status.behind).toBeGreaterThan(0)
  })
})

describe('catching a session up', () => {
  it('brings the base in and stops being behind', async () => {
    const a = session('catch-up')
    moveMain('landed.txt', 'landed on main')

    const result = await worktrees.updateFromBase(a.path, 'main')
    expect(result.status).toBe('updated')

    const after = await worktrees.worktreeStatus(a.path, a.baseSha, 'main')
    expect(after.behind).toBe(0)
  })

  it('says so rather than working when there is nothing to bring in', async () => {
    const a = session('nothing-to-do')
    expect((await worktrees.updateFromBase(a.path, 'main')).status).toBe('already-current')
  })

  it('refuses over uncommitted work instead of dragging it into a merge', async () => {
    const a = session('dirty-one')
    moveMain('pushed.txt', 'pushed to main')
    await writeFile(join(a.path, 'wip.txt'), 'half-written\n')

    const result = await worktrees.updateFromBase(a.path, 'main')
    expect(result.status).toBe('refused')
    expect(result.message).toMatch(/uncommitted/i)
  })

  it('reports a conflict rather than pretending it merged', async () => {
    const a = session('conflicting')
    await writeFile(join(a.path, 'shared.txt'), 'the session version\n')
    git(a.path, 'add', '-A')
    git(a.path, 'commit', '-q', '-m', 'session edits the shared file')

    // main edits the same line.
    await writeFile(join(repoDir, 'shared.txt'), 'the main version\n')
    git(repoDir, 'add', '-A')
    git(repoDir, 'commit', '-q', '-m', 'main edits the shared file')

    const result = await worktrees.updateFromBase(a.path, 'main')
    expect(result.status).toBe('conflicted')
    // Left in the workspace on purpose — the session has both sides to work with.
    expect(git(a.path, 'status', '--porcelain')).toMatch(/^(UU|AA)/m)
  })

  it('says so plainly when the workspace has gone', async () => {
    const result = await worktrees.updateFromBase(join(repoDir, '.worktrees', 'never-existed'), 'main')
    expect(result.status).toBe('refused')
    expect(result.message).toMatch(/no longer on disk/i)
  })
})
