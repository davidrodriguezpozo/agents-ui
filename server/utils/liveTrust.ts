import { findSession } from './sessions'
import { asksNothing } from './trust'

/**
 * Whether a run's session has *since* been set to Auto.
 *
 * The SDK is told the permission mode once, when the run starts, and a query
 * given a plain string prompt has no way to be told again. So pressing **Auto**
 * during a turn used to light the control up and change nothing: that turn
 * carried on asking, and only the next one went quiet. Every Auto session on
 * this machine showed it — prompts on the first run, none on any run after.
 *
 * The permission callback is the one place that can still answer, because it is
 * consulted per tool call rather than once per run. The session is re-read every
 * time: the whole point is to reflect a decision made a second ago, so a value
 * captured when the run started would be the very thing that is wrong.
 *
 * Widening only, and only to Auto. A session moved *down* mid-run cannot be
 * caught here at all — a run already told `bypassPermissions` never asks, so
 * there is no request to intercept — and it is better to say that than to
 * imply a tightening that does not happen.
 */
export async function nowTrustedFully(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) return false

  try {
    // Through `asksNothing`, so a session that never recorded a level is read
    // the same way here as it is when the turn's permission mode is chosen. Two
    // answers to "it never said" is how a session ends up being asked about
    // something the run was told it could do.
    const session = await findSession(sessionId)
    return Boolean(session) && asksNothing(session!.trust)
  } catch {
    // A session that cannot be read has granted nothing. Failing closed here
    // costs a prompt; failing open would run a command nobody approved.
    return false
  }
}
