import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Starting on work that already exists, a second time.
 *
 * Every case here was the same dead end: git refusing a branch that is already
 * checked out, reported as though there were nothing to be done about it. There
 * always was — the branch is in a directory on this machine, and which
 * directory decides what should happen. A review does not need the branch at
 * all; the other intents need the workspace that has it, not a second one.
 *
 * A plain branch ref rather than a pull request, so these run without `gh` or a
 * network. The pull request path differs only in where the commit comes from.
 */

let root: string
let repo: string
let fromRef: typeof import('../server/utils/sessionFromRef')
let sessions: typeof import('../server/utils/sessions')
let worktrees: typeof import('../server/utils/worktrees')
let branchHolder: typeof import('../server/utils/branchHolder')

function git(args: string[], cwd = repo) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'agents-ui-fromref-'))
  process.env.CLAUDE_DIR = join(root, 'claude')
  fromRef = await import('../server/utils/sessionFromRef')
  sessions = await import('../server/utils/sessions')
  worktrees = await import('../server/utils/worktrees')
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

  // Somebody's branch with a commit of their own on it, which is what all of
  // this is about: work that existed before any session did.
  git(['checkout', '-b', 'feature-x'])
  await writeFile(join(repo, 'theirs.md'), 'their work\n')
  git(['add', '.'])
  git(['commit', '-m', 'theirs'])
  git(['checkout', 'main'])

  await sessions.writeSessions([])
})

describe('startSessionFromRef, reading', () => {
  it('takes the commit and not the branch', async () => {
    const { session, how } = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x', detach: true })

    expect(how).toBe('created')
    expect(session.detached).toBe(true)
    expect(session.baseSha).toBe(git(['rev-parse', 'feature-x']))
    // The branch is still named, because that is what identifies the work — but
    // nothing has it checked out.
    expect(session.branch).toBe('feature-x')
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], session.worktreePath)).toBe('HEAD')
    expect(await branchHolder.findBranchHolder(repo, 'feature-x')).toEqual({ kind: 'free' })
  })

  it('reads the same branch as many times as asked', async () => {
    const first = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x', detach: true })
    const second = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x', detach: true })

    expect(second.session.id).not.toBe(first.session.id)
    expect(second.session.worktreePath).not.toBe(first.session.worktreePath)
    expect((await sessions.readSessions())).toHaveLength(2)
  })

  it('reads a branch a session is working on, without disturbing it', async () => {
    const working = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' })
    const reading = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x', detach: true })

    expect(reading.session.id).not.toBe(working.session.id)
    // The session that has the branch still has it.
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], working.session.worktreePath)).toBe('feature-x')
  })

  it('never claims a branch it did not make', async () => {
    const { session } = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x', detach: true })
    // `close-empty` deletes branches with `-D`, and a review session is the
    // emptiest thing in the app.
    expect(session.borrowedBranch).toBe(true)
  })

  it('says so plainly when there is no such branch', async () => {
    await expect(fromRef.startSessionFromRef({ repoDir: repo, ref: 'no-such-branch', detach: true }))
      .rejects.toMatchObject({ data: { error: 'no_such_branch' } })
  })
})

describe('startSessionFromRef, working', () => {
  it('cuts a workspace when nothing has the branch', async () => {
    const { session, how } = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' })

    expect(how).toBe('created')
    expect(session.detached).toBeUndefined()
    expect(session.borrowedBranch).toBe(true)
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], session.worktreePath)).toBe('feature-x')
  })

  it('continues the session that already has it rather than failing', async () => {
    const first = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' })
    const again = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' })

    expect(again.how).toBe('continued')
    expect(again.session.id).toBe(first.session.id)
    expect(again.session.worktreePath).toBe(first.session.worktreePath)
    // No second record and no second checkout of a branch git allows in one.
    expect(await sessions.readSessions()).toHaveLength(1)
  })

  it('refuses a session mid-turn, and names it so it can be opened', async () => {
    const first = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' })
    await sessions.patchSession(first.session.id, { status: 'running' })

    await expect(fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' }))
      .rejects.toMatchObject({ data: { error: 'session_running', sessionId: first.session.id } })
  })

  it('takes over a workspace no session claims', async () => {
    const first = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' })
    // What a deleted record, or a crash between the two writes, leaves behind.
    await sessions.writeSessions([])

    const again = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' })

    expect(again.how).toBe('adopted')
    // The same directory, compared by what it resolves to: git reports worktree
    // paths with symlinks already followed, and on a Mac /var is one.
    expect(realpathSync(again.session.worktreePath)).toBe(realpathSync(first.session.worktreePath))
    // Reused, not added to.
    expect(await worktrees.listWorktrees(repo)).toHaveLength(2)
    expect(again.note).toMatch(/took over/i)
    expect(again.session.baseSha).toBe(git(['rev-parse', 'feature-x']))
  })

  it('will not write on top of uncommitted work in a workspace it is taking over', async () => {
    const first = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' })
    await writeFile(join(first.session.worktreePath, 'unsaved.md'), 'somebody was here\n')
    await sessions.writeSessions([])

    await expect(fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' }))
      .rejects.toMatchObject({ data: { error: 'worktree_dirty' } })
  })

  it('keeps its hands off your own checkout', async () => {
    // `main` is out in the repository itself, quite possibly with your work in
    // it. Nothing here switches that away for you.
    await expect(fromRef.startSessionFromRef({ repoDir: repo, ref: 'main' }))
      .rejects.toMatchObject({ data: { error: 'branch_in_use' } })
  })

  it('measures from the branch head, so the diff is this session and not theirs', async () => {
    const { session } = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' })

    expect(session.baseSha).toBe(git(['rev-parse', 'feature-x']))
    const status = await worktrees.worktreeStatus(session.worktreePath, await worktrees.diffBase(session), 'main')
    expect(status.changedFiles).toBe(0)
    expect(status.ahead).toBe(0)
  })
})
