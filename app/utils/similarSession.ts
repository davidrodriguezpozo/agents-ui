/**
 * Noticing you have already asked for this.
 *
 * Three pairs of near-identical sessions on this machine, every pair started
 * twenty-one minutes apart: a batch of three, then the same three again. The
 * second set carries typos the first does not — "profiel" for "profile" — so
 * they were retyped from memory rather than re-run. Somebody came back, could
 * not tell that the work was already underway, and asked for it again.
 *
 * That is what happens when work runs while you are not watching, and it costs
 * twice: two agents, two worktrees, two sets of changes to the same files that
 * will conflict with each other whenever anybody tries to merge the second.
 *
 * Nothing here blocks anything. Asking twice on purpose is legitimate — a
 * second attempt at something that went badly is a normal thing to want. The
 * only failure being addressed is not knowing.
 */

/**
 * Character bigrams, which is what makes this survive a typo.
 *
 * Comparing words would put "profiel" and "profile" in different buckets and
 * miss the exact case this exists for. Comparing pairs of letters, most of them
 * still line up.
 */
function bigrams(text: string): Map<string, number> {
  const clean = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const counts = new Map<string, number>()

  for (let i = 0; i < clean.length - 1; i++) {
    const pair = clean.slice(i, i + 2)
    if (pair === '  ') continue
    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }

  return counts
}

/** Dice coefficient: 1 is identical, 0 shares nothing. */
export function similarity(a: string, b: string): number {
  const left = bigrams(a)
  const right = bigrams(b)

  const total = [...left.values()].reduce((n, v) => n + v, 0)
    + [...right.values()].reduce((n, v) => n + v, 0)
  if (!total) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0

  let shared = 0
  for (const [pair, count] of left) {
    shared += Math.min(count, right.get(pair) ?? 0)
  }

  return (2 * shared) / total
}

/**
 * How alike two asks have to be before it is worth mentioning.
 *
 * Set from the real pairs, which score .97 and above, with room for a longer
 * prompt reworded rather than retyped. Too low and every session about the
 * same file looks like a duplicate, which would make the notice worthless.
 */
export const SIMILAR_ENOUGH = 0.82

/** Below this there is not enough text for a score to mean anything. */
const MIN_LENGTH = 12

export interface Candidate {
  id: string
  title: string
  repoDir: string
  status: string
  updatedAt: number
}

/**
 * The closest thing you have already asked for, or null.
 *
 * Same repository only: the same sentence against two different projects is
 * two different jobs. Archived sessions do not count — that work is finished
 * and asking again is the obvious thing to do.
 */
export function findSimilar<T extends Candidate>(
  prompt: string,
  sessions: T[],
  repoDir: string | null | undefined,
): { session: T; score: number } | null {
  const text = prompt.trim()
  if (text.length < MIN_LENGTH || !repoDir) return null

  let best: { session: T; score: number } | null = null

  for (const session of sessions) {
    if (session.repoDir !== repoDir) continue
    if (session.status === 'archived') continue

    const score = similarity(text, session.title)
    if (score >= SIMILAR_ENOUGH && (!best || score > best.score)) {
      best = { session, score }
    }
  }

  return best
}
