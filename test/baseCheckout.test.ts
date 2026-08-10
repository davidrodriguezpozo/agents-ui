import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Two of the things that block a merge are facts about the repository rather than
 * about a session: the checkout has uncommitted changes, or it is on the wrong
 * branch. Both refuse every session equally.
 *
 * Landing used to discover them per-session, and only after running that
 * session's checks — so landing four sessions into a dirty `main` paid for a full
 * test-suite run, refused, and recorded three more as "not attempted". This is
 * the check that makes the refusal free and the state recoverable.
 */

let root: string
let repo: string
let merge: typeof import('../server/utils/merge')

function git(args: string[], cwd = repo) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

beforeAll(async () => {
  merge = await import('../server/utils/merge')
  root = await mkdtemp(join(tmpdir(), 'agents-ui-base-'))
})

beforeEach(async () => {
  repo = await mkdtemp(join(root, 'repo-'))

  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  await writeFile(join(repo, 'README.md'), '# hello\n')
  git(['add', '.'])
  git(['commit', '-m', 'first'])
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {})
})

describe('the checkout everything merges into', () => {
  it('is happy when it is clean and on the base branch', async () => {
    const state = await merge.baseCheckoutState(repo, 'main')

    expect(state).toMatchObject({ currentBranch: 'main', clean: true })
    expect(state.blockedReason).toBeUndefined()
  })

  it('refuses an uncommitted change, and says what to do', async () => {
    // The exact case that got somebody stuck: four sessions ready, main dirty.
    await writeFile(join(repo, 'README.md'), '# changed\n')

    const state = await merge.baseCheckoutState(repo, 'main')

    expect(state.clean).toBe(false)
    expect(state.blockedReason).toMatch(/uncommitted changes/i)
    expect(state.blockedReason).toMatch(/commit or stash/i)
  })

  it('counts an untracked file as uncommitted', async () => {
    // `git status --porcelain` lists it, and merging over it loses it just the
    // same as a modified file.
    await writeFile(join(repo, 'scratch.txt'), 'notes\n')

    expect((await merge.baseCheckoutState(repo, 'main')).clean).toBe(false)
  })

  it('refuses being on a different branch than the sessions branched from', async () => {
    git(['checkout', '-q', '-b', 'somewhere-else'])

    const state = await merge.baseCheckoutState(repo, 'main')

    expect(state.currentBranch).toBe('somewhere-else')
    expect(state.blockedReason).toMatch(/somewhere-else/)
    expect(state.blockedReason).toMatch(/switch to main/i)
  })

  it('reports dirtiness before the wrong branch', async () => {
    // Both true at once: committing is the first thing to do either way, and
    // naming the branch first would send them to switch with work in the tree.
    git(['checkout', '-q', '-b', 'somewhere-else'])
    await writeFile(join(repo, 'README.md'), '# changed\n')

    expect((await merge.baseCheckoutState(repo, 'main')).blockedReason).toMatch(/uncommitted/i)
  })

  it('recovers as soon as the reason is gone', async () => {
    // The whole point of it being a precondition rather than a recorded failure:
    // fix the checkout, ask again, and there is nothing to clear up.
    await writeFile(join(repo, 'README.md'), '# changed\n')
    expect((await merge.baseCheckoutState(repo, 'main')).blockedReason).toBeTruthy()

    git(['add', '.'])
    git(['commit', '-m', 'second'])

    expect((await merge.baseCheckoutState(repo, 'main')).blockedReason).toBeUndefined()
  })
})

describe('what is left to merge', () => {
  it('counts the commits the base does not have', async () => {
    git(['checkout', '-q', '-b', 'sess-1'])
    await writeFile(join(repo, 'a.txt'), 'work\n')
    git(['add', '.'])
    git(['commit', '-qm', 'session work'])
    git(['checkout', '-q', 'main'])

    expect(await merge.unmergedCommitCount(repo, 'main', 'sess-1')).toBe(1)
  })

  it('drops to zero once it has landed, while ahead-from-branch-point does not', async () => {
    // The fact the whole fix rests on. `ahead` is measured from the commit the
    // session branched at, which never moves — so after merging, that number is
    // still 1 and this one is 0. Queueing on the first is what re-attempted work
    // that was already in, and stopped the run doing it.
    const branchPoint = git(['rev-parse', 'HEAD'])

    git(['checkout', '-q', '-b', 'sess-1'])
    await writeFile(join(repo, 'a.txt'), 'work\n')
    git(['add', '.'])
    git(['commit', '-qm', 'session work'])
    git(['checkout', '-q', 'main'])
    git(['merge', '-q', '--no-ff', 'sess-1', '-m', 'Merge session'])

    expect(await merge.unmergedCommitCount(repo, 'main', 'sess-1')).toBe(0)
    expect(git(['rev-list', '--count', `${branchPoint}..sess-1`])).toBe('1')
  })

  it('is zero for a branch that never committed', async () => {
    git(['branch', 'sess-empty'])
    expect(await merge.unmergedCommitCount(repo, 'main', 'sess-empty')).toBe(0)
  })

  it('is zero rather than throwing for a branch that is not there', async () => {
    // A session whose branch was deleted by hand should not take the plan down.
    expect(await merge.unmergedCommitCount(repo, 'main', 'no-such-branch')).toBe(0)
  })
})
