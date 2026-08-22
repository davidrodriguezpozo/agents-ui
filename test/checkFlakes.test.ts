import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  describeFlakes,
  failedCheckNames,
  flakinessOf,
  ENOUGH_CHECK_RUNS,
  type CheckRun,
} from '../server/utils/checkFlakes'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

describe('failedCheckNames', () => {
  it('reads a vitest failure down to the test, not just the file', () => {
    // Two tests in one file can flake independently, and the name that goes in
    // the history is the name a person would search for.
    const output = [
      ' ❯ test/runQueue.test.ts (9 tests | 1 failed) 812ms',
      '',
      '⎯⎯⎯ Failed Tests 1 ⎯⎯⎯',
      '',
      ' FAIL  test/runQueue.test.ts > runQueue > drains in order',
      'AssertionError: expected 3 to be 2',
    ].join('\n')

    expect(failedCheckNames(output)).toEqual(['test/runQueue.test.ts > runQueue > drains in order'])
  })

  it('reads pytest, go and cargo failures too', () => {
    expect(failedCheckNames('FAILED tests/test_queue.py::test_drains - AssertionError'))
      .toEqual(['tests/test_queue.py::test_drains'])
    expect(failedCheckNames('--- FAIL: TestDrainsInOrder (0.01s)'))
      .toEqual(['TestDrainsInOrder'])
    expect(failedCheckNames('test queue::drains_in_order ... FAILED'))
      .toEqual(['queue::drains_in_order'])
  })

  it('leaves the duration out of the name', () => {
    // Jest puts one on the end. A name carrying a millisecond count is a
    // different name every run, so nothing would ever be recognised twice.
    expect(failedCheckNames('FAIL src/queue.test.ts (5.201 s)')).toEqual(['src/queue.test.ts'])
    expect(failedCheckNames('--- FAIL: TestDrainsInOrder (0.01s)')).toEqual(['TestDrainsInOrder'])
  })

  it('sees through the colours a runner prints whether or not anyone is watching', () => {
    expect(failedCheckNames('\x1b[41m FAIL \x1b[0m \x1b[31mtest/a.test.ts > works\x1b[0m'))
      .toEqual(['test/a.test.ts > works'])
  })

  it('ignores the wrapper reporting that something under it failed', () => {
    // `make` naming its own target would give every project one enormous check
    // called `check`, flaky whenever anything at all is.
    expect(failedCheckNames('make: *** [check] Error 2')).toEqual([])
    expect(failedCheckNames('error: script "test" exited with code 1')).toEqual([])
  })

  it('names a repeated failure once', () => {
    const line = ' FAIL  test/a.test.ts > works'
    expect(failedCheckNames(`${line}\nsome noise\n${line}`)).toEqual(['test/a.test.ts > works'])
  })
})

// --- The judgement ----------------------------------------------------------

const FLAKE = 'test/runQueue.test.ts > runQueue > drains in order'

/** One recorded run. `on` is the workspace it ran against. */
function run(on: string, failed: string[]): CheckRun {
  return { at: 0, fingerprint: on, passed: failed.length === 0, failed }
}

describe('flakinessOf', () => {
  it('says nothing about a check that has never failed', () => {
    const runs = Array.from({ length: 12 }, () => run('one-commit', []))
    expect(flakinessOf(runs, FLAKE)).toBeNull()
  })

  it('says nothing about a check that always fails — that is broken, not flaky', () => {
    // The distinction the whole feature turns on, and it holds even on one
    // commit checked twelve times. A check that has never once passed is telling
    // the truth, and excusing it would be the worst thing this could do.
    const runs = Array.from({ length: 12 }, () => run('one-commit', [FLAKE]))
    expect(flakinessOf(runs, FLAKE)).toBeNull()
  })

  it('names a check that alternates on one commit', () => {
    const runs = Array.from({ length: 12 }, (_, i) => run('one-commit', i % 3 === 0 ? [FLAKE] : []))
    const flake = flakinessOf(runs, FLAKE)

    expect(flake?.name).toBe(FLAKE)
    expect(flake?.runs).toBe(12)
    expect(flake?.failures).toBe(4)
    expect(flake?.rate).toBeCloseTo(4 / 12)
    // The rate is the point of the sentence — it is what makes "flaky" a claim
    // rather than an excuse.
    expect(flake?.note).toContain('failed 4 of the last 12 runs')
  })

  it('says nothing on three runs, however they went', () => {
    const runs = [run('one-commit', [FLAKE]), run('one-commit', []), run('one-commit', [FLAKE])]
    expect(runs.length).toBeLessThan(ENOUGH_CHECK_RUNS)
    // Enough to contradict itself, not enough to quote a rate at anybody.
    expect(flakinessOf(runs, FLAKE)).toBeNull()
  })

  it('does not call a check flaky because one branch broke it', () => {
    /*
     * The false positive that decided the definition. Six worktrees run the same
     * suite against six different branches, so a check that one branch genuinely
     * broke produces fail, pass, fail, pass in the order the runs happened —
     * indistinguishable from a flake unless you insist the disagreement happen
     * on identical code.
     */
    const runs = [
      run('branch-a', [FLAKE]),
      run('branch-b', []),
      run('branch-a', [FLAKE]),
      run('branch-c', []),
      run('branch-a', [FLAKE]),
      run('branch-d', []),
    ]
    expect(flakinessOf(runs, FLAKE)).toBeNull()
  })

  it('ignores a run whose workspace could not be fingerprinted', () => {
    // Two of these disagree, and nothing says they ran the same code. Grouping
    // them under the empty string would have made every unreadable workspace
    // look like the same one.
    const runs = [
      run('', [FLAKE]), run('', []), run('', [FLAKE]), run('', []), run('', [FLAKE]), run('', []),
    ]
    expect(flakinessOf(runs, FLAKE)).toBeNull()
  })

  it('does not read a suite that fell over as every test passing', () => {
    /*
     * A failing run that named nothing is a typecheck error, a missing binary, a
     * recipe that died on step one. Counting it as "the flaky test passed" would
     * invent evidence out of a broken build — and, worse, dilute the rate.
     */
    const collapsed: CheckRun = { at: 0, fingerprint: 'one-commit', passed: false, failed: [] }
    const runs = [
      run('one-commit', [FLAKE]), collapsed, run('one-commit', []),
      collapsed, run('one-commit', [FLAKE]), collapsed, run('one-commit', []),
      collapsed, run('one-commit', [FLAKE]), collapsed, run('one-commit', []),
    ]
    const flake = flakinessOf(runs, FLAKE)

    expect(flake?.runs).toBe(6)
    expect(flake?.failures).toBe(3)
  })

  it('judges each check name separately', () => {
    const other = 'test/pool.test.ts > pool > reuses a worker'
    const runs = [
      run('one-commit', [FLAKE, other]),
      run('one-commit', [other]),
      run('one-commit', [FLAKE, other]),
      run('one-commit', [other]),
      run('one-commit', [FLAKE, other]),
      run('one-commit', [other]),
    ]

    expect(flakinessOf(runs, FLAKE)?.failures).toBe(3)
    // Failed every single run: broken here, whatever the one beside it is doing.
    expect(flakinessOf(runs, other)).toBeNull()
  })
})

describe('describeFlakes', () => {
  it('says it in the singular when there is one', () => {
    expect(describeFlakes([{ name: 'a', runs: 6, failures: 2, rate: 1 / 3, note: '' }]))
      .toBe('This failure is a known flake')
  })
})

// --- End to end, against a suite that really does flake ---------------------

/*
 * The acceptance line for this brief is "the merge dialog says so next to the
 * failure", and an unattended session cannot open the dialog. This is that line
 * mechanised as far as the boundary the server owns: a real repository, a real
 * worktree, a check command that genuinely alternates on unchanged code, run
 * through `verifySession` the way every caller runs it — and then the merge
 * preview the dialog renders, asked what it says.
 *
 * What remains unproven is the rendering itself and whether the wording lands
 * with somebody who has not read this brief. Both need a person.
 */
describe('a failing check the merge preview knows is flaky', () => {
  let claudeDir: string
  let repoDir: string
  let counter: string
  let sessions: typeof import('../server/utils/sessions')
  let sessionChecks: typeof import('../server/utils/sessionChecks')
  let merge: typeof import('../server/utils/merge')

  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
  }

  beforeAll(async () => {
    claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-flakes-cfg-'))
    process.env.CLAUDE_DIR = claudeDir

    repoDir = await mkdtemp(join(tmpdir(), 'agents-ui-flakes-repo-'))
    counter = join(claudeDir, 'runs')
    process.env.FLAKE_COUNTER = counter

    git(repoDir, 'init', '-q', '-b', 'main')
    git(repoDir, 'config', 'user.email', 'test@example.com')
    git(repoDir, 'config', 'user.name', 'Test')

    /*
     * A suite that fails every other run and prints what vitest prints. The tally
     * lives outside the worktree on purpose — the workspace has to be byte for
     * byte identical between runs, or this is testing the wrong thing.
     */
    await writeFile(join(repoDir, 'flip.mjs'), [
      "import { readFileSync, writeFileSync } from 'node:fs'",
      'const path = process.env.FLAKE_COUNTER',
      'let n = 0',
      "try { n = Number(readFileSync(path, 'utf-8')) || 0 } catch {}",
      'writeFileSync(path, String(n + 1))',
      'if (n % 2 === 1) { console.log("all good"); process.exit(0) }',
      'console.log(" FAIL  test/queue.test.ts > queue > drains in order")',
      'process.exit(1)',
    ].join('\n'))
    await writeFile(join(repoDir, 'Makefile'), 'check:\n\t@node flip.mjs\n')
    await writeFile(join(repoDir, 'value.txt'), 'start\n')
    git(repoDir, 'add', '-A')
    git(repoDir, 'commit', '-q', '-m', 'initial')
    await writeFile(join(repoDir, '.git', 'info', 'exclude'), '.worktrees/\n')

    sessions = await import('../server/utils/sessions')
    sessionChecks = await import('../server/utils/sessionChecks')
    merge = await import('../server/utils/merge')

    const worktreePath = join(repoDir, '.worktrees', 'flaky')
    git(repoDir, 'worktree', 'add', '-q', '-b', 'flaky', worktreePath, 'main')
    await writeFile(join(worktreePath, 'value.txt'), 'changed\n')
    git(worktreePath, 'add', '-A')
    git(worktreePath, 'commit', '-q', '-m', 'change something')

    await sessions.saveSession({
      id: 'flaky',
      title: 'flaky',
      repoDir,
      worktreePath,
      branch: 'flaky',
      baseBranch: 'main',
      baseSha: git(repoDir, 'rev-parse', 'main'),
      status: 'idle',
      runIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }, 60_000)

  afterAll(async () => {
    delete process.env.FLAKE_COUNTER
    await rm(claudeDir, { recursive: true, force: true })
    await rm(repoDir, { recursive: true, force: true })
  })

  it('says so beside the failure, without letting the merge through', async () => {
    // Seven runs of an unchanged workspace: four fail, three pass. Nothing about
    // the code accounts for the difference, because nothing about the code moved.
    const outcomes: (string | undefined)[] = []
    for (let i = 0; i < 7; i++) {
      outcomes.push((await sessionChecks.verifySession('flaky'))?.status)
    }
    expect(outcomes).toEqual([
      'failing', 'passing', 'failing', 'passing', 'failing', 'passing', 'failing',
    ])

    const session = await sessions.findSession('flaky')
    const preview = await merge.previewMerge(session!)

    expect(preview.flakeNote).toBe('This failure is a known flake')
    expect(preview.flakes?.[0]?.name).toBe('test/queue.test.ts > queue > drains in order')
    expect(preview.flakes?.[0]?.note).toContain('failed 4 of the last 7 runs')

    // The gate is untouched. Knowing it is a flake is not permission to merge.
    expect(preview.canMerge).toBe(false)
    expect(preview.blockedByChecks).toBe(true)
  }, 120_000)
})
