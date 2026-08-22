import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describeReverted, parseBaseLog, readBaseLog, revertedCommits, standingRevert,
} from '../server/utils/revertWatch'

/**
 * "It merged" is not "it was right".
 *
 * The whole of this is one question asked of a real repository: does the base
 * branch still have the work it took from a session? Which is why most of the
 * tests below build an actual git history and run `git revert` in it rather than
 * feeding hand-written log output to the parser. The three cases that matter are
 * the three that a message-based reading can get wrong:
 *
 *   - a revert, which must be found;
 *   - a revert of that revert, which puts the work back and must un-find it;
 *   - a commit that merely uses the word, which must be found by nothing.
 */

let root: string
let repo: string

function git(args: string[], cwd = repo) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Ada',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Ada',
      GIT_COMMITTER_EMAIL: 'ada@example.com',
    },
  }).trim()
}

/** A session's worth of work, merged into main the way `mergeSession` does it. */
async function landOnMain(branch: string, file: string): Promise<string> {
  git(['checkout', '-q', '-b', branch])
  await writeFile(join(repo, file), 'work\n')
  git(['add', '.'])
  git(['commit', '-qm', `work on ${branch}`])
  git(['checkout', '-q', 'main'])
  git(['merge', '-q', '--no-ff', branch, '-m', `Merge session: ${branch}`])

  return git(['rev-parse', 'HEAD'])
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'agents-ui-revert-'))
})

beforeEach(async () => {
  repo = await mkdtemp(join(root, 'repo-'))

  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'ada@example.com'])
  git(['config', 'user.name', 'Ada'])
  await writeFile(join(repo, 'README.md'), '# hello\n')
  git(['add', '.'])
  git(['commit', '-qm', 'first'])
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {})
})

describe('a revert of work this machine landed', () => {
  it('is found, and says who made it and when', async () => {
    const landed = await landOnMain('sess-1', 'a.txt')
    // `-m 1` is what git requires to revert a merge: undo it against its first
    // parent, which is the base branch as it was.
    git(['revert', '-m', '1', '--no-edit', landed])

    const commits = await readBaseLog(repo, 'main', 0)
    const revert = standingRevert(landed, commits!)

    expect(revert).not.toBeNull()
    expect(revert!.subject).toMatch(/^Revert "Merge session: sess-1"/)
    expect(revert!.by).toBe('Ada')
    expect(revert!.at).toBeGreaterThan(0)
    // The revert is a commit of its own, not the merge it undoes.
    expect(revert!.sha).not.toBe(landed)
  })

  it('is not found before anybody reverts anything', async () => {
    const landed = await landOnMain('sess-1', 'a.txt')

    expect(standingRevert(landed, (await readBaseLog(repo, 'main', 0))!)).toBeNull()
  })

  it('finds only the landing that was reverted, not its neighbour', async () => {
    const first = await landOnMain('sess-1', 'a.txt')
    const second = await landOnMain('sess-2', 'b.txt')
    git(['revert', '-m', '1', '--no-edit', second])

    const commits = (await readBaseLog(repo, 'main', 0))!

    expect(standingRevert(second, commits)).not.toBeNull()
    expect(standingRevert(first, commits)).toBeNull()
  })
})

describe('a revert of a revert', () => {
  it('puts the work back, so nothing stands against the landing', async () => {
    const landed = await landOnMain('sess-1', 'a.txt')
    git(['revert', '-m', '1', '--no-edit', landed])
    const revert = git(['rev-parse', 'HEAD'])
    git(['revert', '--no-edit', revert])

    const commits = (await readBaseLog(repo, 'main', 0))!

    // The second revert's message names the *first revert*, not the merge — so
    // matching the landing's sha alone would still report it as reverted, for as
    // long as the record lived. The chain has to be walked.
    expect(standingRevert(landed, commits)).toBeNull()
  })

  it('takes it back out again when the correction is itself reverted', async () => {
    const landed = await landOnMain('sess-1', 'a.txt')
    git(['revert', '-m', '1', '--no-edit', landed])
    const first = git(['rev-parse', 'HEAD'])
    git(['revert', '--no-edit', first])
    const second = git(['rev-parse', 'HEAD'])
    git(['revert', '--no-edit', second])

    const standing = standingRevert(landed, (await readBaseLog(repo, 'main', 0))!)

    // Three deep: out, back, out. The one that stands is the first revert, since
    // the thing that undid it has itself been undone.
    expect(standing?.sha).toBe(first)
  })
})

describe('a commit that merely mentions the word', () => {
  it('reverts nothing, however much it talks about reverting', async () => {
    const landed = await landOnMain('sess-1', 'a.txt')

    await writeFile(join(repo, 'notes.md'), 'we should revert this\n')
    git(['add', '.'])
    git([
      'commit', '-qm',
      'Revert the retry logic by hand',
      '-m',
      `Not a git revert. This reverts nothing, and mentioning ${landed} does not `
      + 'make it one. See the discussion about whether to revert the merge.',
    ])

    const commits = (await readBaseLog(repo, 'main', 0))!

    expect(standingRevert(landed, commits)).toBeNull()
    // The commit is in the log — it is simply not a revert of anything.
    expect(commits.some(c => c.subject.startsWith('Revert the retry logic'))).toBe(true)
  })

  it('reads a cherry-pick as what it is', async () => {
    // `cherry-pick -x` writes a line naming a commit too, and it is the opposite
    // event: the work arriving rather than leaving.
    const landed = await landOnMain('sess-1', 'a.txt')

    git(['checkout', '-q', '-b', 'elsewhere', 'main'])
    await writeFile(join(repo, 'c.txt'), 'other\n')
    git(['add', '.'])
    git(['commit', '-qm', 'other work'])
    const other = git(['rev-parse', 'HEAD'])
    git(['checkout', '-q', 'main'])
    git(['cherry-pick', '-x', other])

    expect(standingRevert(landed, (await readBaseLog(repo, 'main', 0))!)).toBeNull()
  })
})

describe('reading the base branch', () => {
  it('says it could not ask, rather than that nothing was reverted', async () => {
    // The distinction the whole watch rests on. A null read that was treated as
    // an answer would clear every revert already recorded, the first time a
    // repository was moved or a base branch renamed.
    expect(await readBaseLog(repo, 'no-such-branch', 0)).toBeNull()
    expect(await readBaseLog(join(root, 'not-a-repo'), 'main', 0)).toBeNull()
  })

  it('leaves out commits older than the window it was given', async () => {
    await landOnMain('sess-1', 'a.txt')

    const tomorrow = Date.now() + 2 * 24 * 60 * 60 * 1000
    expect(await readBaseLog(repo, 'main', tomorrow)).toEqual([])
  })

  it('keeps a subject with anything in it but the separators', async () => {
    await writeFile(join(repo, 'odd.txt'), 'x\n')
    git(['add', '.'])
    git(['commit', '-qm', 'fix: a|b, "c" — d/e'])

    const commits = (await readBaseLog(repo, 'main', 0))!

    expect(commits[0]!.subject).toBe('fix: a|b, "c" — d/e')
  })
})

describe('what a revert message says', () => {
  it('reads the sha git writes', () => {
    expect(revertedCommits('Revert "x"\n\nThis reverts commit abc1234def.\n'))
      .toEqual(['abc1234def'])
  })

  it('takes the target of a reverted merge, not the parent it was reverted against', () => {
    // `git revert -m 1` of a merge writes both shas onto one line.
    expect(revertedCommits(
      'Revert "Merge session: x"\n\n'
      + 'This reverts commit 1111111111111111111111111111111111111111, reversing\n'
      + 'changes made to 2222222222222222222222222222222222222222.\n',
    )).toEqual(['1111111111111111111111111111111111111111'])
  })

  it('reads every commit of a batch revert', () => {
    expect(revertedCommits(
      'Revert three things\n\nThis reverts commit aaaaaaa.\n\nThis reverts commit bbbbbbb.\n',
    )).toEqual(['aaaaaaa', 'bbbbbbb'])
  })

  it('ignores prose, a cherry-pick, and a sha too short to be one', () => {
    expect(revertedCommits('Revert the retry logic\n\nWe should revert commit abc1234.\n')).toEqual([])
    expect(revertedCommits('work\n\n(cherry picked from commit abc1234)\n')).toEqual([])
    expect(revertedCommits('Revert "x"\n\nThis reverts commit abc12.\n')).toEqual([])
  })
})

describe('the log parser', () => {
  const FIELD = '\x1f'
  const RECORD = '\x1e'

  it('survives a repository with nothing in the window', () => {
    expect(parseBaseLog('')).toEqual([])
    expect(parseBaseLog('\n')).toEqual([])
  })

  it('leaves out the committer when git has no name for one', () => {
    const entry = `abc1234${FIELD}1700000000${FIELD}${FIELD}subject${FIELD}subject\n${RECORD}`

    expect(parseBaseLog(entry)[0]).toMatchObject({ sha: 'abc1234', at: 1_700_000_000_000 })
    expect(parseBaseLog(entry)[0]!.by).toBeUndefined()
  })
})

/**
 * The poll, against a real store.
 *
 * `CLAUDE_DIR` points at a temporary directory — never the real one, which holds
 * live sessions — and the module is imported fresh each time, because
 * `getClaudeDir` caches the first answer it gives.
 */
describe('the watch, against the session record', () => {
  let home: string

  async function store(sessions: unknown[]) {
    await mkdir(join(home, 'agents-ui'), { recursive: true })
    await writeFile(
      join(home, 'agents-ui', 'sessions.json'),
      JSON.stringify({ version: 1, sessions }),
      'utf-8',
    )
  }

  async function stored(id: string) {
    const raw = await readFile(join(home, 'agents-ui', 'sessions.json'), 'utf-8')
    return JSON.parse(raw).sessions.find((s: { id: string }) => s.id === id)
  }

  function session(over: Record<string, unknown> = {}) {
    return {
      id: 'sess-1',
      title: 'Retry the upload',
      repoDir: repo,
      worktreePath: join(repo, '.worktrees', 'sess-1'),
      branch: 'sess-1',
      baseBranch: 'main',
      baseSha: 'unused',
      status: 'idle',
      runIds: [],
      createdAt: 1,
      updatedAt: 1,
      ...over,
    }
  }

  async function poll() {
    vi.resetModules()
    const { pollReverts } = await import('../server/utils/revertWatch')
    await pollReverts()
  }

  beforeEach(async () => {
    home = await mkdtemp(join(root, 'home-'))
    process.env.CLAUDE_DIR = home
  })

  afterEach(async () => {
    delete process.env.CLAUDE_DIR
  })

  it('records when, by whom, and which landing it undoes', async () => {
    const landed = await landOnMain('sess-1', 'a.txt')
    await store([session({ landed: { at: Date.now(), how: 'merged', into: 'main', sha: landed } })])

    git(['revert', '-m', '1', '--no-edit', landed])
    await poll()

    const record = (await stored('sess-1')).reverted

    expect(record.landedSha).toBe(landed)
    expect(record.branch).toBe('main')
    expect(record.by).toBe('Ada')
    expect(record.committedAt).toBeGreaterThan(0)
    expect(record.subject).toMatch(/^Revert "Merge session: sess-1"/)
  })

  it('leaves a landing nobody reverted alone', async () => {
    const landed = await landOnMain('sess-1', 'a.txt')
    await store([session({ landed: { at: Date.now(), how: 'merged', into: 'main', sha: landed } })])

    await poll()

    expect((await stored('sess-1')).reverted).toBeUndefined()
  })

  it('clears the record when the revert is itself reverted', async () => {
    const landed = await landOnMain('sess-1', 'a.txt')
    await store([session({ landed: { at: Date.now(), how: 'merged', into: 'main', sha: landed } })])

    git(['revert', '-m', '1', '--no-edit', landed])
    await poll()
    expect((await stored('sess-1')).reverted).toBeDefined()

    // The correction, which is the more common half of the pair. Without this the
    // first mistaken revert would mark the session for good.
    git(['revert', '--no-edit', git(['rev-parse', 'HEAD'])])
    await poll()

    expect((await stored('sess-1')).reverted).toBeUndefined()
  })

  it('says nothing about a landing that never named a commit', async () => {
    // Every landing recorded before `SessionLanded.sha` existed looks like this.
    const landed = await landOnMain('sess-1', 'a.txt')
    await store([session({ landed: { at: Date.now(), how: 'merged', into: 'main' } })])

    git(['revert', '-m', '1', '--no-edit', landed])
    await poll()

    expect((await stored('sess-1')).reverted).toBeUndefined()
  })

  it('does not touch a session that never landed', async () => {
    await store([session()])
    await poll()

    expect((await stored('sess-1')).reverted).toBeUndefined()
  })

  it('survives a repository that is no longer on disk', async () => {
    await store([session({
      repoDir: join(root, 'gone'),
      landed: { at: Date.now(), how: 'merged', into: 'main', sha: 'a'.repeat(40) },
    })])

    await expect(poll()).resolves.toBeUndefined()
    expect((await stored('sess-1')).reverted).toBeUndefined()
  })

  it('keeps a recorded revert that has fallen out of the window it can read', async () => {
    // The guard that stops a short log read from erasing real records. The
    // recorded revert is not in this history at all, so nothing is known about
    // whether it still stands — and "unknown" must not clear it.
    await store([session({
      landed: { at: Date.now(), how: 'merged', into: 'main', sha: 'a'.repeat(40) },
      reverted: {
        at: 1, sha: 'b'.repeat(40), committedAt: 1, subject: 'Revert "x"',
        landedSha: 'a'.repeat(40), branch: 'main',
      },
    })])

    await poll()

    expect((await stored('sess-1')).reverted?.sha).toBe('b'.repeat(40))
  })
})

describe('what the record says happened', () => {
  const reverted = {
    at: 1_700_000_000_000,
    sha: 'ffff111',
    committedAt: 1_699_000_000_000,
    subject: 'Revert "Merge session: retry the upload"',
    landedSha: 'aaaa222',
    branch: 'main',
  }

  it('leads with the branch no longer having the work', () => {
    expect(describeReverted(reverted)).toBe('reverted out of main')
  })

  it('names who did it when git knows, and blames nobody', () => {
    const line = describeReverted({ ...reverted, by: 'Ada' })

    expect(line).toBe('reverted out of main by Ada')
    expect(line).not.toMatch(/fail|broke|wrong|bad/i)
  })
})
