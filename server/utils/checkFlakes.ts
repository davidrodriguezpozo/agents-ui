import { join } from 'node:path'
import type { SessionCheck } from './checks'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'

/**
 * Which failing check is merely flaky.
 *
 * `checks.ts` keeps one verdict per session: the command, whether it exited
 * zero, and the tail of what it printed. That is enough to gate a merge and not
 * enough to argue with it. A suite that fails one run in five now blocks real
 * work and reads on the page as broken code, so the person either re-runs it on
 * a hunch or overrides by reflex — and a gate people override by reflex has
 * stopped being a gate.
 *
 * Nothing here could tell the two apart, because nothing was written down. Six
 * worktrees a night against one repository is an accidental reliability dataset
 * that exists on this machine and nowhere else, and it was being thrown away one
 * verdict at a time. So every run that produced a verdict is kept, broken down
 * into the individual checks that failed, per project.
 *
 * **What counts as flaky, in one sentence:** the same check has both passed and
 * failed on an *identical* workspace — same commit, same uncommitted edits,
 * nothing changed in between — so nothing about the code can account for the
 * difference.
 *
 * That is the strictest of the definitions available and it is chosen on
 * purpose. The looser one — "it fails more often than a stable check does" —
 * cannot survive this dataset: six sessions run the same suite against six
 * different branches, so a check one branch genuinely broke looks identical to a
 * flake when the runs are read in the order they happened. Identical workspace,
 * two answers, is not an inference. It is a contradiction, and the only thing
 * that can produce it is the check itself.
 *
 * The cost is that it says nothing until a workspace has been checked twice.
 * That is the right way round: a guess here would be told to somebody at the
 * exact moment they are deciding whether to trust their own test suite.
 */

/**
 * Runs below which nothing is said at all.
 *
 * The verdict is a rate, and a rate over three runs is a number pretending to be
 * evidence. Five is the point where "failed two of five" is worth reading — and
 * a project set up this morning is not told anything about its suite this
 * afternoon.
 *
 * Named for checks rather than plainly, because these are auto-imported across
 * the server and `ritualValue.ts` already owns `ENOUGH_RUNS`.
 */
export const ENOUGH_CHECK_RUNS = 5

/** Kept per project. Beyond this the oldest runs fall off the end. */
const MAX_RUNS = 200

/** Names per run. A suite that fails 300 tests has one problem, not 300. */
const MAX_NAMES = 40

/** A test name long enough to need this is a name nobody reads anyway. */
const MAX_NAME_LENGTH = 200

/** How many flakes a single failure is allowed to report before it is noise. */
const MAX_REPORTED = 5

// --- Reading the individual checks out of a run -----------------------------

/** Test runners colour their output whether or not anything is watching. */
function withoutAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
}

/**
 * Every runner announces its failures differently and none of them announce
 * their passes usefully, so this reads the failures only. What passed is then
 * everything that did not fail in a run that got far enough to say — see
 * `verdicts` below, which is where that inference is made and bounded.
 *
 * One pattern per runner family, matched against whole lines, because a fragment
 * of a stack trace containing the word FAIL is not a check name.
 */
const FAILURE_PATTERNS: RegExp[] = [
  /** vitest and jest: `FAIL  test/runQueue.test.ts > runQueue > drains in order` */
  /^\s*FAIL\s+(\S.*?)\s*$/,
  /** pytest: `FAILED tests/test_queue.py::test_drains - AssertionError` */
  /^\s*FAILED\s+(\S+)/,
  /** go: `--- FAIL: TestDrainsInOrder (0.01s)` */
  /^\s*---\s*FAIL:\s+(\S+)/,
  /** cargo: `test queue::drains_in_order ... FAILED` */
  /^\s*test\s+(\S+)\s+\.\.\.\s+FAILED\s*$/,
]

/**
 * How long it took is not part of what it is called.
 *
 * Jest prints `FAIL src/queue.test.ts (5.201 s)`, and a name carrying a
 * millisecond count is a different name every run — which would leave a jest
 * project with a history full of checks that each appear exactly once and no
 * flake ever recognised.
 */
function withoutDuration(name: string): string {
  return name.replace(/\s*\(\s*[\d.]+\s*m?s\s*\)$/, '')
}

/**
 * The individual checks that failed, from what the command printed.
 *
 * Deliberately not `make: *** [check] Error 2` and friends: that is the wrapper
 * reporting that something under it failed, and recording it as a check name
 * would give every project one enormous check called `check` that is flaky
 * whenever anything is.
 */
export function failedCheckNames(output: string): string[] {
  const names: string[] = []

  for (const line of withoutAnsi(output).split('\n')) {
    for (const pattern of FAILURE_PATTERNS) {
      const match = pattern.exec(line)
      if (!match?.[1]) continue

      const name = withoutDuration(match[1].trim()).slice(0, MAX_NAME_LENGTH)
      if (name && !names.includes(name)) names.push(name)
      break
    }
    if (names.length >= MAX_NAMES) break
  }

  return names
}

// --- What is kept ------------------------------------------------------------

export interface CheckRun {
  at: number
  /**
   * The workspace it ran against, from `worktreeFingerprint`. This is the whole
   * mechanism: two runs sharing a fingerprint ran the same code, so if they
   * disagree the code is not what changed. Empty when it could not be taken,
   * which means that run can still count towards a rate but can never prove a
   * disagreement.
   */
  fingerprint: string
  passed: boolean
  /** The checks that failed. Empty on a passing run. */
  failed: string[]
}

/**
 * Runs per repository, newest first.
 *
 * Keyed by repository rather than by session for the same reason the check
 * command is: a flaky test is a fact about the project, and a session lives a
 * day. Kept beside `project-checks.json` in the app's own directory, never in
 * the project — nobody wants "this machine thinks your test is flaky" arriving
 * as a commit.
 */
export type CheckHistory = Record<string, CheckRun[]>

export const checkHistoryStore = defineJsonStore<CheckHistory>({
  label: 'check history',
  path: () => join(getClaudeDir(), 'agents-ui', 'check-history.json'),
  empty: () => ({}),
  decode: parsed => parsed?.projects ?? {},
  encode: projects => ({ version: 1, projects }),
})

/**
 * File a finished run against its project.
 *
 * Only `passing` and `failing` are verdicts. A check that could not run says
 * nothing about any test in the suite, and counting it as a failure would make
 * a missing `node_modules` look like the flakiest test in the repository.
 *
 * Never throws. This runs after a verdict has already been reported to whoever
 * asked for it, and losing a row of a history is not worth failing a turn over.
 */
export async function recordCheckRun(repoDir: string | undefined, check: SessionCheck): Promise<void> {
  if (!repoDir) return
  if (check.status !== 'passing' && check.status !== 'failing') return

  try {
    await checkHistoryStore.update((projects) => {
      const run: CheckRun = {
        at: check.at,
        fingerprint: check.fingerprint,
        passed: check.status === 'passing',
        failed: check.status === 'failing' ? failedCheckNames(check.output) : [],
      }
      projects[repoDir] = [run, ...(projects[repoDir] ?? [])].slice(0, MAX_RUNS)
    })
  } catch (e: any) {
    console.log(`[check-flakes] could not record a run for ${repoDir}: ${e?.message ?? e}`)
  }
}

// --- The judgement -----------------------------------------------------------

export interface Flake {
  /** The check, named as its runner named it. */
  name: string
  /** Runs this verdict is drawn from. */
  runs: number
  failures: number
  /** `failures / runs`, between 0 and 1. */
  rate: number
  /** The whole judgement, in words, for the person looking at the failure. */
  note: string
}

/**
 * Runs that can say something about one named check.
 *
 * A run that passed passed everything, so every check passed in it. A run that
 * failed and named its failures tells us about every check *except* the ones a
 * truncated tail dropped — which is the known hole here, and it is bounded: the
 * only cost is a flake taking longer to be recognised.
 *
 * A run that failed and named nothing is dropped entirely. That is a suite that
 * fell over before any test reported — a typecheck error, a missing binary, a
 * `make` recipe exiting on step one — and reading it as "every test passed"
 * would be inventing evidence out of a broken build.
 */
function verdicts(runs: CheckRun[]): CheckRun[] {
  return runs.filter(run => run.passed || run.failed.length > 0)
}

/**
 * Whether one named check is flaky in this project's history, and how often it
 * fails. Null when it is not, and null when there is not enough to say — the
 * caller shows nothing in both cases, because a check nobody has evidence about
 * and a check that is simply broken both deserve silence here.
 */
export function flakinessOf(runs: CheckRun[], name: string): Flake | null {
  const usable = verdicts(runs)
  if (usable.length < ENOUGH_CHECK_RUNS) return null

  // The disagreement, on identical code. Runs with no fingerprint cannot be
  // proved identical to anything, so they are grouped out rather than lumped
  // together under the empty string — which would have made every workspace
  // nothing could be read from look like the same one.
  const onSameWorkspace = new Map<string, { passed: boolean; failed: boolean }>()
  for (const run of usable) {
    if (!run.fingerprint) continue
    const seen = onSameWorkspace.get(run.fingerprint) ?? { passed: false, failed: false }
    if (run.failed.includes(name)) seen.failed = true
    else seen.passed = true
    onSameWorkspace.set(run.fingerprint, seen)
  }

  const contradicted = [...onSameWorkspace.values()].some(seen => seen.passed && seen.failed)
  if (!contradicted) return null

  const failures = usable.filter(run => run.failed.includes(name)).length
  const rate = failures / usable.length

  return {
    name,
    runs: usable.length,
    failures,
    rate,
    note: `It failed ${failures} of the last ${usable.length} runs here, and it has both passed `
      + 'and failed with the workspace in exactly the same state — so the code is not what changed.',
  }
}

/**
 * The known flakes among a failing check's own failures.
 *
 * Empty for anything that is not a live failure: a passing check has nothing to
 * excuse, and a check that could not run has no named failures to look up.
 *
 * Never throws, for the same reason `recordCheckRun` does not — this decorates a
 * merge preview, and an unreadable history file must not take the preview down
 * with it. The merge dialog then says nothing extra, which is exactly what it
 * said before any of this existed.
 */
export async function flakesFor(
  repoDir: string | undefined,
  check: SessionCheck | null | undefined,
): Promise<Flake[]> {
  if (!repoDir || check?.status !== 'failing') return []

  try {
    const runs = (await checkHistoryStore.read())[repoDir] ?? []

    return failedCheckNames(check.output)
      .map(name => flakinessOf(runs, name))
      .filter((flake): flake is Flake => flake !== null)
      .slice(0, MAX_REPORTED)
  } catch {
    return []
  }
}

/** The headline, once there is at least one. Plain, and about this failure. */
export function describeFlakes(flakes: Flake[]): string {
  return flakes.length === 1
    ? 'This failure is a known flake'
    : `${flakes.length} of these failures are known flakes`
}
