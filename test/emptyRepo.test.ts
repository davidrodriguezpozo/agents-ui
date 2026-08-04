import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * A repository that has been `git init`ed and never committed to.
 *
 * It is a real repository — `rev-parse --is-inside-work-tree` says true — but
 * `HEAD` does not resolve, and every assumption downstream of "find the
 * current branch" quietly breaks. Reported from the field as:
 *
 *   Could not create a workspace: Preparing worktree (new branch 'agents-ui/…')
 *   fatal: not a valid object name: 'HEAD'
 *
 * which is accurate and tells you nothing about what to do.
 */

let claudeDir: string
let emptyRepo: string
let worktrees: typeof import('../server/utils/worktrees')
let startSession: typeof import('../server/utils/startSession')

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-empty-cfg-'))
  process.env.CLAUDE_DIR = claudeDir

  emptyRepo = await mkdtemp(join(tmpdir(), 'agents-ui-empty-repo-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: emptyRepo })
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: emptyRepo })
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: emptyRepo })
  // Files, but no commit — exactly the state a fresh project is left in.
  await writeFile(join(emptyRepo, 'README.md'), '# new project\n')

  worktrees = await import('../server/utils/worktrees')
  startSession = await import('../server/utils/startSession')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(emptyRepo, { recursive: true, force: true })
})

describe('a repository with no commits', () => {
  it('is still a git repository', () => {
    // The old guard passed here, which is why the failure happened later.
    return expect(worktrees.isGitRepo(emptyRepo)).resolves.toBe(true)
  })

  it('is recognised as having nothing to branch from', async () => {
    expect(await worktrees.hasCommits(emptyRepo)).toBe(false)
  })

  it('refuses a session in words about the repository, not about object names', async () => {
    try {
      await startSession.startSession({ repoDir: emptyRepo, title: 'anything' })
      throw new Error('Expected that to be refused.')
    } catch (e: any) {
      expect(e.data?.error).toBe('no_commits')
      expect(e.data?.message).toContain('no commits yet')
      // The failure people actually saw must not reach them any more.
      expect(e.data?.message).not.toContain('not a valid object name')
    }
  })

  it('leaves no half-made workspace behind when it refuses', async () => {
    // Refusing before `git worktree add` is what makes this true — a failure
    // partway through would strand a directory git still believes in.
    expect(await worktrees.listWorktrees(emptyRepo)).toHaveLength(1)
  })
})

describe('the same repository once it has a commit', () => {
  it('starts a session normally', async () => {
    execFileSync('git', ['add', '-A'], { cwd: emptyRepo })
    execFileSync('git', ['commit', '-q', '-m', 'first'], { cwd: emptyRepo })

    expect(await worktrees.hasCommits(emptyRepo)).toBe(true)

    const session = await startSession.startSession({ repoDir: emptyRepo, title: 'now it works' })
    expect(session.baseBranch).toBe('main')
    // The bug in one line: this used to be the string "HEAD".
    expect(session.baseBranch).not.toBe('HEAD')
    expect(session.baseSha).toMatch(/^[0-9a-f]{40}$/)
  })
})
