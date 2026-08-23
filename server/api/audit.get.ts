import { auditFilename, auditLines, toJsonl } from '../utils/auditExport'
import { getClaudeDir } from '../utils/claudeDir'
import { runRecordsSince } from '../utils/runStore'
import { readSessions } from '../utils/sessions'
import { join } from 'node:path'

/**
 * The audit file, as a download.
 *
 * A `GET` because it is a read and because that makes it `curl`-able — a
 * governance record you can only obtain by clicking is a record somebody has to
 * take a screenshot of. `Content-Disposition` is what makes the browser save it
 * rather than render a wall of JSON.
 *
 * `?days=` is the window and nothing else is configurable: an export with options
 * is an export two people can produce differently and then argue about.
 */
export default defineEventHandler(async (event) => {
  const days = Math.max(1, Math.min(Number(getQuery(event).days) || 7, 365))
  const now = Date.now()
  const since = now - days * 86_400_000

  const [runs, sessions] = await Promise.all([
    runRecordsSince(since).catch(() => []),
    readSessions().catch(() => []),
  ])

  const lines = auditLines({
    since,
    until: now,
    now,
    runs,
    sessions,
    // Where Claude Code keeps them, which is not inside this app's store.
    transcriptsAt: join(getClaudeDir(), 'projects'),
  })

  setResponseHeaders(event, {
    // `application/x-ndjson` is the registered type, and saying so means an
    // auditor's tooling knows it is line-delimited before opening it.
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Content-Disposition': `attachment; filename="${auditFilename(since, now)}"`,
    'Cache-Control': 'no-store',
  })

  return toJsonl(lines)
})
