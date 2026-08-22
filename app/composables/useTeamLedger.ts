/**
 * The team's totals, as this machine last heard them.
 *
 * Mirrors what `server/api/ledger/team.get.ts` returns, and only as far as the
 * page reads it. Two things are worth knowing before rendering any of it: every
 * number is as fresh as the last sync, which is why `machines` carries a
 * timestamp each rather than the page implying they are all current; and the
 * counts here are not the same population as `useLedger` — that one is this
 * machine's run log joined to its sessions, this one is one line per outcome
 * from every machine that has pushed. They will not tie exactly, and a page
 * that presented them as one figure would be the arithmetic nobody can
 * reproduce.
 */

export interface TeamTotals {
  turns: number
  costUsd: number
  landings: number
  reverts: number
  checks: { passing: number; failing: number }
}

export interface TeamMachine {
  machine: string
  entries: number
  lastAt?: number
  corrupt: number
  newer: number
  totals: TeamTotals
}

export interface TeamPerson {
  person: string
  totals: TeamTotals
}

export interface TeamLedger {
  totals: TeamTotals
  machines: TeamMachine[]
  people: TeamPerson[]
  unattributedCostUsd: number
  days: number
  since: number
  /** Which row is this machine. */
  machine: string
  branch: string
}

/** What a sync did, in the two words that matter. */
export interface TeamSync {
  push: { pushed: boolean; skip?: string; branch: string }
  pull: { machines: string[]; skip?: string }
}

export function useTeamLedger() {
  const data = useState<TeamLedger | null>('team-ledger', () => null)
  const loading = useState('team-ledger-loading', () => false)
  const syncing = useState('team-ledger-syncing', () => false)
  const error = useState<string | null>('team-ledger-error', () => null)
  const lastSync = useState<TeamSync | null>('team-ledger-last-sync', () => null)

  async function load(days = 30) {
    loading.value = true
    error.value = null
    try {
      data.value = await $fetch<TeamLedger>('/api/ledger/team', { query: { days } })
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      loading.value = false
    }
  }

  /**
   * Push and pull, through one repository.
   *
   * The report comes back in the same response, so the page does not show a
   * spinner, then stale numbers, then the new ones.
   */
  async function sync(repoDir: string) {
    syncing.value = true
    error.value = null
    try {
      const result = await $fetch<TeamLedger & TeamSync>('/api/ledger/sync', {
        method: 'POST',
        body: { repoDir },
      })

      lastSync.value = { push: result.push, pull: result.pull }
      data.value = result
      return result
    } catch (e) {
      error.value = errorMessage(e)
      return null
    } finally {
      syncing.value = false
    }
  }

  return { data, loading, syncing, error, lastSync, load, sync }
}
