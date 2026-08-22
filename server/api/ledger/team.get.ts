import { collectLocalLedger } from '../../utils/ledgerCollect'
import { LEDGER_BRANCH } from '../../utils/ledgerSync'
import { machineId, machineSlug, readLedgerFiles, teamLedger } from '../../utils/sharedLedger'

/**
 * The team's totals, from the files on this disk and nothing else.
 *
 * Reading is deliberately offline. Nothing here fetches, so the page loads at
 * the same speed whether or not the network is up, and what it shows is exactly
 * what the last sync brought in — which is why every machine row carries its
 * own freshness instead of the page implying they are all current. Pulling is
 * `POST /api/ledger/sync`, because it is a thing somebody chose to do.
 *
 * Collecting first is not the same as fetching: it appends what this machine
 * has done since the last look to this machine's own file, which is local, cheap
 * and idempotent. Without it the page would show a colleague's work and not
 * yours until something else happened to run.
 */
export default defineEventHandler(async (event) => {
  const days = Math.max(1, Math.min(Number(getQuery(event).days) || 30, 365))
  const now = Date.now()

  const collected = await collectLocalLedger(now)
  const files = await readLedgerFiles()
  const report = teamLedger(files, now - days * 86_400_000)

  return {
    ...report,
    days,
    since: now - days * 86_400_000,
    /** So the page can say which row is this machine rather than guessing. */
    machine: machineSlug(await machineId()),
    branch: LEDGER_BRANCH,
    collected,
  }
})
