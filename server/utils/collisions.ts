import { mapLimit } from './pool'
import type { Session } from './sessions'
import { symbolMap, type SymbolMap } from './symbols'
import { diffBase } from './worktrees'

/**
 * The name this merge takes away that somebody else is still calling.
 *
 * `findOverlaps` says two sessions are changing the same file, and `conflicts`
 * says git will refuse the merge. Between those two there is a hole with nothing
 * in it: session A renames `resolveAgent`, session B adds four call sites to it,
 * the two sessions never touch the same file, git merges both without a murmur,
 * and `main` stops compiling. Nothing on the page had anything to say about that
 * — not the overlap badge, which needs a shared path, and not the conflict list,
 * which needs a shared line.
 *
 * It is also the one thing here that no cloud tool can do. Answering it needs
 * every checkout on one machine at once, and that is exactly what this app has.
 *
 * So: `symbols.ts` for what each session's diff defines, drops and depends on,
 * and an intersection. Reported beside the checks verdict in the merge dialog,
 * and reported is all. **Nothing here blocks a merge** — the checks gate, this
 * informs, and a warning that stops you from working is a warning you learn to
 * click through.
 *
 * ## Only what goes away
 *
 * Of the three sets `symbols.ts` produces, this reads `removed` and nothing
 * else. A name the merge *adds* cannot break a call site, and `defined` includes
 * every name whose declaring line the diff merely touched — intersecting that
 * with other sessions' `used` lights up on any two sessions that share a helper,
 * which is most of them. False positives are how a warning like this stops being
 * read, so the set is the narrow one: names that exist before this merge and do
 * not exist after it.
 *
 * ## Deliberately not detected
 *
 * Everything `symbols.ts` misses, plus four of this pass's own:
 *
 *   - **A signature change.** `resolveAgent(slug)` becoming
 *     `resolveAgent(slug, opts)` breaks every caller and the name is still
 *     there, so nothing here sees it. Telling them apart needs a parser, and
 *     `package.json` has no runtime dependencies by design.
 *   - **Which module a name came from.** There is no resolution here, so two
 *     unrelated `handler`s are one name. Two rules keep the common cases quiet:
 *     a name the other session also declares in its own diff is treated as its
 *     own, and a name of one or two characters is never reported at all.
 *   - **A name moved between files.** Removed from one file and defined in
 *     another is a move, not a removal, and is dropped — including the case
 *     where the file itself was renamed.
 *   - **Uses nobody is currently editing.** This compares diffs, not
 *     repositories. A call site in a file no live session has touched is not
 *     here, and does not need to be: it is in `main` already, so the merge
 *     breaks it in the open where the checks will find it. What this exists for
 *     is the call site that is not in `main` yet and therefore cannot be
 *     checked against anything.
 *
 * ## What it costs
 *
 * One `symbolMap` per live session in the repository, which is one to three
 * `git` invocations each and cached per worktree. Read only when the merge
 * dialog opens, never on a poll — and short-circuited before any other
 * session's worktree is touched when this session removes no names at all,
 * which is the ordinary case.
 */

/** Enough to act on. A longer list is the diff's job, not a dialog's. */
const MAX_REPORTED = 5

/** Sessions named per name; past this the count carries it. */
const NAMED_SESSIONS = 3

/**
 * Below this a name is not distinguishable from somebody's loop variable.
 *
 * `id`, `fn`, `db` and `on` are declared and used independently all over a
 * repository, and with no module resolution here every one of them would
 * collide with every other one.
 */
const MIN_NAME_LENGTH = 3

/** Which session, in the two terms a dialog can show. */
export interface CollisionSession {
  id: string
  title: string
}

export interface Collision {
  /** The name that goes away, spelled as the code spells it. */
  name: string
  /** The file this session takes it out of. */
  path: string
  /** The sessions that depend on it, named — the first few of `total`. */
  sessions: CollisionSession[]
  /** How many depend on it, named or not. */
  total: number
  /** The whole judgement, in words, for the person about to merge. */
  note: string
}

/** One other session's work, as this pass needs to see it. */
export interface CollisionCandidate {
  session: CollisionSession
  map: SymbolMap
}

function describeDependents(path: string, named: CollisionSession[], total: number): string {
  const titles = named.map(session => `"${session.title}"`).join(', ')
  const unnamed = total - named.length

  if (total === 1) return `gone from \`${path}\`, and ${titles} calls it.`

  return `gone from \`${path}\`, and ${total} other sessions call it — ${titles}`
    + `${unnamed ? ` and ${unnamed} more` : ''}.`
}

/**
 * The names one session's work takes away that others still depend on.
 *
 * Pure, and separate from `collisionsFor` on purpose: this is the decision, and
 * it is the half worth testing against symbol maps written by hand. The half
 * above it is `git`.
 */
export function findCollisions(mine: SymbolMap, others: CollisionCandidate[]): Collision[] {
  if (!others.length) return []

  // A name removed here and defined there is a move. The whole repository still
  // has it after this merge, so nothing that calls it is any worse off.
  const stillMine = new Set(mine.files.flatMap(file => file.defined))

  /** Name to the file it left, first mention winning. */
  const gone = new Map<string, string>()
  for (const file of mine.files) {
    for (const name of file.removed) {
      if (name.length < MIN_NAME_LENGTH || stillMine.has(name) || gone.has(name)) continue
      gone.set(name, file.path)
    }
  }

  const collisions: Collision[] = []

  for (const [name, path] of gone) {
    const dependents = others.filter((other) => {
      // Their own name, declared in their own diff — so their use of it is
      // theirs, whatever this session happens to be removing elsewhere.
      if (other.map.files.some(file => file.defined.includes(name))) return false
      return other.map.files.some(file => file.used.includes(name))
    })

    if (!dependents.length) continue

    const named = dependents.slice(0, NAMED_SESSIONS).map(other => other.session)
    collisions.push({
      name,
      path,
      sessions: named,
      total: dependents.length,
      note: describeDependents(path, named, dependents.length),
    })
  }

  // Most-depended-on first: the name three sessions call is the one to look at
  // before the name one does. Ties go alphabetically so the list does not
  // reshuffle between two reads of the same state.
  return collisions
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, MAX_REPORTED)
}

/**
 * Sessions whose work could still land, and so could still be broken by this.
 *
 * The same eligibility `findOverlaps` uses, for the same reason: a session whose
 * work is merged, archived, or whose workspace is gone cannot be broken by
 * anything, and naming it is the noise that gets the whole warning ignored. A
 * landing that was reverted is back to being outstanding, so it counts again.
 */
function couldStillLand(other: Session, subject: Session): boolean {
  return other.id !== subject.id
    && other.repoDir === subject.repoDir
    && !other.detached
    && !(other.landed && !other.reverted)
    && !other.worktreeRemovedAt
    && other.status !== 'archived'
    && Boolean(other.worktreePath)
}

/**
 * What merging this session would take away from the others still in flight.
 *
 * Never throws. This decorates a merge preview, and a worktree that has gone
 * missing under a `git` call must not take the preview down with it — the
 * dialog then says nothing extra, which is what it said before any of this
 * existed.
 */
export async function collisionsFor(session: Session, all: Session[]): Promise<Collision[]> {
  // A review workspace holds somebody else's commit and will never merge, so
  // there is nothing for it to take away.
  if (session.detached) return []

  try {
    const others = all.filter(other => couldStillLand(other, session))
    if (!others.length) return []

    const mine = await symbolMap(session.worktreePath, await diffBase(session))
    // Before touching anybody else's worktree. Most merges remove no names at
    // all, and this is what keeps those free.
    if (!mine.files.some(file => file.removed.length)) return []

    const maps = await mapLimit(others, 4, async other =>
      symbolMap(other.worktreePath, await diffBase(other)))

    return findCollisions(mine, others.map((other, index) => ({
      session: { id: other.id, title: other.title },
      map: maps[index]!,
    })))
  } catch {
    return []
  }
}

/** The headline, once there is at least one. Plain, and about this merge. */
export function describeCollisions(collisions: Collision[]): string {
  return collisions.length === 1
    ? 'This merge takes away a name another session is still calling'
    : `This merge takes away ${collisions.length} names other sessions are still calling`
}
