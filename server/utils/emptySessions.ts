import type { Session } from './sessions'
import { diffBase, worktreeStatus } from './worktrees'

/**
 * Closing out sessions that produced nothing.
 *
 * The tax of leaving it running. Work starts while you are away, and a fair
 * share of it comes to nothing — a question answered, a look that found no
 * problem, an instruction that turned out to be wrong. Each one still holds a
 * branch and a whole checkout of the repository, and there is no moment at
 * which anybody deletes them. After a week the list is mostly debris, and
 * clearing it one row at a time is the thing that makes people stop bothering.
 *
 * The rule is narrow on purpose: nothing changed, nothing committed, nothing
 * in flight. Anything else is somebody's work and is not this function's
 * business.
 */

export type SkipReason = 'has-changes' | 'busy' | 'missing' | 'archived'

export interface EmptyVerdict {
  id: string
  title: string
  empty: boolean
  reason?: SkipReason
}

/**
 * Decide from a fresh look at the workspace, never from what a page believed.
 *
 * The list in the browser can be minutes old, and in those minutes a session
 * may have been given more to do. This deletes a branch, so the question has
 * to be asked again at the moment of asking.
 */
export async function verifyEmpty(session: Session): Promise<EmptyVerdict> {
  const head = { id: session.id, title: session.title }

  if (session.status === 'archived') return { ...head, empty: false, reason: 'archived' }
  if (session.status === 'running') return { ...head, empty: false, reason: 'busy' }

  const status = await worktreeStatus(session.worktreePath, await diffBase(session), session.baseBranch)

  // Already gone. Not something to clean up, and not something to report as
  // cleaned up either — the record needs a different decision from you.
  if (!status.exists) return { ...head, empty: false, reason: 'missing' }

  if (status.changedFiles > 0 || status.dirty || status.ahead > 0) {
    return { ...head, empty: false, reason: 'has-changes' }
  }

  return { ...head, empty: true }
}

/** Said back in the plural, because the whole point is doing several at once. */
export function describeOutcome(closed: number, skipped: EmptyVerdict[]): string {
  const parts: string[] = []

  parts.push(closed === 1 ? 'Closed 1 session.' : `Closed ${closed} sessions.`)

  const changed = skipped.filter(s => s.reason === 'has-changes').length
  const busy = skipped.filter(s => s.reason === 'busy').length
  const missing = skipped.filter(s => s.reason === 'missing').length

  // Named individually rather than lumped into "some were skipped", because
  // "it had changes after all" and "it is running" want different responses.
  if (changed) parts.push(`${changed} had changes after all and ${changed === 1 ? 'was' : 'were'} left alone.`)
  if (busy) parts.push(`${busy} ${busy === 1 ? 'is' : 'are'} still working.`)
  if (missing) parts.push(`${missing} had no workspace left to remove.`)

  return parts.join(' ')
}
