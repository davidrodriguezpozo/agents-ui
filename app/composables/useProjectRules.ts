/**
 * The permissions a project has been granted for good.
 *
 * Scoped to the repository rather than the session: "running the tests here is
 * fine" is true of the project, not of the one conversation that first needed
 * to ask.
 */
export function useProjectRules(repoDir: () => string | undefined) {
  const rules = useState<string[]>('project-rules', () => [])

  async function load() {
    const dir = repoDir()
    if (!dir) return

    try {
      const result = await $fetch<{ rules: string[] }>('/api/project/rules', { query: { dir } })
      rules.value = result.rules
    } catch {
      // An allowlist that cannot be read means asking again, which is safe.
      rules.value = []
    }
  }

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
  }

  return { rules, load, allowRule, revokeRule }
}
