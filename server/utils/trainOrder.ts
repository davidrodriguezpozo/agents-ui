import type { LandingNeed } from './landing'

/**
 * Which session to merge first when merging any of them spoils the rest.
 *
 * Every merge moves the base, so every other session is behind the moment one
 * lands and its green verdict was earned against a branch that no longer
 * exists. `planLanding` already answers this as far as cost goes — the ones
 * already green and up to date first, so their merges happen before anybody has
 * paid for an update. What it cannot see is *why* a session will need
 * re-checking, as opposed to how much that will cost.
 *
 * It is usually the same reason: one session changed a name another one uses.
 * Merge the definition first and the session that calls it is re-checked once,
 * against code that is finished. Merge them the other way round and the
 * re-check happens against a definition that is about to change again — so it
 * is a pass that means nothing, and it will be run twice.
 *
 * So dependency is a constraint on the order, and cost is how the order is
 * chosen inside it:
 *
 *   - **A session whose changed names another session uses goes first.** That is
 *     brief 21's symbol map read for a different question than brief 22 asks of
 *     it: not "what does this merge break" but "what does this merge settle".
 *   - **Everything the constraint leaves free stays cheapest-first**, then
 *     checks-green, then the smaller diff. Which is the previous behaviour
 *     exactly, and it is deliberately not thrown away: dependency edges are
 *     rare, and an ordering that reshuffles a page full of independent sessions
 *     for no reason is one nobody trusts.
 *   - **A cycle is left alone and said out loud.** Two sessions that use each
 *     other's changes have no order that avoids a re-check, and there is no
 *     honest answer to give — so the answer is the cheapest-first order and a
 *     sentence explaining that no order would have helped.
 *
 * Pure, and given plain lists rather than symbol maps, so the whole of it can be
 * tested against dependencies written by hand.
 */

/** Cheapest first, mirroring `planLanding`. */
const NEED_RANK: Record<LandingNeed, number> = { ready: 0, check: 1, update: 2, landed: 3, blocked: 4 }

export interface OrderCandidate {
  id: string
  title: string
  need: LandingNeed
  /** A usable pass. Breaks a tie that dependency and cost both leave open. */
  green: boolean
  /** How big it is. The last tie-break: a small merge is a cheap mistake. */
  changedFiles: number
  /**
   * Names this session's work defines, that another session could be calling.
   *
   * Added or changed, not removed. A name it *takes away* is somebody else's
   * breakage rather than somebody else's dependency, and that question already
   * has an answer of its own — see `collisions.ts`.
   */
  provides?: string[]
  /** Names it uses that another session could be the one defining. */
  uses?: string[]
}

export interface OrderEdge {
  /** Merged first. */
  before: string
  after: string
  /** The name that puts them in that order, for the sentence on the page. */
  name: string
}

export interface TrainOrder {
  /** Candidate ids, in the order to attempt them. */
  order: string[]
  edges: OrderEdge[]
  /** True when the dependencies contradict each other and this fell back. */
  cycle: boolean
  /** One line, for the page. An unexplained reordering reads as a bug. */
  why: string
}

/**
 * Below this a name is not distinguishable from somebody's loop variable.
 * The same threshold `collisions.ts` uses, and for the same reason.
 */
const MIN_NAME_LENGTH = 3

/**
 * Who has to go before whom.
 *
 * A session that defines a name for itself is not depending on anybody else's
 * copy of it, which is the same exclusion `findCollisions` makes: their use of
 * it is theirs.
 */
export function orderEdges(candidates: OrderCandidate[]): OrderEdge[] {
  const edges: OrderEdge[] = []

  for (const provider of candidates) {
    const provides = (provider.provides ?? []).filter(name => name.length >= MIN_NAME_LENGTH)
    if (!provides.length) continue

    for (const user of candidates) {
      if (user.id === provider.id) continue

      const theirs = new Set(user.provides ?? [])
      const uses = new Set(user.uses ?? [])
      const name = provides.find(candidate => uses.has(candidate) && !theirs.has(candidate))

      if (name) edges.push({ before: provider.id, after: user.id, name })
    }
  }

  return edges
}

/**
 * The order, and the sentence that explains it.
 *
 * Kahn's algorithm, with the ready set drained in cost order rather than in
 * insertion order — which is what keeps the previous behaviour wherever
 * dependencies have nothing to say.
 */
export function orderTrain(candidates: OrderCandidate[]): TrainOrder {
  const fallback = [...candidates].sort(cheapestFirst).map(c => c.id)
  if (candidates.length < 2) return { order: fallback, edges: [], cycle: false, why: '' }

  const edges = orderEdges(candidates)
  if (!edges.length) {
    return { order: fallback, edges, cycle: false, why: whyCheapest(candidates) }
  }

  const byId = new Map(candidates.map(c => [c.id, c]))
  const waitingOn = new Map(candidates.map(c => [c.id, 0]))
  const unlocks = new Map<string, string[]>()

  for (const edge of edges) {
    // A duplicate pair would count twice and never reach zero.
    const already = unlocks.get(edge.before) ?? []
    if (already.includes(edge.after)) continue

    unlocks.set(edge.before, [...already, edge.after])
    waitingOn.set(edge.after, (waitingOn.get(edge.after) ?? 0) + 1)
  }

  const order: string[] = []
  const free = candidates.filter(c => !waitingOn.get(c.id)).sort(cheapestFirst)

  while (free.length) {
    const next = free.shift()!
    order.push(next.id)

    for (const id of unlocks.get(next.id) ?? []) {
      const left = (waitingOn.get(id) ?? 1) - 1
      waitingOn.set(id, left)

      if (!left) {
        // Re-sorted rather than pushed: what is cheapest changes as the set
        // does, and appending would make the order depend on the input order.
        free.push(byId.get(id)!)
        free.sort(cheapestFirst)
      }
    }
  }

  if (order.length !== candidates.length) {
    return { order: fallback, edges, cycle: true, why: whyCycle(candidates, edges, waitingOn) }
  }

  return { order, edges, cycle: false, why: whyDependency(byId, edges) }
}

function cheapestFirst(a: OrderCandidate, b: OrderCandidate): number {
  return NEED_RANK[a.need] - NEED_RANK[b.need]
    || Number(b.green) - Number(a.green)
    || a.changedFiles - b.changedFiles
    // So two identical-looking sessions do not swap places between two reads.
    || a.id.localeCompare(b.id)
}

/** The ordinary case, and it still needs a sentence: the order is not arbitrary. */
function whyCheapest(candidates: OrderCandidate[]): string {
  const behind = candidates.filter(c => c.need === 'update').length

  return behind
    ? 'None of these use each other, so the cheapest go first: the ones already green and up to '
      + `date land before ${behind === 1 ? 'the one that needs' : `the ${behind} that need`} bringing forward.`
    : 'None of these use each other, so the cheapest go first — the ones already green and up to date.'
}

function whyDependency(byId: Map<string, OrderCandidate>, edges: OrderEdge[]): string {
  const [first] = edges
  const provider = byId.get(first!.before)?.title ?? 'one session'
  const user = byId.get(first!.after)?.title ?? 'another'
  const more = edges.length - 1

  return `Ordered so changes land before the sessions that use them: "${provider}" defines `
    + `\`${first!.name}\`, which "${user}" calls`
    + `${more ? `, and ${more} other ${more === 1 ? 'name puts' : 'names put'} the rest in order` : ''}. `
    + 'Merging the other way round means checking against a definition that is about to change.'
}

function whyCycle(
  candidates: OrderCandidate[],
  edges: OrderEdge[],
  waitingOn: Map<string, number>,
): string {
  const stuck = candidates
    .filter(c => (waitingOn.get(c.id) ?? 0) > 0)
    .slice(0, 2)
    .map(c => `"${c.title}"`)

  const names = stuck.length === 2 ? `${stuck[0]} and ${stuck[1]}` : stuck[0] ?? 'two of these'
  const name = edges[0]?.name

  return `${names} use each other's changes${name ? ` — ${`\`${name}\``} among them` : ''}, so no order `
    + 'avoids a re-check. Left in the cheapest-first order.'
}
