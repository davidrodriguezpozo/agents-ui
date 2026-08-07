import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const run = promisify(execFile)

// h3 puts a refusal's wording in `data.message`; the server's own helper does
// the same, so the stub has to look there too or every assertion reads 'error'.
;(globalThis as any).createError = (init: any) =>
  Object.assign(new Error(init?.data?.message ?? init?.message ?? 'error'), init)

/**
 * The executor, against real git.
 *
 * This merges branches, so testing it by reading it is not enough. Everything
 * below builds an actual repository with actual worktrees and checks what is
 * in the base branch afterwards.
 *
 * The case that matters is the second session. It branched from the same
 * commit as the first, so the moment the first lands it is behind — and its
 * checks, however green, were taken against a base that no longer exists.
 */

let home: string
let repo: string
let lander: typeof import('../server/utils/lander')

const git = (cwd: string, args: string[]) => run('git', args, { cwd })

async function commitAll(cwd: string, message: string) {
  await git(cwd, ['add', '-A'])
  await git(cwd, ['commit', '-q', '-m', message])
}

/** A session, as the app records one: a branch, a worktree, and a row on disk. */
async function makeSession(id: string, file: string, contents: string) {
  const worktreePath = join(repo, '.worktrees', id)
  const baseSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim()

  await git(repo, ['worktree', 'add', '-q', '-b', id, worktreePath, 'main'])
  await writeFile(join(worktreePath, file), contents, 'utf-8')
  await commitAll(worktreePath, `work in ${id}`)

  return {
    id,
    title: `session ${id}`,
    repoDir: repo,
    worktreePath,
    branch: id,
    baseBranch: 'main',
    baseSha,
    status: 'idle',
    runIds: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

async function writeSessions(sessions: unknown[]) {
  await mkdir(join(home, 'agents-ui'), { recursive: true })
  await writeFile(join(home, 'agents-ui', 'sessions.json'), JSON.stringify({ version: 1, sessions }), 'utf-8')
}

/** `checkCommandFor` reads this; an explicit command beats detection. */
async function setCheck(command: string) {
  await mkdir(join(home, 'agents-ui'), { recursive: true })
  await writeFile(
    join(home, 'agents-ui', 'project-checks.json'),
    JSON.stringify({ version: 1, projects: { [repo]: command } }),
    'utf-8',
  )
}

async function landed(): Promise<import('../server/utils/landingRuns').LandingRun> {
  // Same module instance the lander is writing through, after the reset above.
  const { readLandingRuns } = await import('../server/utils/landingRuns')

  // The run is detached, so wait for it to finish rather than guessing.
  for (let i = 0; i < 200; i++) {
    const [latest] = await readLandingRuns()
    if (latest && latest.status !== 'running') return latest
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('the landing run never finished')
}

const mainLog = async () =>
  (await git(repo, ['log', '--oneline', 'main'])).stdout

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'agents-ui-lander-home-'))
  repo = await mkdtemp(join(tmpdir(), 'agents-ui-lander-repo-'))
  process.env.CLAUDE_DIR = home

  await git(repo, ['init', '-q', '-b', 'main'])
  await git(repo, ['config', 'user.email', 'test@example.com'])
  await git(repo, ['config', 'user.name', 'Test'])
  await writeFile(join(repo, 'README.md'), 'start\n', 'utf-8')
  await commitAll(repo, 'first')

  // What `excludeWorktreeDir` does for a real project. Without it the base
  // checkout has an untracked `.worktrees/` in it, reads as dirty, and every
  // merge is refused — correctly, which is why the fixture has to match.
  await mkdir(join(repo, '.git', 'info'), { recursive: true })
  await writeFile(join(repo, '.git', 'info', 'exclude'), '.worktrees/\n', 'utf-8')

  // Fresh modules per test: the "one landing per repo" guard is module state,
  // and the stores cache the directory they were first asked about.
  vi.resetModules()
  lander = await import('../server/utils/lander')
})

afterEach(async () => {
  // A detached run may still be writing; a failed cleanup is not a failed test.
  await rm(home, { recursive: true, force: true }).catch(() => {})
  await rm(repo, { recursive: true, force: true }).catch(() => {})
  delete process.env.CLAUDE_DIR
})

describe('landing several sessions', () => {
  it('merges them all, re-checking each against the base the last one left', async () => {
    // The whole point: `b` is green against the original main, and behind the
    // moment `a` lands. It must not be merged on the strength of that verdict.
    await writeSessions([
      await makeSession('a', 'a.txt', 'a\n'),
      await makeSession('b', 'b.txt', 'b\n'),
    ])
    await setCheck('test -f README.md')

    await lander.startLanding(repo, 'main')
    const result = await landed()

    expect(result.status).toBe('completed')
    expect(result.steps.map(s => s.outcome)).toEqual(['merged', 'merged'])

    const log = await mainLog()
    expect(log).toContain('work in a')
    expect(log).toContain('work in b')

    // Both files really are on main, not merely claimed to be.
    expect(await readFile(join(repo, 'a.txt'), 'utf-8')).toBe('a\n')
    expect(await readFile(join(repo, 'b.txt'), 'utf-8')).toBe('b\n')
  })

  it('merges nothing when the checks fail', async () => {
    await writeSessions([await makeSession('a', 'a.txt', 'a\n')])
    await setCheck('exit 1')

    await lander.startLanding(repo, 'main')
    const result = await landed()

    expect(result.steps[0]!.outcome).toBe('checks-failed')
    expect(await mainLog()).not.toContain('work in a')
  })

  it('carries on past a session that fails, rather than abandoning the rest', async () => {
    // One bad session should not cost the others their merge.
    await writeSessions([
      await makeSession('good', 'good.txt', 'ok\n'),
      await makeSession('bad', 'bad.txt', 'no\n'),
    ])
    // Fails only in the worktree that contains bad.txt.
    await setCheck('test ! -f bad.txt')

    await lander.startLanding(repo, 'main')
    const result = await landed()

    const byId = Object.fromEntries(result.steps.map(s => [s.sessionId, s.outcome]))
    expect(byId.good).toBe('merged')
    expect(byId.bad).toBe('checks-failed')
    expect(await mainLog()).toContain('work in good')
    expect(await mainLog()).not.toContain('work in bad')
  })

  it('sweeps up uncommitted work rather than dropping it', async () => {
    const session = await makeSession('a', 'a.txt', 'a\n')
    await writeFile(join(session.worktreePath, 'late.txt'), 'left behind\n', 'utf-8')
    await writeSessions([session])
    await setCheck('true')

    await lander.startLanding(repo, 'main')
    await landed()

    expect(await readFile(join(repo, 'late.txt'), 'utf-8')).toBe('left behind\n')
  })

  it('will not merge a project that has no checks', async () => {
    // Nothing could vouch for it, and this runs unattended.
    await writeSessions([await makeSession('a', 'a.txt', 'a\n')])
    await setCheck('')

    await lander.startLanding(repo, 'main')
    const result = await landed()

    expect(result.steps[0]!.outcome).toBe('no-checks')
    expect(await mainLog()).not.toContain('work in a')
  })

  it('refuses to start when nothing is ready', async () => {
    await writeSessions([])
    await expect(lander.startLanding(repo, 'main')).rejects.toThrow(/nothing to land/i)
  })

  it('refuses a second run while one is going', async () => {
    await writeSessions([await makeSession('a', 'a.txt', 'a\n')])
    await setCheck('true')

    await lander.startLanding(repo, 'main')
    await expect(lander.startLanding(repo, 'main')).rejects.toThrow(/already landing/i)
    await landed()
  })

  it('records why each skipped session was left alone', async () => {
    const failing = await makeSession('broken', 'x.txt', 'x\n')
    await writeSessions([
      await makeSession('a', 'a.txt', 'a\n'),
      { ...failing, check: { status: 'failing', command: 'test' } },
    ])
    await setCheck('true')

    await lander.startLanding(repo, 'main')
    const result = await landed()

    expect(result.skipped.map(s => s.sessionId)).toEqual(['broken'])
    expect(result.skipped[0]!.reason).toContain('checks fail')
  })
})

/**
 * The reason this cannot be "call merge six times".
 *
 * Both sessions are green against the original main. `a` adds a file that `b`
 * depends on being absent — a clean textual merge that breaks the moment both
 * are in. Git has nothing to say about it; only re-running the checks after
 * the base moves catches it.
 */
describe('the second session', () => {
  it('is caught by its re-check when the first one breaks it', async () => {
    await writeSessions([
      await makeSession('a', 'poison.txt', 'this breaks b\n'),
      await makeSession('b', 'b.txt', 'b\n'),
    ])
    // Asymmetric on purpose: "if b.txt is here, poison.txt must not be".
    //   a's worktree  — poison, no b.txt      → passes
    //   b's worktree  — b.txt, no poison      → passes
    //   b after a lands — both                → fails
    // Neither session is broken. The combination is, and only a check taken
    // after the base moved can see it.
    await setCheck('test ! -f b.txt || test ! -f poison.txt')

    await lander.startLanding(repo, 'main')
    const result = await landed()

    const byId = Object.fromEntries(result.steps.map(s => [s.sessionId, s.outcome]))
    expect(byId.a).toBe('merged')
    expect(byId.b).toBe('checks-failed')

    // The important half: b did not land on the strength of a verdict taken
    // before a existed.
    expect(await mainLog()).toContain('work in a')
    expect(await mainLog()).not.toContain('work in b')
  })
})
