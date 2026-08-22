/**
 * The three things this machine already knows went wrong, collected.
 *
 * Every one of these signals was being thrown away one record at a time. A
 * landing that was reverted an hour later is in `revertWatch`; a check that went
 * red across every session in a repository right after a merge is in
 * `check-history.json`; a tool or a host refused in run after run is on the run
 * records themselves. Each of them is a fact about how work here actually fails,
 * and none of them was ever looked at twice.
 *
 * This is the input half of the learned-rules loop and it stops at a list.
 * Collection is mechanical, so it lives here with tests over fixtures; writing a
 * rule from a lesson is a judgement, so it lives in brief 26 and nothing here
 * goes anywhere near `CLAUDE.md`. The separation is the point: what the industry
 * sells as opaque cloud memory is, here, a list you can read and disagree with.
 *
 * Four decisions worth stating:
 *
 *   - **No prose and no model.** Every field is an id, a count, a name or a
 *     timestamp. A sentence written by a model about why your merge was reverted
 *     is a sentence nobody can check, and the whole value of this list is that
 *     every row can be traced back to the records it came from.
 *   - **Deduplicated on a key, not on a day.** The same lesson surfacing every
 *     week is one lesson with a count of five, because a list that repeats
 *     itself is a list that gets skimmed. The key is the thing the lesson is
 *     *about* — a repository, a check, a tool — never the occurrence.
 *   - **A window, so a signal that stops recurring ages out.** Nothing here has
 *     a memory: a lesson is only in the list while the thing it is about is
 *     still happening. A tool that was refused ten times in March and never
 *     since is not a lesson, it is history.
 *   - **A threshold per kind, because the kinds are not equally rare.** One
 *     reverted landing is worth knowing about; one denied tool is a Tuesday. The
 *     numbers are named constants and are the first thing to change if the real
 *     list on a real machine reads as noise.
 */

/** Which of the three signals a candidate came from. */
export type LessonKind =
  /** Work this machine landed that was taken back out. */
  | 'reverted'
  /** A check that went red across the repository just after a landing. */
  | 'base-broken'
  /** The same tool or host refused over and over. */
  | 'denied'

export interface LessonSessionRef {
  id: string
  title: string
}

export interface LessonCandidate {
  /**
   * What this lesson is about, and therefore what makes two occurrences one
   * lesson. Stable across days on purpose — see the note above.
   */
  key: string
  kind: LessonKind
  /** How many occurrences inside the window. */
  count: number
  /** The most recent one. What makes a lesson age out is this going stale. */
  lastAt: number
  /** The first one inside the window, so a row can say "five times since Tuesday". */
  firstAt: number
  /** The repository, when the lesson belongs to one. */
  repoDir?: string
  /**
   * The names this lesson is about: a check, a tool, a host, a file. Never a
   * sentence — the caller is what turns these into words.
   */
  subjects: string[]
  /** The sessions it happened in, newest first and capped. */
  sessions: LessonSessionRef[]
}

/** Enough sessions to follow it up, not so many that the row is a list. */
const NAMED_SESSIONS = 5

/**
 * How far back anything is looked at.
 *
 * A month, because the shortest useful signal here — the same tool refused over
 * and over — needs several runs to be a pattern, and the longest — a landing
 * reverted a week later — needs the week.
 */
export const LESSON_WINDOW_DAYS = 30

/**
 * How many occurrences make a lesson, per kind.
 *
 * `reverted` is 1 because a revert is already somebody deciding the work was
 * wrong, and that is the signal. The other two are noisy in ones: a check goes
 * red for a hundred reasons and a tool is refused every time an unattended run
 * meets one it was never granted, so those need a repeat before they are a
 * pattern rather than a Tuesday.
 */
export const LESSON_THRESHOLD: Record<LessonKind, number> = {
  'reverted': 1,
  'base-broken': 2,
  'denied': 3,
}

/** How long after a landing a red check is still plausibly that landing's fault. */
const BASE_BROKEN_WINDOW_MS = 24 * 60 * 60_000

// --- What the collectors are given ------------------------------------------

export interface LessonSession {
  id: string
  title: string
  repoDir?: string
  landed?: { at: number }
  reverted?: { at: number; committedAt?: number; subject?: string }
}

export interface LessonRun {
  id: string
  at: number
  sessionId?: string
  projectDir?: string
  /** Tools refused because nobody was there to answer. */
  deniedTools?: string[]
  /** Hosts the sandbox refused. */
  refusedHosts?: string[]
}

export interface LessonCheckRun {
  at: number
  passed: boolean
  /** The checks that failed. Empty on a passing run. */
  failed: string[]
}

export interface LessonInput {
  now: number
  sessions: LessonSession[]
  runs: LessonRun[]
  /** Check history per repository, as `check-history.json` holds it. */
  checks: Record<string, LessonCheckRun[]>
  windowDays?: number
}

// --- Collecting -------------------------------------------------------------

/**
 * A working candidate, before it is a candidate: the collectors accumulate into
 * these so that occurrence two of a lesson updates occurrence one rather than
 * appending beside it.
 */
interface Accumulating extends Omit<LessonCandidate, 'sessions'> {
  sessions: Map<string, LessonSessionRef>
}

/** One occurrence, as a collector hands it over. `at` becomes both timestamps. */
interface Occurrence {
  key: string
  kind: LessonKind
  at: number
  repoDir?: string
  subjects: string[]
}

function bump(
  into: Map<string, Accumulating>,
  seed: Occurrence,
  session?: LessonSessionRef,
): void {
  const held = into.get(seed.key)

  if (!held) {
    into.set(seed.key, {
      key: seed.key,
      kind: seed.kind,
      count: 1,
      lastAt: seed.at,
      firstAt: seed.at,
      repoDir: seed.repoDir,
      subjects: [...seed.subjects],
      sessions: new Map(session ? [[session.id, session]] : []),
    })
    return
  }

  held.count++
  held.lastAt = Math.max(held.lastAt, seed.at)
  held.firstAt = Math.min(held.firstAt, seed.at)
  for (const subject of seed.subjects) {
    if (!held.subjects.includes(subject)) held.subjects.push(subject)
  }
  if (session && !held.sessions.has(session.id)) held.sessions.set(session.id, session)
}

/**
 * Work this machine landed that was later taken back out.
 *
 * Keyed by repository rather than by session, and that is the dedup decision
 * that matters: three reverts in one repository in a fortnight is one lesson
 * about that repository, and three lessons would read as three unrelated
 * accidents. The revert subjects come along as subjects, so the row can point at
 * the commits without a model summarising them.
 *
 * Dated by when the revert was *committed* where that is known, not by when this
 * machine noticed — a laptop that was shut for two days must not make a
 * fortnight-old revert look like today's news.
 */
function revertedLessons(input: LessonInput, since: number): Map<string, Accumulating> {
  const found = new Map<string, Accumulating>()

  for (const session of input.sessions) {
    if (!session.landed || !session.reverted) continue

    const at = session.reverted.committedAt || session.reverted.at
    if (at < since) continue

    bump(found, {
      key: `reverted:${session.repoDir ?? 'unknown'}`,
      kind: 'reverted',
      at,
      repoDir: session.repoDir,
      subjects: session.reverted.subject ? [session.reverted.subject] : [],
    }, { id: session.id, title: session.title })
  }

  return found
}

/**
 * A check that went red across the repository just after something landed.
 *
 * This machine never runs the base branch's own tests, so the base going red is
 * not a thing it can observe directly. What it *can* observe is every session in
 * that repository starting to fail a check that was passing before the merge —
 * which is the same event seen from the only place this app is standing.
 *
 * Two guards keep it from being a list of ordinary broken code. The check has to
 * have been *passing* in the same repository before the landing, so a suite that
 * was already red says nothing. And it has to fail inside a day of the landing,
 * because past that the honest answer is that anything could have broken it.
 */
function baseBrokenLessons(input: LessonInput, since: number): Map<string, Accumulating> {
  const found = new Map<string, Accumulating>()

  const landings = input.sessions
    .filter(session => session.landed && session.landed.at >= since && session.repoDir)
    .map(session => ({ at: session.landed!.at, repoDir: session.repoDir!, session }))

  for (const landing of landings) {
    const runs = input.checks[landing.repoDir] ?? []

    /*
     * Something has to have been fine before it. A repository whose checks have
     * never passed here is not evidence either way, and treating it as evidence
     * would make the first verdict in a repository read as a regression.
     */
    if (!runs.some(run => run.at < landing.at && run.passed)) continue

    // Red before the merge is not the merge's doing.
    const wasFailing = new Set(
      runs.filter(run => run.at < landing.at && !run.passed).flatMap(run => run.failed),
    )

    const after = runs.filter(run => run.at > landing.at && run.at <= landing.at + BASE_BROKEN_WINDOW_MS)

    for (const run of after) {
      for (const check of run.failed) {
        // Already red before the merge: not this landing's doing.
        if (wasFailing.has(check)) continue

        bump(found, {
          key: `base-broken:${landing.repoDir}:${check}`,
          kind: 'base-broken',
          at: run.at,
          repoDir: landing.repoDir,
          subjects: [check],
        }, { id: landing.session.id, title: landing.session.title })
      }
    }
  }

  return found
}

/**
 * The same tool or host refused, over and over.
 *
 * One refusal is how an unattended run tells you it met something it was never
 * granted, and the app already offers to grant exactly that on the spot. This is
 * the other case: the offer was never taken, and the same wall has been hit
 * every night since. Keyed by the thing refused, so ten runs blocked on one host
 * is one lesson with a count of ten.
 *
 * Tools and hosts are kept apart in the key even though they read alike, because
 * the fix is different — one is a permission rule, the other is a sandbox
 * domain — and a lesson that cannot say which is not worth acting on.
 */
function deniedLessons(input: LessonInput, since: number): Map<string, Accumulating> {
  const found = new Map<string, Accumulating>()
  const titles = new Map(input.sessions.map(session => [session.id, session.title]))

  for (const run of input.runs) {
    if (run.at < since) continue

    const session = run.sessionId
      ? { id: run.sessionId, title: titles.get(run.sessionId) ?? run.sessionId }
      : undefined

    for (const [what, names] of [['tool', run.deniedTools], ['host', run.refusedHosts]] as const) {
      for (const name of new Set(names ?? [])) {
        if (!name) continue

        bump(found, {
          key: `denied:${what}:${name}`,
          kind: 'denied',
          at: run.at,
          repoDir: run.projectDir,
          subjects: [name],
        }, session)
      }
    }
  }

  return found
}

/**
 * Every candidate, deduplicated, thresholded and ordered.
 *
 * Most recent first rather than most frequent: a lesson from this morning is
 * worth reading before one that stopped happening a fortnight ago, however many
 * times the fortnight-old one occurred. Count breaks the tie.
 */
export function collectLessons(input: LessonInput): LessonCandidate[] {
  const days = Math.max(1, input.windowDays ?? LESSON_WINDOW_DAYS)
  const since = input.now - days * 86_400_000

  const all = [
    ...revertedLessons(input, since).values(),
    ...baseBrokenLessons(input, since).values(),
    ...deniedLessons(input, since).values(),
  ]

  return all
    .filter(candidate => candidate.count >= LESSON_THRESHOLD[candidate.kind])
    .map(candidate => ({
      ...candidate,
      sessions: [...candidate.sessions.values()].slice(0, NAMED_SESSIONS),
    }))
    .sort((a, b) => b.lastAt - a.lastAt || b.count - a.count || a.key.localeCompare(b.key))
}
