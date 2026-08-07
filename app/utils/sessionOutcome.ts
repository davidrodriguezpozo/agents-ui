import type { SessionActivity, SessionCheck, WorktreeState } from '~/composables/useSessions'

/**
 * What a session amounts to, coarse enough to sort a pile by.
 *
 * A badge answers "what is this one?". With sixteen sessions on the page that
 * is the wrong question — you cannot ask it sixteen times. The question is
 * "which of these want something from me", and it was unanswerable: finished
 * work, work that came to nothing, and work that needed a decision all sat in
 * one chronological wall wearing eight different badges.
 *
 * `idle` was the worst of it, because it meant two opposite things. A session
 * that thought about it and wrote nothing, and a session that wrote twelve
 * files and is waiting to be merged, were both "idle" — the first is finished
 * business and the second is the whole reason to leave it running.
 */
export type SessionOutcome = 'needs-you' | 'working' | 'ready' | 'nothing' | 'gone'

export interface SessionShape {
  activity: SessionActivity
  check?: SessionCheck | null
  worktree?: Pick<WorktreeState, 'changedFiles' | 'dirty'> | null
}

/** Whether anything was actually produced, which is what makes a session worth a decision. */
function producedSomething(session: SessionShape): boolean {
  const worktree = session.worktree
  if (!worktree) return false
  return worktree.changedFiles > 0 || worktree.dirty
}

export function outcomeOf(session: SessionShape): SessionOutcome {
  if (session.activity === 'missing') return 'gone'
  if (session.activity === 'working') return 'working'
  if (session.activity === 'awaiting-permission') return 'needs-you'
  if (session.activity === 'failed') return 'needs-you'

  // Finished, and does not work. It is not asking for anything, which is
  // exactly why it needs to be put where the asking ones are — otherwise it
  // reads as done and quietly stays broken.
  if (session.check?.status === 'failing') return 'needs-you'

  // Still deciding. Not finished, so not a decision for you yet.
  if (session.check?.status === 'running') return 'working'

  return producedSomething(session) ? 'ready' : 'nothing'
}

export interface OutcomeSection {
  outcome: SessionOutcome
  title: string
  /** Said once above the group rather than repeated on every row. */
  hint?: string
}

/**
 * The order they are worth reading in, which is not the order they happened.
 *
 * "Nothing came of it" last and named plainly: a session that produced no
 * changes is not a failure and not a task, and calling it "idle" made it look
 * like both.
 */
export const OUTCOME_SECTIONS: OutcomeSection[] = [
  { outcome: 'needs-you', title: 'Needs you', hint: 'Blocked, broken, or asking for a decision.' },
  { outcome: 'working', title: 'Working now' },
  { outcome: 'ready', title: 'Done, waiting for you', hint: 'Changes are sitting in their own workspace until you merge them.' },
  { outcome: 'nothing', title: 'Nothing came of it', hint: 'These ran and left no changes behind.' },
  { outcome: 'gone', title: 'Workspace gone' },
]

/**
 * Split a list into those sections, dropping the empty ones.
 *
 * Order within a section is left to the caller: it already sorts by urgency,
 * and re-sorting here would quietly overrule it.
 */
export function bySection<T extends SessionShape>(
  sessions: T[],
): { section: OutcomeSection; sessions: T[] }[] {
  return OUTCOME_SECTIONS
    .map(section => ({
      section,
      sessions: sessions.filter(session => outcomeOf(session) === section.outcome),
    }))
    .filter(group => group.sessions.length > 0)
}
