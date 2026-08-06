import { findSession, patchSession, type Session } from './sessions'
import { clampAttempts, readPreferences } from './preferences'
import { notify } from './notify'
import type { SessionCheck } from './checks'

/**
 * Sessions that finish the job.
 *
 * The checks already say whether a session's work holds up. Until now that was
 * where it ended: a red badge, and a person to come back and do something about
 * it. But the thing that just wrote the code is still there, the failure output
 * is right in front of it, and fixing your own broken test run is the most
 * mechanical work there is.
 *
 * So a failing verdict can start another turn, carrying the failure with it,
 * and keep going until the checks pass or it runs out of attempts. Six sessions
 * left running overnight stop being "two of these are red" and become "all six
 * are green, and here is what each one did".
 *
 * Three things keep it honest:
 *
 *   - **It is bounded.** A streak has a ceiling chosen up front. An agent that
 *     cannot fix something in three tries is not going to fix it in thirty, and
 *     the difference is measured in money.
 *   - **It only acts on a verdict.** `errored` means the checks could not run —
 *     a missing dependency, a command not on PATH — which says nothing about
 *     the code. There is nothing there to fix, so nothing is attempted.
 *   - **It cannot silence the thing it is failing.** Deleting the test is the
 *     obvious way to make a test pass, so the instruction says not to, and the
 *     verdict is fingerprinted either way — a session that edits its own checks
 *     is visible in the diff like everything else.
 *
 * This module decides and records. It never starts a turn itself: `sessionTurn`
 * owns that, and keeping the dependency one-directional is what stops "a turn
 * ends, so check, so repair, so a turn ends" from becoming a circular import.
 */

export type RepairState =
  /** Attempts remain and one has just been handed out. */
  | 'running'
  /** The checks came good. */
  | 'fixed'
  /** Attempts are spent, or something refused. See `reason`. */
  | 'gave-up'

export interface SessionRepair {
  /** Turns spent on this streak, including the one now running. */
  attempts: number
  /** The ceiling this streak began with. */
  max: number
  state: RepairState
  /** Why it stopped, in words worth showing someone. */
  reason?: string
  startedAt: number
  updatedAt: number
}

/**
 * What **Fix it** means when nobody has set a number. Someone pressing a button
 * has asked for this once, on purpose, and should not have to visit settings
 * first to be allowed three attempts at it.
 */
export const DEFAULT_MANUAL_ATTEMPTS = 3

/**
 * The turn a failing check earns.
 *
 * States the failure and asks for the code to be fixed. The prohibition is the
 * load-bearing part: the shortest path from a failing suite to a passing one is
 * to delete the test, and an agent told only "make this pass" will eventually
 * find that path.
 */
export function repairPrompt(check: SessionCheck, attempt: number, max: number): string {
  const exit = check.exitCode === null ? 'no exit code' : `exit code ${check.exitCode}`
  const attemptLine = attempt > 1
    ? `\nThis is attempt ${attempt} of ${max}. The previous attempt did not fix it, so try a different approach rather than the same one again.\n`
    : ''

  return `This project's own checks are failing in this workspace.

Command: \`${check.command}\` (${exit})

Output:
${'```'}
${check.output || '(the command printed nothing)'}
${'```'}
${attemptLine}
Fix the code so that command passes.

Fix the failure, not the check. Do not delete, skip, weaken or comment out a test to make it green, and do not change the check command. If you believe the test itself is wrong, say so and explain why instead of editing it away.

If you cannot make it pass, stop and say what is blocking you rather than trying something you do not believe in.`
}

/** A streak is over — record how, and say so if it is worth interrupting for. */
async function conclude(
  session: Session,
  state: Exclude<RepairState, 'running'>,
  reason?: string,
): Promise<void> {
  const repair = session.repair
  if (!repair || repair.state !== 'running') return

  await patchSession(session.id, {
    repair: { ...repair, state, reason, updatedAt: Date.now() },
  })

  if (state === 'fixed') {
    await notify(
      'finished',
      `${session.title} — fixed itself`,
      `Checks pass after ${repair.attempts} ${repair.attempts === 1 ? 'attempt' : 'attempts'}.`,
    )
    return
  }

  await notify(
    'needsYou',
    `${session.title} — still failing`,
    reason || `Gave up after ${repair.attempts} ${repair.attempts === 1 ? 'attempt' : 'attempts'}.`,
  )
}

/**
 * Decide what a fresh verdict means for a repair streak, and hand back the turn
 * to send if it has earned one.
 *
 * Returns null in every case where nothing should be sent, which is most of
 * them — no verdict, a passing verdict, the feature switched off, attempts
 * spent. Never throws: this runs behind a turn that has already finished, and
 * a decision we could not make must not take that turn down with it.
 */
export async function planRepair(
  sessionId: string,
  check: SessionCheck | null,
): Promise<string | null> {
  try {
    const session = await findSession(sessionId)
    if (!session) return null

    // Came good — whether this streak fixed it or the person did, the streak is
    // over and the good news is worth saying.
    if (check?.status === 'passing') {
      await conclude(session, 'fixed')
      return null
    }

    // `errored` is the checks failing to run, which is not a verdict about the
    // code. There is nothing here to fix. `running` is a verdict not yet in.
    if (check?.status !== 'failing') return null

    const existing = session.repair
    const streak = existing?.state === 'running' ? existing : null

    // A ceiling chosen when the streak began stays the ceiling, so changing the
    // setting mid-flight cannot extend a run already under way.
    const max = streak?.max ?? clampAttempts((await readPreferences()).repairAttempts)
    if (max <= 0) return null

    const attempts = streak?.attempts ?? 0
    if (attempts >= max) {
      await conclude(
        session,
        'gave-up',
        `Checks still failing after ${max} ${max === 1 ? 'attempt' : 'attempts'}. Over to you.`,
      )
      return null
    }

    const now = Date.now()
    const next: SessionRepair = {
      attempts: attempts + 1,
      max,
      state: 'running',
      startedAt: streak?.startedAt ?? now,
      updatedAt: now,
    }
    await patchSession(sessionId, { repair: next })

    return repairPrompt(check, next.attempts, max)
  } catch {
    // A repair we could not plan is the same as not repairing.
    return null
  }
}

/**
 * Start a streak by hand, from a failing session.
 *
 * Separate from `planRepair` because pressing the button is a different act
 * from the feature being on: it works when the preference is zero, and it
 * starts a fresh streak over one that has already given up.
 */
export async function beginManualRepair(
  session: Session,
): Promise<{ input: string } | { error: string; message: string }> {
  const check = session.check

  if (!check || check.status === 'running') {
    return {
      error: 'no_verdict',
      message: 'There is no check result to work from yet.',
    }
  }

  if (check.status === 'passing') {
    return { error: 'already_passing', message: 'This session\'s checks already pass.' }
  }

  if (check.status === 'errored') {
    return {
      error: 'checks_unrunnable',
      message: 'The checks could not be run here, so there is no failure to fix — see the output.',
    }
  }

  const preference = clampAttempts((await readPreferences()).repairAttempts)
  const max = preference || DEFAULT_MANUAL_ATTEMPTS
  const now = Date.now()

  await patchSession(session.id, {
    repair: { attempts: 1, max, state: 'running', startedAt: now, updatedAt: now },
  })

  return { input: repairPrompt(check, 1, max) }
}

/**
 * A turn somebody typed ends whatever the session was doing on its own.
 *
 * Without this a streak that gave up yesterday still counts against the checks
 * that fail after today's instruction, and the session would refuse to try
 * again for reasons nobody can see.
 */
export async function clearRepair(session: Session): Promise<void> {
  if (!session.repair) return
  await patchSession(session.id, { repair: undefined })
}
