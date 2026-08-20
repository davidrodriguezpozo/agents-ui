/**
 * Two sessions changing the same file.
 *
 * `behind` already answers half of this. Six sessions branch from `main`, all go
 * green, you merge one — and the other five are verified against a base that no
 * longer exists, which the row says. What it cannot say is the half that has not
 * happened yet: right now, before anything has merged, two of those sessions are
 * both editing the same file and exactly one of them is going to merge cleanly.
 *
 * Git will refuse a textual conflict when it gets there. It has nothing to say
 * about one session renaming a function another one calls — that merges fine and
 * breaks — and nothing at all to say *before* the merge, which is the only point
 * at which knowing is cheap. The paths are already read for the changed-files
 * count on every poll, so this costs a set intersection and no git at all.
 *
 * Deliberately not a warning. Two sessions on one file is ordinary and often
 * intended; it is only worth a glance. So it is a fact on the row, phrased as
 * one, and nothing is blocked by it.
 */

export interface OverlapInput {
  id: string
  title: string
  repoDir: string
  /** Excluded: a review holds a commit and will never merge. */
  detached?: true
  worktree: { exists: boolean; changedPaths: string[] }
  /** Excluded: its work is already in. */
  landed?: boolean
  status: string
}

export interface Overlap {
  sessionId: string
  title: string
  /** The first few shared files, named. */
  files: string[]
  /** How many are shared in total. */
  total: number
}

/** Enough to recognise which work collides; a full list belongs in the diff. */
const NAMED = 3

/**
 * Which sessions share files with which, keyed by session id.
 *
 * Only within a repository, and only between sessions that could still land. A
 * session whose work is merged, archived, or whose workspace is gone cannot
 * collide with anything, and reporting it would make the badge noise — which is
 * the failure mode for a fact nobody has to act on.
 */
export function findOverlaps<T extends OverlapInput>(sessions: T[]): Map<string, Overlap[]> {
  const out = new Map<string, Overlap[]>()

  const eligible = sessions.filter(session =>
    !session.detached
    && !session.landed
    && session.status !== 'archived'
    && session.worktree.exists
    && session.worktree.changedPaths.length > 0)

  for (const session of eligible) {
    const mine = new Set(session.worktree.changedPaths)
    const found: Overlap[] = []

    for (const other of eligible) {
      if (other.id === session.id) continue
      if (other.repoDir !== session.repoDir) continue

      const shared = other.worktree.changedPaths.filter(path => mine.has(path))
      if (!shared.length) continue

      found.push({
        sessionId: other.id,
        title: other.title,
        files: shared.slice(0, NAMED),
        total: shared.length,
      })
    }

    // Most-collided first: the session sharing eleven files is the one to look
    // at before the one sharing a lockfile.
    if (found.length) out.set(session.id, found.sort((a, b) => b.total - a.total))
  }

  return out
}

/**
 * The badge's sentence.
 *
 * Names the file when there is one, because "2 files" is not something anybody
 * can act on and `useSessions.ts` is not something they can grep for. A session
 * title is included only when a single other session is involved — with three,
 * the list is the useful thing and the titles are in it.
 */
export function describeOverlap(overlaps: Overlap[]): string {
  const total = new Set(overlaps.flatMap(o => o.files)).size
  const files = overlaps[0]!.files

  if (overlaps.length === 1) {
    const named = overlaps[0]!.total === 1 ? `\`${files[0]}\`` : `${overlaps[0]!.total} files`
    return `Also being changed by "${overlaps[0]!.title}" — ${named}`
  }

  return `${overlaps.length} other sessions change ${total === 1 ? `\`${files[0]}\`` : 'files this one changes'}`
}
