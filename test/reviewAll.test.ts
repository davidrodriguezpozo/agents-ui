import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetDecision } from '../server/utils/budget'
import type { DecoratedPull, Pull } from '../server/utils/reviews'

/**
 * Reviewing the whole band with one press.
 *
 * The composition, not the parts: `startSessionFromRef` already cuts a detached
 * worktree and `turnForIntent` already writes the review turn, and both are
 * tested where they live. What is decided here and nowhere else is what happens
 * to the *press* — that the cap and the budget refuse it whole, that one pull
 * request refusing to check out costs only itself, and that N presses' worth of
 * workspaces come out of one.
 *
 * Real git throughout, because the property being claimed is git's: N detached
 * checkouts of N commits can coexist, and a branch checkout could not. The
 * scratch repository has a real `origin` with real `refs/pull/N/head` refs in
 * it, so the fetch each review does is the fetch it does in life. The only thing
 * stubbed on that path is `gh pr view` — GitHub is not reachable from a test and
 * pretending otherwise would be the fake worth not having.
 */

interface Fixture {
  number: number
  title: string
  branch: string
  /** The commit at its head. Empty for a pull request `origin` has no ref for. */
  sha: string
}

const state = {
  pulls: [] as Fixture[],
  /** What `readPulls` says, so a GitHub outage can be asked about too. */
  ok: true,
  budget: { allowed: true, spentToday: 0 } as BudgetDecision,
}

const turns: { sessionId: string; worktreePath: string; input: string }[] = []

vi.mock('../server/utils/budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/utils/budget')>()),
  checkBudget: async () => state.budget,
}))

vi.mock('../server/utils/sessionTurn', () => ({
  startTurn: async (session: { id: string; worktreePath: string }, input: string) => {
    turns.push({ sessionId: session.id, worktreePath: session.worktreePath, input })
    return `run-${turns.length}`
  },
}))

// `turnForIntent` and `decorate` stay real: the turn a batch sends has to be the
// turn one press sends, and a second copy of either here would prove nothing.
vi.mock('../server/utils/reviews', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/utils/reviews')>()
  return {
    ...actual,
    readPulls: async () => (state.ok
      ? {
          ok: true,
          repo: 'acme/thing',
          viewer: 'me',
          reviewing: state.pulls.map(f => actual.decorate(pullFor(f))),
          mine: [],
          summary: { onYou: state.pulls.length, toReview: state.pulls.length, toMerge: 0, waiting: 0 },
          readAt: Date.now(),
        }
      : {
          ok: false,
          refusal: 'unreachable',
          reason: 'GitHub could not be reached for acme/thing.',
          repo: null,
          viewer: null,
          reviewing: [],
          mine: [],
          summary: { onYou: 0, toReview: 0, toMerge: 0, waiting: 0 },
          readAt: Date.now(),
        }),
  }
})

// The one `gh` call on the path. Everything downstream of it — the fetch, the
// worktree, the record — is the real thing against the scratch repository.
vi.mock('../server/utils/pullRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/utils/pullRequest')>()
  return {
    ...actual,
    resolvePullRequest: async (_cwd: string, ref: string) => {
      const found = state.pulls.find(f => f.number === Number(ref))
      if (!found) throw Object.assign(new Error('pr_not_found'), { statusCode: 404 })
      return {
        number: found.number,
        title: found.title,
        url: `https://github.com/acme/thing/pull/${found.number}`,
        headBranch: found.branch,
        headSha: found.sha,
        baseBranch: 'main',
        state: 'OPEN',
        isFork: false,
      }
    },
  }
})

function pullFor(f: Fixture): Pull {
  return {
    number: f.number,
    title: f.title,
    url: `https://github.com/acme/thing/pull/${f.number}`,
    author: 'someone-else',
    mine: false,
    draft: false,
    headBranch: f.branch,
    baseBranch: 'main',
    headSha: f.sha,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    additions: 4,
    deletions: 1,
    changedFiles: 2,
    reviewDecision: 'REVIEW_REQUIRED',
    mergeable: 'MERGEABLE',
    checks: 'passing',
    failing: [],
    awaiting: [{ name: 'me', team: false }],
    labels: [],
    unresolved: 0,
    approvals: 0,
    changesRequested: 0,
  }
}

const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.createError = (init: any) => Object.assign(new Error(init.data?.message ?? init.message), init)
globals.getQuery = () => ({})
globals.getCookie = () => undefined

let root: string
let claudeDir: string
let repo: string
let origin: string
let sessions: typeof import('../server/utils/sessions')
let post: (event: unknown) => Promise<any>

function git(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

/** A branch with a commit on it, published as `refs/pull/<number>/head`. */
async function publish(number: number, title: string): Promise<Fixture> {
  const branch = `pr-${number}`
  git(['checkout', '-q', '-b', branch, 'main'])
  await writeFile(join(repo, `${branch}.md`), `# ${title}\n`)
  git(['add', '.'])
  git(['commit', '-q', '-m', title])
  const sha = git(['rev-parse', 'HEAD'])
  git(['push', '-q', 'origin', `HEAD:refs/pull/${number}/head`])
  git(['checkout', '-q', 'main'])
  // Deleted locally so the only way to the commit is the fetch a review does.
  git(['branch', '-q', '-D', branch])
  return { number, title, branch, sha }
}

function asking(body: Record<string, unknown>) {
  globals.readBody = async () => body
  return {}
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agents-ui-review-all-'))
  claudeDir = join(root, 'claude')
  await mkdir(claudeDir, { recursive: true })
  process.env.CLAUDE_DIR = claudeDir

  origin = join(root, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])

  repo = join(root, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  git(['remote', 'add', 'origin', origin])
  await writeFile(join(repo, 'README.md'), '# thing\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'first'])
  git(['push', '-q', 'origin', 'main'])

  globals.getHeader = (_event: unknown, name: string) =>
    (name === 'x-project-dir' ? repo : undefined)

  const claude = await import('../server/utils/claudeDir')
  claude.setClaudeDir(claudeDir)

  sessions = await import('../server/utils/sessions')
  await sessions.writeSessions([])

  post = (await import('../server/api/github/pulls/review-all.post')).default as unknown as typeof post

  state.pulls = []
  state.ok = true
  state.budget = { allowed: true, spentToday: 0 }
  turns.length = 0
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {})
  delete process.env.CLAUDE_DIR
})

describe('reviewing every pull request in the band', () => {
  it('gives N sessions for N pull requests, each detached at that one', async () => {
    state.pulls = [
      await publish(11, 'Rename the thing'),
      await publish(12, 'Delete the other thing'),
      await publish(13, 'Add a third thing'),
    ]

    const result = await post(asking({ numbers: [11, 12, 13] }))

    expect(result.failed).toEqual([])
    expect(result.started).toHaveLength(3)

    // Its own workspace each, no two the same, and none of them holding a branch.
    const paths = result.started.map((s: any) => s.worktreePath)
    expect(new Set(paths).size).toBe(3)

    for (const [index, fixture] of state.pulls.entries()) {
      const session = result.started[index]
      expect(session.detached).toBe(true)
      expect(session.baseSha).toBe(fixture.sha)
      expect(session.reviewOf).toMatchObject({ number: fixture.number, headSha: fixture.sha })

      expect(existsSync(session.worktreePath)).toBe(true)
      expect(git(['rev-parse', 'HEAD'], session.worktreePath)).toBe(fixture.sha)
      // Detached: the commit, not the branch, which is what lets three of these
      // exist at once and lets a fourth start while a session fixes one.
      expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], session.worktreePath)).toBe('HEAD')
    }

    // Every one of them recorded, and every one of them already working.
    expect((await sessions.readSessions())).toHaveLength(3)
    expect(result.started.map((s: any) => s.runId)).toEqual(['run-1', 'run-2', 'run-3'])
  })

  it('sends each one the review turn for its own pull request, and posts nothing', async () => {
    state.pulls = [await publish(11, 'Rename the thing'), await publish(12, 'Delete the other thing')]

    await post(asking({ numbers: [11, 12] }))

    expect(turns).toHaveLength(2)
    expect(turns[0]!.input).toContain('#11 — "Rename the thing"')
    expect(turns[1]!.input).toContain('#12 — "Delete the other thing"')

    // The line that makes starting twenty-six of these safe. A batch that could
    // post would be the one change this unit must not make.
    for (const turn of turns) {
      expect(turn.input).toContain('Do not post anything to GitHub')
      // The commit that landed in the workspace, not the one GitHub named.
      expect(turn.input).toContain(git(['rev-parse', 'HEAD'], turn.worktreePath).slice(0, 12))
    }
  })

  it('reviews the same pull request once, however many times it was asked for', async () => {
    state.pulls = [await publish(11, 'Rename the thing')]

    const result = await post(asking({ numbers: [11, 11, 11] }))

    expect(result.started).toHaveLength(1)
  })
})

describe('what refuses the whole press', () => {
  it('refuses above the cap rather than doing some of it', async () => {
    const numbers = Array.from({ length: 21 }, (_, i) => i + 1)

    await expect(post(asking({ numbers }))).rejects.toMatchObject({
      statusCode: 400,
      data: { error: 'too_many' },
    })

    // Nothing started, which is the half that matters: truncating to twenty
    // would have left one unreviewed and said nothing about it.
    expect(await sessions.readSessions()).toEqual([])
    expect(turns).toEqual([])
  })

  it('starts nothing when the budget says no, and says what the budget said', async () => {
    state.pulls = [await publish(11, 'Rename the thing'), await publish(12, 'Delete the other thing')]
    state.budget = {
      allowed: false,
      reason: 'Today has cost $12.40 of a $10.00 cap.',
      spentToday: 12.4,
    }

    await expect(post(asking({ numbers: [11, 12] }))).rejects.toMatchObject({
      statusCode: 429,
      data: { error: 'over_budget', message: 'Today has cost $12.40 of a $10.00 cap.' },
    })

    // One check for the press, not one per pull request: two workspaces cut and
    // the third refused would be the worst of both.
    expect(await sessions.readSessions()).toEqual([])
  })

  it('needs to be told which ones', async () => {
    await expect(post(asking({}))).rejects.toMatchObject({ statusCode: 400, data: { error: 'no_numbers' } })
    await expect(post(asking({ numbers: [] }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('says GitHub could not be read rather than reviewing nothing quietly', async () => {
    state.ok = false

    await expect(post(asking({ numbers: [11] }))).rejects.toMatchObject({
      statusCode: 502,
      data: { error: 'github_unavailable' },
    })
  })
})

describe('when one of them will not start', () => {
  it('costs only itself, and comes back in failed', async () => {
    state.pulls = [
      await publish(11, 'Rename the thing'),
      // Announced by GitHub, with no `refs/pull/12/head` behind it — so the
      // fetch every review does fails for this one and only this one.
      { number: 12, title: 'A pull request whose commits are not there', branch: 'pr-12', sha: '' },
      await publish(13, 'Add a third thing'),
    ]

    const result = await post(asking({ numbers: [11, 12, 13] }))

    expect(result.started.map((s: any) => s.reviewOf.number)).toEqual([11, 13])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].number).toBe(12)
    expect(result.failed[0].reason).toBeTruthy()

    // The other two are working, not merely created.
    expect(turns).toHaveLength(2)
  })

  it('reports a pull request that has left the list without stopping the rest', async () => {
    state.pulls = [await publish(11, 'Rename the thing')]

    const result = await post(asking({ numbers: [11, 99] }))

    expect(result.started).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ number: 99 })
    expect(result.failed[0].reason).toContain('#99')
  })
})
