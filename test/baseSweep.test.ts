import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Bringing a moved base into the sessions left behind, over real repositories.
 *
 * The plan is pure and could be tested with objects, and half of this file does
 * that. The other half cannot: whether a merge conflicts, what git leaves in the
 * workspace when it does, and which paths hold a branch are all things only git
 * can answer, and getting any of them wrong writes to somebody's workspace.
 *
 * Two of the pass's four operations are never called for real here. Starting a
 * turn spawns an agent and re-checking runs a project's whole suite; both are
 * injected, and the injection is what the assertions read to prove the pass asked
 * for the right thing.
 */

let repo: string
let claudeDir: string
let sweep: typeof import('../server/utils/baseSweep')
let sweeper: typeof import('../server/utils/baseSweeper')
let sessions: typeof import('../server/utils/sessions')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** A session record complete enough for the readers this pass uses. */
function record(id: string, branch: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    repoDir: repo,
    worktreePath: join(repo, '.worktrees', id),
    branch,
    baseBranch: 'main',
    baseSha: git(repo, 'rev-parse', 'main'),
    createdAt: 1,
    status: 'idle',
    runIds: [],
    ...over,
  }
}

/** Hooks that record what they were asked for instead of doing it. */
function fakeHooks(over: Partial<import('../server/utils/baseSweeper').SweepHooks> = {}) {
  const asked: { id: string; prompt: string }[] = []
  const rechecked: string[] = []

  return {
    asked,
    rechecked,
    hooks: {
      update: sweeper.REAL_HOOKS.update,
      conflicts: sweeper.REAL_HOOKS.conflicts,
      recheck: async (id: string) => {
        rechecked.push(id)
        return { status: 'passing' }
      },
      askToResolve: async (session: { id: string }, prompt: string) => {
        asked.push({ id: session.id, prompt })
        return 'run-1'
      },
      ...over,
    } as import('../server/utils/baseSweeper').SweepHooks,
  }
}

beforeEach(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-sweep-cfg-'))
  process.env.CLAUDE_DIR = claudeDir
  repo = await mkdtemp(join(tmpdir(), 'agents-ui-sweep-repo-'))

  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 't@e.com')
  git(repo, 'config', 'user.name', 'T')
  await writeFile(join(repo, 'shared.txt'), 'one\n', 'utf8')
  await writeFile(join(repo, 'mine.txt'), 'mine\n', 'utf8')
  git(repo, 'add', 'shared.txt', 'mine.txt')
  git(repo, 'commit', '-q', '-m', 'base')

  // What `excludeWorktreeDir` does in the app. Without it a `git add` in the
  // root commits the worktrees themselves as gitlinks, and every merge below
  // then conflicts on a directory nobody wrote.
  await writeFile(join(repo, '.git/info/exclude'), '.worktrees/\n.elsewhere/\n', 'utf8')

  const claude = await import('../server/utils/claudeDir')
  claude.setClaudeDir(claudeDir)
  sweep = await import('../server/utils/baseSweep')
  sweeper = await import('../server/utils/baseSweeper')
  sessions = await import('../server/utils/sessions')
})

afterEach(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(repo, { recursive: true, force: true })
})

/** A worktree on its own branch, one commit ahead, touching `file`. */
async function worktree(id: string, file: string, contents: string) {
  const path = join(repo, '.worktrees', id)
  git(repo, 'worktree', 'add', '-q', path, '-b', id)
  await writeFile(join(path, file), contents, 'utf8')
  git(path, 'add', file)
  git(path, 'commit', '-q', '-m', `${id} changed ${file}`)
  return path
}

/** Move main on, which is what makes everybody else behind. */
async function advanceMain(file: string, contents: string) {
  await writeFile(join(repo, file), contents, 'utf8')
  git(repo, 'add', file)
  git(repo, 'commit', '-q', '-m', 'main moved')
}

describe('the plan', () => {
  const input = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    title: 'One',
    status: 'idle' as const,
    branch: 's1',
    baseBranch: 'main',
    repoDir: '/w/app',
    worktreePath: '/w/app/.worktrees/s1',
    inBase: false,
    landedAndHeld: false,
    behind: 2,
    dirty: false,
    worktreeExists: true,
    busy: false,
    ...over,
  })

  it('brings forward a session that is behind and otherwise fine', () => {
    const plan = sweep.planSweep('/w/app', 'main', [input()])

    expect(plan.updating).toBe(1)
    expect(plan.candidates[0]).toMatchObject({ disposition: 'update', behind: 2 })
  })

  it('leaves a session that is already current alone, and says so', () => {
    const plan = sweep.planSweep('/w/app', 'main', [input({ behind: 0 })])

    expect(plan.updating).toBe(0)
    expect(plan.candidates[0]).toMatchObject({ disposition: 'current' })
    expect(plan.candidates[0]!.reason).toContain('Already up to date')
  })

  it('skips a session mid-turn, because two agents in one worktree is the thing sessions prevent', () => {
    const plan = sweep.planSweep('/w/app', 'main', [input({ busy: true })])

    expect(plan.candidates[0]).toMatchObject({ disposition: 'skip' })
    expect(plan.candidates[0]!.reason).toContain('Still working')
  })

  it('never touches a branch another checkout is holding', () => {
    const plan = sweep.planSweep('/w/app', 'main', [input({ heldElsewhere: '/w/app' })])

    expect(plan.candidates[0]).toMatchObject({ disposition: 'skip' })
    expect(plan.candidates[0]!.reason).toContain('/w/app')
    expect(plan.candidates[0]!.reason).toContain('somebody else is standing on')
  })

  it('skips dirty, closed, missing, detached and already-landed workspaces', () => {
    const plan = sweep.planSweep('/w/app', 'main', [
      input({ id: 'dirty', dirty: true }),
      input({ id: 'closed', status: 'archived' }),
      input({ id: 'gone', worktreeExists: false }),
      input({ id: 'review', detached: true }),
      input({ id: 'landed', landedAndHeld: true }),
    ])

    expect(plan.updating).toBe(0)
    expect(plan.candidates.every(c => c.disposition === 'skip')).toBe(true)
  })

  it('takes the furthest behind first', () => {
    const plan = sweep.planSweep('/w/app', 'main', [
      input({ id: 'near', title: 'Near', behind: 1 }),
      input({ id: 'far', title: 'Far', behind: 9 }),
    ])

    expect(plan.candidates.map(c => c.id)).toEqual(['far', 'near'])
  })

  it('ignores sessions in another repository entirely', () => {
    const plan = sweep.planSweep('/w/app', 'main', [input({ repoDir: '/w/other' })])

    expect(plan.candidates).toEqual([])
  })
})

describe('over real repositories', () => {
  it('brings a clean session forward and re-runs its checks', async () => {
    await worktree('s1', 'mine.txt', 'changed by s1\n')
    await advanceMain('shared.txt', 'two\n')
    await sessions.writeSessions([record('s1', 's1') as never])

    const { asked, rechecked, hooks } = fakeHooks()
    const { results } = await sweeper.runBaseSweep(repo, 'main', hooks)

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: 's1', outcome: 'updated', check: 'passing' })
    expect(rechecked).toEqual(['s1'])
    expect(asked).toEqual([])

    // The base really is in the workspace now.
    expect(await readFile(join(repo, '.worktrees/s1/shared.txt'), 'utf8')).toBe('two\n')
  })

  it('leaves a conflict in the workspace and asks the session to resolve it', async () => {
    await worktree('s1', 'shared.txt', 'session says this\n')
    await advanceMain('shared.txt', 'main says that\n')
    await sessions.writeSessions([record('s1', 's1') as never])

    const { asked, rechecked, hooks } = fakeHooks()
    const { results } = await sweeper.runBaseSweep(repo, 'main', hooks)

    expect(results[0]).toMatchObject({ id: 's1', outcome: 'conflicted', runId: 'run-1' })
    expect(results[0]!.conflicts).toEqual(['shared.txt'])
    // Not re-checked: there is nothing to check until the conflict is resolved.
    expect(rechecked).toEqual([])

    // The prompt names the base and the file, and nothing else.
    expect(asked[0]!.prompt).toContain('`main`')
    expect(asked[0]!.prompt).toContain('- shared.txt')

    // Left mid-merge on purpose: the session needs both sides in front of it.
    const status = git(join(repo, '.worktrees/s1'), 'status', '--porcelain')
    expect(status).toContain('UU shared.txt')
  })

  it('reads a held branch off the real state, and it is the session own worktree that is allowed', async () => {
    const path = await worktree('s1', 'mine.txt', 'one\n')
    await advanceMain('shared.txt', 'two\n')
    await sessions.writeSessions([record('s1', 's1') as never])

    // The ordinary case first: the session's own worktree holds its own branch,
    // which on macOS git reports through `/private` while the record does not.
    // Comparing those two strings raw made every session look held elsewhere.
    expect((await sweeper.planBaseSweep(repo, 'main')).updating).toBe(1)

    /*
     * Now the case the guard is for. git will not let two worktrees hold one
     * branch, so the reachable state is a session whose own workspace has moved
     * off its branch — `gh pr checkout` inside it — while something else has
     * taken it. Here the main checkout does.
     */
    git(path, 'checkout', '-q', '--detach')
    git(repo, 'checkout', '-q', 's1')

    const plan = await sweeper.planBaseSweep(repo, 'main')

    expect(plan.updating).toBe(0)
    expect(plan.candidates[0]!.reason).toContain('somebody else is standing on')
  })

  it('does nothing to a session that is already up to date', async () => {
    await worktree('s1', 'mine.txt', 'one\n')
    await sessions.writeSessions([record('s1', 's1') as never])

    const { hooks } = fakeHooks()
    const { plan, results } = await sweeper.runBaseSweep(repo, 'main', hooks)

    expect(plan.candidates[0]).toMatchObject({ disposition: 'current' })
    expect(results).toEqual([])
  })

  it('carries on past one awkward workspace', async () => {
    await worktree('clean', 'mine.txt', 'fine\n')
    await worktree('messy', 'shared.txt', 'conflicting\n')
    await advanceMain('shared.txt', 'moved\n')
    await sessions.writeSessions([
      record('clean', 'clean') as never,
      record('messy', 'messy') as never,
    ])

    const { hooks } = fakeHooks()
    const { results } = await sweeper.runBaseSweep(repo, 'main', hooks)

    expect(results).toHaveLength(2)
    expect(results.map(r => r.outcome).sort()).toEqual(['conflicted', 'updated'])
  })

  it('says the conflict is still there when the turn could not be started', async () => {
    await worktree('s1', 'shared.txt', 'session says this\n')
    await advanceMain('shared.txt', 'main says that\n')
    await sessions.writeSessions([record('s1', 's1') as never])

    const { hooks } = fakeHooks({
      askToResolve: async () => { throw Object.assign(new Error('busy'), { data: { message: 'Session is busy.' } }) },
    })
    const { results } = await sweeper.runBaseSweep(repo, 'main', hooks)

    expect(results[0]).toMatchObject({ outcome: 'conflicted' })
    expect(results[0]!.runId).toBeUndefined()
    expect(results[0]!.message).toContain('Session is busy.')
    expect(results[0]!.message).toContain('in the workspace')
  })

  it('reports an update whose checks could not be re-run, rather than claiming green', async () => {
    await worktree('s1', 'mine.txt', 'fine\n')
    await advanceMain('shared.txt', 'two\n')
    await sessions.writeSessions([record('s1', 's1') as never])

    const { hooks } = fakeHooks({
      recheck: async () => { throw new Error('no check command') },
    })
    const { results } = await sweeper.runBaseSweep(repo, 'main', hooks)

    expect(results[0]).toMatchObject({ outcome: 'updated-unverified' })
    expect(results[0]!.check).toBeUndefined()
  })
})

describe('what it tells the person who pressed it', () => {
  it('counts what happened rather than reporting a single verdict', () => {
    expect(sweep.describeSweep([
      { id: 'a', title: 'A', outcome: 'updated', message: '' },
      { id: 'b', title: 'B', outcome: 'updated', message: '' },
      { id: 'c', title: 'C', outcome: 'conflicted', message: '' },
      { id: 'd', title: 'D', outcome: 'failed', message: '' },
    ])).toBe('2 brought forward, 1 conflicted and is resolving it, 1 could not be updated.')
  })

  it('says nothing happened when nothing did', () => {
    expect(sweep.describeSweep([])).toBe('Nothing needed bringing forward.')
  })
})

describe('the conflicted-file list', () => {
  it('reads every unmerged state git can report', () => {
    const porcelain = [
      'UU both.txt',
      'AA added-both.txt',
      'DU deleted-by-us.txt',
      'UD deleted-by-them.txt',
      ' M ordinary.txt',
      '?? untracked.txt',
      'M  staged.txt',
    ].join('\n')

    expect(sweep.conflictedFiles(porcelain))
      .toEqual(['both.txt', 'added-both.txt', 'deleted-by-us.txt', 'deleted-by-them.txt'])
  })

  it('still writes a usable prompt when git named nothing', () => {
    expect(sweep.conflictPrompt('main', [])).toContain('git did not name the files')
  })
})
