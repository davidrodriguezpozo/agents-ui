import {
  checkCommandFor, runCheck, worktreeFingerprint,
  type SessionCheck,
} from './checks'
import { findSession, patchSession } from './sessions'
import { notify } from './notify'

/**
 * Running a project's checks for a session, and keeping the verdict on it.
 *
 * The awkward part is that this is slow work triggered by something that has
 * already finished. A turn ends, the person is told it ended, and the checks
 * are still going — so the verdict arrives late, into a record the browser is
 * polling, rather than being returned to anyone.
 */

/**
 * Checks for one repository run one at a time.
 *
 * Sessions exist to run in parallel, which means six of them can finish within
 * a minute of each other and ask to build the same project six times over.
 * That thrashes the machine and can genuinely fail — suites that bind a port
 * or share a build directory collide with themselves. Different repositories
 * do not contend in the same way, so the queue is per repository rather than
 * global.
 */
const queues = new Map<string, Promise<unknown>>()

function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  queues.set(key, run.then(() => {}, () => {}))
  return run
}

/** Sessions with a check in flight, so a second request joins rather than duplicates. */
const inFlight = new Map<string, Promise<SessionCheck | null>>()

export function isCheckRunning(sessionId: string): boolean {
  return inFlight.has(sessionId)
}

/**
 * Run this session's checks and record the verdict.
 *
 * Returns null when the project has no checks to run, which is not a failure —
 * plenty of projects have none, and the merge dialog says so plainly rather
 * than implying something is wrong.
 */
export async function verifySession(sessionId: string): Promise<SessionCheck | null> {
  const existing = inFlight.get(sessionId)
  if (existing) return existing

  const attempt = (async (): Promise<SessionCheck | null> => {
    const session = await findSession(sessionId)
    if (!session) return null

    const resolved = await checkCommandFor(session.repoDir)
    if (!resolved) {
      // Clear a verdict left by a command that has since been turned off,
      // rather than leaving a stale badge nothing can ever refresh.
      if (session.check) await patchSession(sessionId, { check: undefined })
      return null
    }

    // Recorded before the wait so the UI can say what it is doing, and so a
    // reload during a ten-minute suite does not look idle.
    const pending: SessionCheck = {
      status: 'running',
      command: resolved.command,
      fingerprint: '',
      exitCode: null,
      output: '',
      durationMs: 0,
      at: Date.now(),
    }
    await patchSession(sessionId, { check: pending })

    return enqueue(session.repoDir, async () => {
      // Taken inside the queue: waiting for our turn behind another session
      // proves nothing about this one, but the workspace may have moved on.
      const fingerprint = await worktreeFingerprint(session.worktreePath)

      const outcome = await runCheck({
        command: resolved.command,
        cwd: session.worktreePath,
      })

      const check: SessionCheck = { ...outcome, command: resolved.command, fingerprint, at: Date.now() }
      await patchSession(sessionId, { check })
      return check
    })
  })()

  inFlight.set(sessionId, attempt)
  try {
    return await attempt
  } finally {
    inFlight.delete(sessionId)
  }
}

/**
 * Verify a session after a turn, but only if the turn actually changed
 * something.
 *
 * Plenty of turns are questions — "what does this file do", "why did that
 * fail" — and running a ten minute suite because someone asked a question is
 * how a useful signal becomes an annoyance people turn off. The fingerprint
 * taken before the turn is what distinguishes the two.
 *
 * Never throws: this runs detached from the request that caused it, and a
 * check that cannot run must not take a completed turn down with it.
 *
 * Returns the verdict rather than announcing it. A failing one may earn the
 * session another turn to fix itself, and whether that happens decides whether
 * the failure is worth interrupting anyone about — so the caller, which knows,
 * does the telling. Null covers every case where there is nothing to react to:
 * no session, nothing changed, no checks configured.
 */
export async function verifySessionAfterTurn(
  sessionId: string,
  fingerprintBefore: string,
): Promise<SessionCheck | null> {
  try {
    const session = await findSession(sessionId)
    if (!session) return null

    const after = await worktreeFingerprint(session.worktreePath)
    if (!after || after === fingerprintBefore) return null

    return await verifySession(sessionId)
  } catch {
    // A verdict we could not reach is the same as not having one.
    return null
  }
}
