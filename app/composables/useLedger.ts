/**
 * What the work that shipped cost.
 *
 * Mirrors what `server/utils/ledger.ts` returns — deliberately, and only as far
 * as this page reads it. `joinOutcomes` produces five dimensions and a check
 * tally; the ledger page uses four of the dimensions and the totals, so the rest
 * is left out rather than copied out of politeness. The server is the authority
 * on all of it.
 */

export interface LedgerWindow {
  days: number
  since: number
  until: number
  previousSince: number
  previousUntil: number
}

export interface LedgerTotals {
  turns: number
  costUsd: number
  landings: { total: number; merged: number; pullRequest: number; elsewhere: number }
  /**
   * Of those, the merges whose work has since been taken back out — as of today,
   * not as of the end of the window. A floor: only a revert that says what it
   * reverts is seen. See `server/utils/revertWatch.ts`.
   */
  revertedLandings: number
  landedCostUsd: number
  abandonedCostUsd: number
  openCostUsd: number
  unattributedCostUsd: number
  /** Indicative, and null when nothing landed. */
  costPerLandingUsd: number | null
  changedFiles: { turns: number; measured: number; share: number | null }
}

export interface LedgerRow {
  key: string
  /** Only rituals have one — their key is an id. Absent means the key is the name. */
  label?: string
  turns: number
  costUsd: number
  landings: number
  /** Of those, the ones since taken back out. Never above `landings`. */
  revertedLandings: number
  costPerLandingUsd: number | null
  unmergedCostUsd: number
  openCostUsd: number
}

export type LedgerDimension = 'ritual' | 'agent' | 'model' | 'repository'

export interface LedgerTable {
  dimension: LedgerDimension
  rows: LedgerRow[]
}

export interface Ledger {
  window: LedgerWindow
  current: LedgerTotals & { side: { costUsd: number; calls: number } }
  previous: LedgerTotals
  perLandingChange: number | null
  tables: LedgerTable[]
}

/** Windows on offer, matching `LEDGER_DAYS` on the server. */
export const LEDGER_DAYS = [7, 14, 30]

/**
 * Fetched on demand rather than polled.
 *
 * Reading a window of run records means opening every run file in it, events
 * and all — see `runRecordsSince`. A four-second poll behind that would be a
 * standing cost for a figure that changes when something merges, which is not
 * several times a minute. The window is shared state so leaving the tab and
 * coming back does not silently reset it to seven days.
 */
export function useLedger() {
  const data = useState<Ledger | null>('ledger', () => null)
  const loading = useState('ledger-loading', () => false)
  const error = useState<string | null>('ledger-error', () => null)
  const days = useState('ledger-days', () => 7)

  async function load(nextDays = days.value) {
    days.value = nextDays
    loading.value = true
    error.value = null

    try {
      data.value = await $fetch<Ledger>('/api/ledger', { query: { days: nextDays } })
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Could not read the ledger'
    } finally {
      loading.value = false
    }
  }

  return { data, loading, error, days, load }
}
