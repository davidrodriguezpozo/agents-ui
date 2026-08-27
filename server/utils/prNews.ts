import { readLivePulls, type LivePull } from './reviewRetire'
import { sessionStore, type Session } from './sessions'

/**
 * What happened to the pull request a session is about, after the session read it.
 *
 * The rail lists in-flight work and, for a review, could say nothing at all about
 * the thing being reviewed. A review session is a detached checkout with no
 * branch, so the branch-keyed join in `useWorkList` never matches it — and even
 * for your own work the join goes quiet rather than saying anything, because a
 * merged pull request drops out of both GitHub lists. The result was a rail full
 * of "Your turn" rows where the honest answer was "somebody merged that an hour
 * ago, there is nothing left to do".
 *
 * Two facts, one question:
 *
 *   - **It is over.** Merged or closed, and whatever the session was for, it is
 *     not that any more.
 *   - **It moved.** New commits on the head since the ones this session read, so
 *     a review composed here describes code that is no longer all of it. This is
 *     the same question `reviewRetire` asks of a *composed* review; asked here of
 *     the session, which is where you decide whether to look again.
 *
 * `reviewRetire` already reads exactly this — state, head commit — one aliased
 * GraphQL round trip per repository, and its `readLivePulls` is what does the
 * asking here too. Two pollers asking GitHub the same question about the same
 * pull requests would be two rate limits and two answers to disagree about.
 *
 * **Silence changes nothing.** `gh` missing, signed out, offline: every session
 * keeps the news it had. A row that quietly stopped saying "merged" because a
 * network call failed is worse than one that never said it.
 */

/** GitHub's own word for where a pull request has got to. */
export type PrLifecycleState = 'OPEN' | 'CLOSED' | 'MERGED'

export interface SessionPrNews {
  /** When GitHub was asked. */
  at: number
  /**
   * The pull request, carried here rather than left to be re-derived: a review
   * session has it in `reviewOf`, your own work has it in a URL, and a row
   * should not have to know which kind it is looking at to print a number.
   */
  number: number
  state: PrLifecycleState
  /**
   * The head commit it has now. Compared against `reviewOf.headSha` — the commit
   * this session actually read — by whoever draws the row.
   */
  headSha: string
}

/**
 * The pull request a session is about, or null.
 *
 * `reviewOf` first: it is recorded rather than parsed, and it is the case that
 * needs this most. `prUrl` is the other end — your own branch, once it has a pull
 * request open — and the number has to come out of the URL because that is the
 * only place it was ever kept.
 */
export function pullNumberFor(session: Session): number | null {
  if (session.reviewOf?.number) return session.reviewOf.number

  const fromUrl = session.prUrl?.match(/\/pull\/(\d+)/)?.[1]
  const number = fromUrl ? Number(fromUrl) : NaN

  return Number.isInteger(number) && number > 0 ? number : null
}

/**
 * Whether this session is still worth asking about.
 *
 * The set has to shrink toward empty, for the reason `reviewRetire` gives about
 * its own: this rides a poll, so anything that asks once per pass forever is a
 * rate limit spent on an answer that cannot change. Merged and closed are final.
 * A session you have filed or closed is not on the rail to be told anything.
 */
export function worthAsking(session: Session): boolean {
  if (session.status === 'archived' || session.filedAt) return false
  if (session.prNews?.state === 'MERGED' || session.prNews?.state === 'CLOSED') return false
  return pullNumberFor(session) !== null
}

/**
 * The sessions to ask about, grouped the way the question is asked: one batch per
 * repository, because that is what one GraphQL query covers.
 *
 * Numbers are de-duplicated per repository — two sessions reviewing the same pull
 * request is the ordinary case, and it is one alias either way.
 */
export function askingPlan(sessions: Session[]): Map<string, number[]> {
  const plan = new Map<string, number[]>()

  for (const session of sessions) {
    if (!worthAsking(session)) continue

    const number = pullNumberFor(session)!
    const numbers = plan.get(session.repoDir) ?? []
    if (!numbers.includes(number)) numbers.push(number)
    plan.set(session.repoDir, numbers)
  }

  return plan
}

/**
 * What to write on the session, given what GitHub said. Null means leave it
 * alone.
 *
 * Null rather than "write the same thing again" because every write here costs a
 * `updatedAt` somebody reads as recency — see `applyNews` — and because the
 * ordinary answer, on the ordinary pass, is that nothing has changed.
 */
export function newsFor(session: Session, live: LivePull, at: number): SessionPrNews | null {
  const state = live.state as PrLifecycleState
  if (state !== 'OPEN' && state !== 'CLOSED' && state !== 'MERGED') return null

  const stored = session.prNews
  if (stored && stored.state === state && stored.headSha === live.headRefOid) return null

  // An open pull request that has not moved past what this session read is the
  // ordinary case and is not news. Recording it would put a row's whole state
  // behind a poll that has nothing to report.
  const read = session.reviewOf?.headSha
  if (state === 'OPEN' && (!read || read === live.headRefOid) && !stored) return null

  return { at, number: live.number, state, headSha: live.headRefOid }
}

/**
 * Write it without touching `updatedAt`.
 *
 * `patchSession` bumps it, and every row in the rail reads that field as "when
 * this last did something" — it is the `1h ago` on the row and the order the
 * groups are in. A background poll going through it would march every session
 * that has a pull request to the top of the rail saying "just now", which is
 * both wrong and the kind of wrong that is hard to trace back to a poller.
 */
async function applyNews(id: string, news: SessionPrNews): Promise<void> {
  await sessionStore.update((sessions) => {
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return null

    sessions[index] = { ...sessions[index]!, prNews: news }
    return news
  })
}

/**
 * One pass: ask each repository about its pull requests, stamp what changed.
 *
 * Called from the scheduler's event poll rather than on a timer of its own, for
 * the reason `pollPullRequests` gives — the same kind of question at the same
 * kind of interval, and two pollers would be twice the rate limit and two things
 * to reason about.
 */
export async function pollPrNews(now = Date.now()): Promise<void> {
  let sessions: Session[]

  try {
    sessions = await sessionStore.read()
  } catch (e) {
    console.error('[pr-news] could not read sessions', e)
    return
  }

  const plan = askingPlan(sessions)

  for (const [repoDir, numbers] of plan) {
    let live: Map<number, LivePull> | null = null

    try {
      live = await readLivePulls(repoDir, numbers)
    } catch (e) {
      console.error(`[pr-news] could not ask about ${repoDir}`, e)
    }

    // Null is "could not ask", which is not "nothing has happened".
    if (!live) continue

    for (const session of sessions) {
      if (session.repoDir !== repoDir || !worthAsking(session)) continue

      const answer = live.get(pullNumberFor(session)!)
      if (!answer) continue

      const news = newsFor(session, answer, now)
      if (news) await applyNews(session.id, news)
    }
  }
}
