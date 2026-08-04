import { listRuns } from '../../utils/runStore'
import type { RunOutcomeFilter, RunSource } from '../../utils/runFilter'

const SOURCES: RunSource[] = ['ritual', 'session', 'agent', 'command']
const OUTCOMES: RunOutcomeFilter[] = ['running', 'completed', 'failed', 'cancelled', 'attention']

/** Unknown values are dropped rather than 400'd — a stale link still lists runs. */
function oneOf<T extends string>(value: unknown, allowed: T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  return listRuns({
    limit: Number(query.limit) || 50,
    q: typeof query.q === 'string' ? query.q : undefined,
    source: oneOf(query.source, SOURCES),
    outcome: oneOf(query.outcome, OUTCOMES),
  })
})
