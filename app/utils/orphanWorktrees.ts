/**
 * What an orphaned worktree actually is, which is not one thing.
 *
 * A worktree git knows about and no session claims used to be a single category,
 * decided by whether its directory was still on disk. That is a question about
 * the filesystem being read as an answer about recovery, and on a real machine it
 * made twelve foreign worktrees into twelve lost sessions: the panel forced
 * itself open on every load and offered to restore conversations that had never
 * happened. None had a transcript, and their branch names — `fix/authorization-
 * gaps`, `refactor/misc-dead-code` — were not this app's slug-plus-id shape, so
 * they were never its sessions. Something else had put them in its directory.
 *
 * They still mattered: several carried more than a dozen commits that existed
 * nowhere else. So the answer is not to hide them but to stop calling them the
 * wrong thing.
 *
 * Pure and tested because it is the judgement, and a judgement made inline in a
 * computed is one the next surface will make differently.
 */
export type OrphanKind =
  /** A session's conversation is there and can be brought back. */
  | 'restorable'
  /** A branch with work in it and no conversation behind it. */
  | 'stray'
  /** Git tracks it; the directory is gone. Nothing to offer. */
  | 'gone'

export interface OrphanRecovery {
  /** Whether the directory is on disk. */
  exists: boolean
  /** Whether there is a conversation to resume. */
  hasConversation: boolean
}

export function orphanKind(recovery: OrphanRecovery | null | undefined): OrphanKind {
  if (!recovery?.exists) return 'gone'
  return recovery.hasConversation ? 'restorable' : 'stray'
}

/**
 * Whether this is worth forcing the panel open for.
 *
 * Only a lost conversation is. An alarm that fires every load is one nobody
 * reads, which costs the case it exists for — and that case is real: a crash or
 * a damaged session index can leave a conversation on disk with nothing pointing
 * at it, and it is genuinely urgent because deleting it is the one action here
 * that cannot be undone.
 */
export function worthAlarming(recoveries: (OrphanRecovery | null | undefined)[]): boolean {
  return recoveries.some(recovery => orphanKind(recovery) === 'restorable')
}
