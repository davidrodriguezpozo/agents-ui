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

  // `?exclude=session,agent`. Unknown names are dropped for the same reason
  // unknown filters are: a stale link should still list runs.
  const exclude = String(query.exclude ?? '')
    .split(',')
    .map(name => oneOf(name.trim(), SOURCES))
    .filter((name): name is RunSource => Boolean(name))

  return listRuns({
    limit: Number(query.limit) || 50,
    q: typeof query.q === 'string' ? query.q : undefined,
    source: oneOf(query.source, SOURCES),
    outcome: oneOf(query.outcome, OUTCOMES),
    exclude: exclude.length ? exclude : undefined,
  })
})
