export interface ProviderCapabilities {
  canSteer: boolean
  canPromptForPermission: boolean
  reportsCostUsd: boolean
}

export interface ProviderInfo {
  id: string
  label: string
  /** Whether this machine actually has the binary. */
  available: boolean
  path: string | null
  capabilities: ProviderCapabilities
}

/**
 * Which agents this machine can run a session on.
 *
 * Read from `/api/system/health`, which answers it from the same lookups the
 * runs use — so a picker cannot offer an agent that is not installed. That was
 * the failure worth avoiding: choosing one that is missing fails on the first
 * turn, *after* a worktree has been cut and a branch created, leaving a
 * workspace to clean up over a decision that could have been refused up front.
 *
 * Fetched once and shared. A CLI does not appear or vanish while somebody is
 * looking at a page, and the health endpoint spawns `git --version` — polling it
 * for a picker that changes once a year would be the wrong trade.
 */
export function useProviders() {
  const providers = useState<ProviderInfo[]>('providers', () => [])
  const loaded = useState('providersLoaded', () => false)

  async function fetchAll() {
    if (loaded.value) return
    try {
      const health = await $fetch<{ providers?: ProviderInfo[] }>('/api/system/health')
      providers.value = health.providers ?? []
      loaded.value = true
    } catch (e) {
      console.error('[useProviders] fetchAll:', e)
    }
  }

  /** The ones that can actually run something here. */
  const available = computed(() => providers.value.filter(p => p.available))

  /**
   * Whether there is a choice to make.
   *
   * A picker with one option is a control that cannot do anything, and on the
   * many machines with only Claude Code installed that is what this would be.
   * So the picker is not shown at all rather than shown inert.
   */
  const hasChoice = computed(() => available.value.length > 1)

  function find(id?: string | null): ProviderInfo | undefined {
    return providers.value.find(p => p.id === (id || 'claude'))
  }

  /**
   * What a provider cannot do, in the words a person choosing one needs.
   *
   * Only the absences, and only before the fact. Discovering after two turns
   * that this agent will never stop and ask — it just refuses and carries on
   * having done less — is the thing this exists to prevent.
   */
  function shortfalls(id?: string | null): string[] {
    const can = find(id)?.capabilities
    if (!can) return []

    return [
      can.canPromptForPermission
        ? null
        : 'cannot stop to ask for a tool it was not granted — it is refused, and the turn carries on without it',
      can.canSteer
        ? null
        : 'cannot be interrupted mid-turn, so a correction is queued as the next turn instead',
      can.reportsCostUsd
        ? null
        : 'does not report what a turn cost, so its spend is recorded as unknown rather than as nothing',
    ].filter((line): line is string => line !== null)
  }

  return { providers, available, hasChoice, loaded, fetchAll, find, shortfalls }
}
