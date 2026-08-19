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

/**
 * A checkout that has moved off the branch the record names.
 *
 * The other half of the same failure, arriving from the head rather than the
 * base. Observed on a real machine: five review sessions recorded their own
 * branch, the agent inside each ran `gh pr checkout`, and every one of them
 * then reported 2,231 changed files and 214 commits ahead — because the base on
 * record and the branch actually checked out last shared a commit four months
 * earlier. Against the repository's default branch the same session was 7 files
 * and 2 commits.
 *
 * Modelled here with the same shape: an old base branch that went its own way, a
 * trunk that moved on, and a session whose checkout is a fresh branch off the
 * trunk.
 */
describe('a checkout that has drifted off its branch', () => {
  let drifted: { worktreePath: string; branch: string; baseBranch: string; baseSha: string }

  beforeAll(async () => {
    const root = git(repoDir, 'rev-list', '--max-parents=0', 'main').split('\n').pop()!

    // The base the session records: an old branch, cut from the root, diverged.
    git(repoDir, 'checkout', '-q', '-b', 'old/base', root)
    await commitOn('old/base', 'old-a.txt', 'the old base went this way\n')

    // The trunk, which is where the work actually being done comes from.
    await commitOn('main', 'trunk-a.txt', 'nobody in this session wrote this\n')
    const trunkTip = git(repoDir, 'rev-parse', 'main')

    // No network in a test, and none needed: the default branch is a ref.
    git(repoDir, 'update-ref', 'refs/remotes/origin/main', 'main')
    git(repoDir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    git(repoDir, 'checkout', '-q', 'main')

    drifted = session('wandered', 'old/base')
    // What `gh pr checkout` does inside the worktree: a different branch, cut
    // from somewhere else entirely.
    git(drifted.worktreePath, 'checkout', '-q', '-b', 'feat/somebody-elses', trunkTip)
    await work(drifted, 'mine.txt', 'the session wrote exactly this\n')
  })

  it('finds the default branch', async () => {
    expect(await worktrees.defaultBranchRef(drifted.worktreePath)).toBe('origin/main')
  })

  it('measures against the default branch instead of a base HEAD is not on', async () => {
    const base = await worktrees.diffBase({ ...drifted, checkedOut: 'feat/somebody-elses' })
    expect(base).toBe('origin/main')

    const diff = await worktrees.worktreeDiff(drifted.worktreePath, base)
    const status = await worktrees.worktreeStatus(drifted.worktreePath, base, drifted.baseBranch)

    // Only its own commit, which is the whole point.
    expect(diff.files.map(f => f.path)).toEqual(['mine.txt'])
    expect(status.ahead).toBe(1)
  })

  it('is what the recorded base gets wrong', async () => {
    // Unchanged behaviour when nobody has read the checkout, which is also the
    // bug: the base on record shares only the root commit with HEAD, so the
    // session is handed the trunk's work as its own.
    const base = await worktrees.diffBase(drifted)
    expect(base).toBe('old/base')

    const diff = await worktrees.worktreeDiff(drifted.worktreePath, base)
    expect(diff.files.map(f => f.path)).toContain('trunk-a.txt')
    expect(diff.files.length).toBeGreaterThan(1)
  })

  it('leaves a worktree nobody has read alone', async () => {
    // "Not asked" must not read as "moved", or every cold poll re-measures every
    // session against the trunk and the base on record stops meaning anything.
    expect(await worktrees.diffBase({ ...drifted, checkedOut: null })).toBe('old/base')
  })

  it('leaves a deliberately detached review session on its recorded base', async () => {
    /*
     * A review session is `git worktree add --detach` on a pull request's head,
     * and its record names that head branch on purpose. The recorded base is the
     * pull request's base, which is exactly what its diff should be measured
     * against — so this case must not be repaired.
     */
    const review = session('reviewing', 'release/2.0')
    git(review.worktreePath, 'checkout', '-q', '--detach', 'HEAD')

    const status = await worktrees.worktreeStatus(review.worktreePath, review.baseSha, review.baseBranch)
    expect(status.branch).toBeNull()

    expect(await worktrees.diffBase({
      ...review,
      branch: 'feat/the-pull-requests-head',
      checkedOut: status.branch,
      detached: true,
    })).toBe('release/2.0')
  })
})
