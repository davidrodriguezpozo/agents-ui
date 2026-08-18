import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * What a session's work is measured from.
 *
 * The failure this exists for: a session branches from `release/2.0`, someone
 * lands twelve commits on it, the session catches itself up with
 * `updateFromBase` — and from that moment its diff is those twelve commits plus
 * its own, its "ahead" count is fourteen, and the pull request it offers to open
 * lists somebody else's work. The recorded base sha cannot see the merge; the
 * base branch can.
 *
 * Nothing here assumes the base is `main`, because in the case that matters it
 * is not: stacked sessions are cut from each other.
 *
 * Real git throughout, because every claim here is a claim about git.
 */

let repoDir: string
let worktrees: typeof import('../server/utils/worktrees')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

async function commitOn(branch: string, file: string, contents: string) {
  git(repoDir, 'checkout', '-q', branch)
  await writeFile(join(repoDir, file), contents)
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-q', '-m', `${branch}: ${file}`)
}

/** A session's workspace, exactly as `startSession` cuts one. */
function session(name: string, baseBranch: string) {
  const path = join(repoDir, '.worktrees', name)
  git(repoDir, 'worktree', 'add', '-q', '-b', name, path, baseBranch)
  return {
    worktreePath: path,
    branch: name,
    baseBranch,
    baseSha: git(repoDir, 'rev-parse', baseBranch),
  }
}

async function work(s: { worktreePath: string }, file: string, contents: string) {
  await writeFile(join(s.worktreePath, file), contents)
  git(s.worktreePath, 'add', '-A')
  git(s.worktreePath, 'commit', '-q', '-m', `session: ${file}`)
}

beforeAll(async () => {
  repoDir = await mkdtemp(join(tmpdir(), 'agents-ui-diffbase-'))
  git(repoDir, 'init', '-q', '-b', 'main')
  git(repoDir, 'config', 'user.email', 'test@example.com')
  git(repoDir, 'config', 'user.name', 'Test')
  await writeFile(join(repoDir, 'shared.txt'), 'one\n')
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-q', '-m', 'initial')
  await writeFile(join(repoDir, '.git', 'info', 'exclude'), '.worktrees/\n')

  // The base that is not `main`. Everything below is cut from this.
  git(repoDir, 'branch', 'release/2.0')

  worktrees = await import('../server/utils/worktrees')
})

afterAll(async () => {
  await rm(repoDir, { recursive: true, force: true })
})

describe('diffBase', () => {
  it('names the base branch when the session was cut from it', async () => {
    const s = session('cut-from-release', 'release/2.0')
    expect(await worktrees.diffBase(s)).toBe('release/2.0')
  })

  it('keeps the recorded sha when the base branch never contained it', async () => {
    // A session started on an existing branch or a pull request: its base is
    // that branch's head, deliberately, so the diff excludes what the branch
    // already had. Measuring from `main` would re-show the whole pull request.
    await commitOn('main', 'feature.txt', 'somebody else already wrote this\n')
    const headOfFeature = git(repoDir, 'rev-parse', 'main')
    git(repoDir, 'checkout', '-q', 'main')

    const s = session('picked-up', 'release/2.0')
    expect(await worktrees.diffBase({ ...s, baseSha: headOfFeature })).toBe(headOfFeature)
  })

  it('keeps the recorded sha when the base branch is the session branch', async () => {
    // A base that moves with HEAD reports every session on it as having done
    // nothing, forever.
    const s = session('self-based', 'release/2.0')
    expect(await worktrees.diffBase({ ...s, baseBranch: s.branch })).toBe(s.baseSha)
  })

  it('keeps the recorded sha when the base branch is gone', async () => {
    const s = session('orphaned', 'release/2.0')
    expect(await worktrees.diffBase({ ...s, baseBranch: 'deleted-long-ago' })).toBe(s.baseSha)
  })
})

describe('a session that has caught up with its base', () => {
  it('does not count the base branch’s work as its own', async () => {
    const s = session('caught-up', 'release/2.0')
    await work(s, 'mine.txt', 'the session wrote this\n')

    await commitOn('release/2.0', 'theirs-one.txt', 'not the session\n')
    await commitOn('release/2.0', 'theirs-two.txt', 'also not the session\n')

    git(s.worktreePath, 'merge', '-q', '--no-edit', 'release/2.0')

    const base = await worktrees.diffBase(s)
    const diff = await worktrees.worktreeDiff(s.worktreePath, base)
    const status = await worktrees.worktreeStatus(s.worktreePath, base, s.baseBranch)

    expect(diff.files.map(f => f.path)).toEqual(['mine.txt'])
    expect(status.changedFiles).toBe(1)
    // Its own commit and the merge that caught it up — both are commits the
    // base does not have. Measured from the recorded sha this was four, two of
    // them somebody else's.
    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(0)
  })

  it('is what the recorded sha alone gets wrong', async () => {
    const s = session('sha-only', 'release/2.0')
    await work(s, 'also-mine.txt', 'the session wrote this too\n')
    await commitOn('release/2.0', 'theirs-three.txt', 'not the session\n')
    git(s.worktreePath, 'merge', '-q', '--no-edit', 'release/2.0')

    const diff = await worktrees.worktreeDiff(s.worktreePath, s.baseSha)
    expect(diff.files.map(f => f.path).sort()).toContain('theirs-three.txt')
  })
})
