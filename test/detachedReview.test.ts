import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Session } from '../server/utils/sessions'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * A branch lives in one working copy; a commit lives in as many as you like.
 *
 * That asymmetry is the whole fix for re-reviewing a pull request. Reviewing
 * used to check the branch out, so the second review of the same pull request
 * failed with "already checked out somewhere else" — and a review taken while a
 * session was fixing that branch could not happen at all. A review reads: it has
 * no business holding a ref.
 *
 * Real git rather than a stub, because the thing being relied on is git's own
 * rule about branches and its own indifference about commits.
 */

let root: string
let repo: string
let claudeDir: string
let worktrees: typeof import('../server/utils/worktrees')
let sessions: typeof import('../server/utils/sessions')
let branchHolder: typeof import('../server/utils/branchHolder')

function git(args: string[], cwd = repo) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'agents-ui-detached-'))
  claudeDir = join(root, 'claude')
  process.env.CLAUDE_DIR = claudeDir
  worktrees = await import('../server/utils/worktrees')
  sessions = await import('../server/utils/sessions')
  branchHolder = await import('../server/utils/branchHolder')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {})
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  repo = await mkdtemp(join(root, 'repo-'))

  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  await writeFile(join(repo, 'README.md'), '# hello\n')
  git(['add', '.'])
  git(['commit', '-m', 'first'])

  git(['branch', 'feature-x'])
  await sessions.writeSessions([])
})

function stub(over: Partial<Session>): Session {
  return {
    id: 'x',
    title: 'A session',
    repoDir: repo,
    worktreePath: '/nowhere',
    branch: 'feature-x',
    baseBranch: 'main',
    baseSha: 'abc',
    status: 'idle',
    runIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

describe('createDetachedWorktree', () => {
  it('checks out the commit and holds no branch', async () => {
    const commit = git(['rev-parse', 'feature-x'])
    const { path, head } = await worktrees.createDetachedWorktree({
      repoDir: repo,
      path: join(worktrees.worktreeRootFor(repo), 'r1'),
      commit,
    })

    expect(head).toBe(commit)
    expect(git(['rev-parse', 'HEAD'], path)).toBe(commit)

    // The point: git records the worktree with no branch, so nothing else is
    // blocked from taking `feature-x`.
    const record = (await worktrees.listWorktrees(repo)).find(w => w.path.endsWith('r1'))
    expect(record?.branch).toBeNull()

    const status = await worktrees.worktreeStatus(path, commit, 'main')
    expect(status.branch).toBeNull()
    expect(status.dirty).toBe(false)
  })

  it('reviews the same commit twice at once, which a branch checkout cannot', async () => {
    const commit = git(['rev-parse', 'feature-x'])

    await worktrees.createDetachedWorktree({ repoDir: repo, path: join(repo, '.worktrees', 'r1'), commit })
    await worktrees.createDetachedWorktree({ repoDir: repo, path: join(repo, '.worktrees', 'r2'), commit })

    expect((await worktrees.listWorktrees(repo)).filter(w => w.head === commit && !w.branch)).toHaveLength(2)

    // The behaviour this replaced, still true of a branch checkout — which is
    // why reviewing had to stop asking for one.
    await worktrees.createWorktreeOn({ repoDir: repo, path: join(repo, '.worktrees', 'w1'), branch: 'feature-x' })
    await expect(
      worktrees.createWorktreeOn({ repoDir: repo, path: join(repo, '.worktrees', 'w2'), branch: 'feature-x' }),
    ).rejects.toMatchObject({ data: { error: 'branch_in_use' } })
  })

  it('reads a branch that a session is working on, without taking it', async () => {
    // The case a review could not previously happen in at all.
    await worktrees.createWorktreeOn({ repoDir: repo, path: join(repo, '.worktrees', 'w1'), branch: 'feature-x' })

    const { path } = await worktrees.createDetachedWorktree({
      repoDir: repo,
      path: join(repo, '.worktrees', 'r1'),
      commit: git(['rev-parse', 'feature-x']),
    })

    expect(git(['rev-parse', 'HEAD'], path)).toBe(git(['rev-parse', 'feature-x']))
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).toBe('HEAD')
  })

  it('says where a branch went rather than repeating git', async () => {
    const held = join(repo, '.worktrees', 'w1')
    await worktrees.createWorktreeOn({ repoDir: repo, path: held, branch: 'feature-x' })

    await expect(
      worktrees.createWorktreeOn({ repoDir: repo, path: join(repo, '.worktrees', 'w2'), branch: 'feature-x' }),
    ).rejects.toMatchObject({
      data: { error: 'branch_in_use', message: expect.stringContaining(held) },
    })
  })
})

describe('findBranchHolder', () => {
  it('finds nothing when the branch is in no working copy', async () => {
    expect(await branchHolder.findBranchHolder(repo, 'feature-x')).toEqual({ kind: 'free' })
  })

  it('names the session whose workspace has it', async () => {
    const { path } = await worktrees.createWorktreeOn({
      repoDir: repo,
      path: join(repo, '.worktrees', 'abc'),
      branch: 'feature-x',
    })
    await sessions.saveSession(stub({ id: 'abc', worktreePath: path }))

    const holder = await branchHolder.findBranchHolder(repo, 'feature-x')
    expect(holder.kind).toBe('session')
    expect(holder.kind === 'session' && holder.session.id).toBe('abc')
  })

  it('offers a workspace no session claims for adoption', async () => {
    await worktrees.createWorktreeOn({
      repoDir: repo,
      path: join(repo, '.worktrees', 'orphan'),
      branch: 'feature-x',
    })

    const holder = await branchHolder.findBranchHolder(repo, 'feature-x')
    expect(holder.kind).toBe('adoptable')
  })

  it('will not adopt the repository you are working in', async () => {
    // `main` is checked out in the repo itself, which is nobody's to move.
    const holder = await branchHolder.findBranchHolder(repo, 'main')
    expect(holder).toEqual({ kind: 'foreign', path: git(['rev-parse', '--show-toplevel']) })
  })

  it('calls a branch free once the worktree git still records has gone', async () => {
    const { path } = await worktrees.createWorktreeOn({
      repoDir: repo,
      path: join(repo, '.worktrees', 'gone'),
      branch: 'feature-x',
    })
    await rm(path, { recursive: true, force: true })

    // Git still lists it as holding the branch until it is pruned, which is
    // bookkeeping rather than a reason to refuse anybody.
    expect(await branchHolder.findBranchHolder(repo, 'feature-x')).toEqual({ kind: 'free' })
  })

  it('is not a detached workspace, however many of those are reading the branch', async () => {
    await worktrees.createDetachedWorktree({
      repoDir: repo,
      path: join(repo, '.worktrees', 'r1'),
      commit: git(['rev-parse', 'feature-x']),
    })

    expect(await branchHolder.findBranchHolder(repo, 'feature-x')).toEqual({ kind: 'free' })
  })
})

describe('fastForward', () => {
  it('takes new commits when arriving at them costs nothing', async () => {
    const { path } = await worktrees.createWorktreeOn({
      repoDir: repo,
      path: join(repo, '.worktrees', 'w1'),
      branch: 'feature-x',
    })

    // Somebody pushed since: on the branch, not in this workspace.
    git(['checkout', 'main'])
    await writeFile(join(repo, 'other.md'), 'more\n')
    git(['add', '.'])
    git(['commit', '-m', 'second'])
    const ahead = git(['rev-parse', 'HEAD'])

    expect(await worktrees.fastForward(path, ahead)).toBe(true)
    expect(git(['rev-parse', 'HEAD'], path)).toBe(ahead)
  })

  it('leaves a workspace alone when catching up would need a decision', async () => {
    const { path } = await worktrees.createWorktreeOn({
      repoDir: repo,
      path: join(repo, '.worktrees', 'w1'),
      branch: 'feature-x',
    })

    // A commit of its own, so the histories have diverged.
    await writeFile(join(path, 'mine.md'), 'mine\n')
    git(['add', '.'], path)
    git(['commit', '-m', 'mine'], path)
    const before = git(['rev-parse', 'HEAD'], path)

    git(['checkout', 'main'])
    await writeFile(join(repo, 'theirs.md'), 'theirs\n')
    git(['add', '.'])
    git(['commit', '-m', 'theirs'])

    expect(await worktrees.fastForward(path, git(['rev-parse', 'HEAD']))).toBe(false)
    expect(git(['rev-parse', 'HEAD'], path)).toBe(before)
  })

  it('reports no movement when there was nothing to take', async () => {
    const { path } = await worktrees.createWorktreeOn({
      repoDir: repo,
      path: join(repo, '.worktrees', 'w1'),
      branch: 'feature-x',
    })
    expect(await worktrees.fastForward(path, 'main')).toBe(false)
  })
})

describe('isWorktreeDirty', () => {
  it('counts an untracked file, which is what an agent usually leaves', async () => {
    const { path } = await worktrees.createWorktreeOn({
      repoDir: repo,
      path: join(repo, '.worktrees', 'w1'),
      branch: 'feature-x',
    })

    expect(await worktrees.isWorktreeDirty(path)).toBe(false)
    await writeFile(join(path, 'scratch.md'), 'unsaved\n')
    expect(await worktrees.isWorktreeDirty(path)).toBe(true)
  })

  it('says clean for a directory that is not there, having nothing to lose', async () => {
    expect(await worktrees.isWorktreeDirty(join(repo, '.worktrees', 'never'))).toBe(false)
  })
})
