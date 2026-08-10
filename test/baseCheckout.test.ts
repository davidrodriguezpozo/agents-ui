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
let hasLanded: typeof import('../server/utils/lander')['hasLanded']

function git(args: string[], cwd = repo) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

beforeAll(async () => {
  merge = await import('../server/utils/merge')
  // Pure, and the pairing rule it encodes is the point of the tests below.
  ;({ hasLanded } = await import('../server/utils/lander'))
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

describe('which branches the base already contains', () => {
  async function commitOn(branch: string, file: string) {
    git(['checkout', '-q', '-b', branch])
    await writeFile(join(repo, file), 'work\n')
    git(['add', '.'])
    git(['commit', '-qm', `work on ${branch}`])
    git(['checkout', '-q', 'main'])
  }

  it('leaves out a branch with work still outstanding', async () => {
    await commitOn('sess-1', 'a.txt')
    expect(await merge.mergedBranches(repo, 'main')).not.toContain('sess-1')
  })

  it('includes it once it has landed, while ahead-from-branch-point does not move', async () => {
    // The fact the whole fix rests on. `ahead` is measured from the commit the
    // session branched at, which never moves — so after merging it still reads 1.
    // Queueing on that is what re-attempted work already in the base.
    const branchPoint = git(['rev-parse', 'HEAD'])
    await commitOn('sess-1', 'a.txt')
    git(['merge', '-q', '--no-ff', 'sess-1', '-m', 'Merge session'])

    expect(await merge.mergedBranches(repo, 'main')).toContain('sess-1')
    expect(git(['rev-list', '--count', `${branchPoint}..sess-1`])).toBe('1')
  })

  it('includes a branch that never committed, which is why "landed" needs both halves', async () => {
    // Its tip *is* the base commit, so git calls it merged. Calling that landed
    // would describe an empty session as a finished one.
    git(['branch', 'sess-empty'])

    expect(await merge.mergedBranches(repo, 'main')).toContain('sess-empty')
    expect(hasLanded('sess-empty', 0, await merge.mergedBranches(repo, 'main'))).toBe(false)
  })

  it('calls a branch landed only when it both committed and is contained', async () => {
    await commitOn('sess-1', 'a.txt')
    const before = await merge.mergedBranches(repo, 'main')
    expect(hasLanded('sess-1', 1, before)).toBe(false)

    git(['merge', '-q', '--no-ff', 'sess-1', '-m', 'Merge session'])
    expect(hasLanded('sess-1', 1, await merge.mergedBranches(repo, 'main'))).toBe(true)
  })

  it('is empty rather than throwing when the base branch is not there', async () => {
    // A session whose base branch was renamed should not take the plan down.
    expect(await merge.mergedBranches(repo, 'no-such-branch')).toEqual(new Set())
  })
})

describe('what a session that already landed is told', () => {
  /** Enough of a Session for `previewMerge`, with a real worktree behind it. */
  async function sessionOn(branch: string, file: string) {
    const worktreePath = join(root, `wt-${branch}`)
    const baseSha = git(['rev-parse', 'HEAD'])

    git(['worktree', 'add', '-q', '-b', branch, worktreePath, 'main'])
    await writeFile(join(worktreePath, file), 'work\n')
    git(['add', '.'], worktreePath)
    git(['commit', '-qm', `work on ${branch}`], worktreePath)

    return {
      id: branch, title: branch, repoDir: repo, branch, baseBranch: 'main',
      baseSha, worktreePath, status: 'idle',
      check: { status: 'passing', command: 'make check', fingerprint: '', exitCode: 0, output: '', durationMs: 1, at: 1 },
    } as any
  }

  it('says its work is already in the base, not that it never committed', async () => {
    // The sentence a real record carries: "This session has not committed
    // anything yet, so there is nothing to merge." — about a session showing 16
    // commits. Both halves of that were computed from different baselines.
    const session = await sessionOn('landed-sess', 'a.txt')
    git(['merge', '-q', '--no-ff', 'landed-sess', '-m', 'Merge session'])

    const preview = await merge.previewMerge(session)

    expect(preview.canMerge).toBe(false)
    expect(preview.blockedBy).toBe('already-landed')
    expect(preview.blockedReason).toMatch(/already in main/i)
    expect(preview.blockedReason).not.toMatch(/not committed anything/i)
  })

  it('still says "not committed anything" when that is the truth', async () => {
    const worktreePath = join(root, 'wt-empty')
    const baseSha = git(['rev-parse', 'HEAD'])
    git(['worktree', 'add', '-q', '-b', 'empty-sess', worktreePath, 'main'])

    const preview = await merge.previewMerge({
      id: 'e', title: 'e', repoDir: repo, branch: 'empty-sess', baseBranch: 'main',
      baseSha, worktreePath, status: 'idle', check: null,
    } as any)

    expect(preview.blockedBy).toBe('no-commits')
    expect(preview.blockedReason).toMatch(/not committed anything/i)
  })
})
