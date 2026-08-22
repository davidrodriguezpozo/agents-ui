import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  WORKTREE_DIR,
  excludeWorktreeDir,
  worktreePathFor,
  worktreeRootFor,
} from '../server/utils/worktrees'

const exec = promisify(execFile)

/**
 * Session worktrees live inside the repository, which only works because git is
 * told to ignore them. These cover that arrangement holding.
 */

let root: string
let repo: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'agents-ui-wt-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

beforeEach(async () => {
  repo = await mkdtemp(join(root, 'repo-'))
  await exec('git', ['init', '-q'], { cwd: repo })
  await exec('git', ['config', 'user.email', 't@t.t'], { cwd: repo })
  await exec('git', ['config', 'user.name', 'T'], { cwd: repo })
  await writeFile(join(repo, 'a.txt'), 'hello\n', 'utf-8')
  await exec('git', ['add', '-A'], { cwd: repo })
  await exec('git', ['commit', '-q', '-m', 'init'], { cwd: repo })
})

describe('where worktrees are placed', () => {
  it('puts them inside the repository they belong to', () => {
    expect(worktreeRootFor('/Users/me/workspaces/webapp'))
      .toBe(`/Users/me/workspaces/webapp/${WORKTREE_DIR}`)
    expect(worktreePathFor('/Users/me/workspaces/webapp', 'abc123'))
      .toBe(`/Users/me/workspaces/webapp/${WORKTREE_DIR}/abc123`)
  })

  it('uses a dot-prefixed name, which glob-based tools skip by default', () => {
    expect(WORKTREE_DIR.startsWith('.')).toBe(true)
  })
})

describe('keeping them out of git', () => {
  it('adds the directory to the repository-local exclude file', async () => {
    await excludeWorktreeDir(repo)

    const exclude = await readFile(join(repo, '.git', 'info', 'exclude'), 'utf-8')
    expect(exclude).toContain(`${WORKTREE_DIR}/`)
  })

  it('writes the entry only once, however often it runs', async () => {
    await excludeWorktreeDir(repo)
    await excludeWorktreeDir(repo)
    await excludeWorktreeDir(repo)

    const exclude = await readFile(join(repo, '.git', 'info', 'exclude'), 'utf-8')
    const hits = exclude.split('\n').filter(l => l.trim() === `${WORKTREE_DIR}/`)
    expect(hits).toHaveLength(1)
  })

  it('never touches a tracked file, so nothing appears in a diff', async () => {
    await excludeWorktreeDir(repo)

    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd: repo })
    expect(stdout.trim()).toBe('')
  })

  it('leaves git status clean once a worktree exists', async () => {
    await excludeWorktreeDir(repo)
    await exec('git', ['worktree', 'add', worktreePathFor(repo, 'sess1'), '-b', 'sess1', '-q'], { cwd: repo })

    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd: repo })
    expect(stdout.trim()).toBe('')
  })

  it('stops `git add .` staging the worktree as an embedded repository', async () => {
    // Without the exclude this stages a gitlink, which would commit a broken
    // submodule reference into the user's history.
    await excludeWorktreeDir(repo)
    await exec('git', ['worktree', 'add', worktreePathFor(repo, 'sess1'), '-b', 'sess1', '-q'], { cwd: repo })

    await exec('git', ['add', '.'], { cwd: repo })
    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd: repo })
    expect(stdout).not.toContain(WORKTREE_DIR)
  })

  it('survives `git clean -fdx`, which git refuses to apply to a nested repo', async () => {
    await excludeWorktreeDir(repo)
    const path = worktreePathFor(repo, 'sess1')
    await exec('git', ['worktree', 'add', path, '-b', 'sess1', '-q'], { cwd: repo })

    await exec('git', ['clean', '-fdx'], { cwd: repo })

    const { existsSync } = await import('node:fs')
    expect(existsSync(join(path, 'a.txt'))).toBe(true)
  })
})
