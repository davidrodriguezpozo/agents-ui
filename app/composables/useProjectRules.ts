/**
 * The permissions a project has been granted for good.
 *
 * Scoped to the repository rather than the session: "running the tests here is
 * fine" is true of the project, not of the one conversation that first needed
 * to ask.
 */
export interface DeadRule {
  rule: string
  reason: string
}

export function useProjectRules(repoDir: () => string | undefined) {
  const rules = useState<string[]>('project-rules', () => [])

  /**
   * Of those, the ones that cannot do anything, with why.
   *
   * Only the read returns these — a grant or a revoke answers with the list it
   * just wrote, and re-deciding this from a POST would mean health-checking
   * every MCP server on the click of an × for no benefit. It refreshes on the
   * next `load`, which a session page does anyway.
   */
  const deadRules = useState<DeadRule[]>('project-dead-rules', () => [])

  async function load() {
    const dir = repoDir()
    if (!dir) return

    try {
      const result = await $fetch<{ rules: string[]; deadRules?: DeadRule[] }>(
        '/api/project/rules',
        { query: { dir } },
      )
      rules.value = result.rules
      deadRules.value = result.deadRules ?? []
    } catch {
      // An allowlist that cannot be read means asking again, which is safe.
      rules.value = []
      deadRules.value = []
    }
  }

  /** Why a rule can do nothing, or empty when it can. */
  function deadReason(rule: string): string {
    return deadRules.value.find(dead => dead.rule === rule)?.reason ?? ''
  }

  /** The distinct reasons, since several rules usually share one cause. */
  const deadReasons = computed(() => [...new Set(deadRules.value.map(dead => dead.reason))])

  async function allowRule(rule: string) {
    const dir = repoDir()
    if (!dir) throw new Error('This session has no repository')

    const result = await $fetch<{ rules: string[] }>('/api/project/rules', {
      method: 'POST',
      body: { dir, add: [rule] },
    })
    rules.value = result.rules
  }

  async function revokeRule(rule: string) {
    const dir = repoDir()
    if (!dir) return

    const result = await $fetch<{ rules: string[] }>('/api/project/rules', {
      method: 'POST',
      body: { dir, remove: rule },
    })
    rules.value = result.rules
    // Whatever was removed is no longer anything, dead or otherwise. Dropped
    // here rather than waiting for the next read, so the warning goes with the
    // chip it belonged to instead of outliving it.
    deadRules.value = deadRules.value.filter(dead => dead.rule !== rule)
  }

  return { rules, deadRules, deadReason, deadReasons, load, allowRule, revokeRule }
}
