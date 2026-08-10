import type { Scope } from '~/types'

export interface ProjectConfig {
  claudeDir: string
  exists: boolean
  /**
   * Whether there is a Claude Code set-up here, rather than merely a directory.
   * They differ on a cold machine: this app creates `~/.claude/agents-ui` for
   * its own storage while it boots, so the directory exists before anyone has
   * configured anything.
   */
  configured: boolean
  projectDir: string | null
  projectClaudeDir: string | null
  projectExists: boolean
}

/**
 * The scope new items are created in, and whether a project scope is available
 * at all. Reading is always merged across scopes; only writes need a target.
 */
export function useScope() {
  const { workingDir } = useWorkingDir()
  const projectClaudeExists = useState('projectClaudeExists', () => false)
  const projectClaudeDir = useState<string | null>('projectClaudeDir', () => null)
  const createScope = useState<Scope>('createScope', () => 'user')

  const hasProject = computed(() => Boolean(workingDir.value))
  const canUseProjectScope = computed(() => hasProject.value && projectClaudeExists.value)

  // A project can be deselected while "project" is still the chosen target.
  watchEffect(() => {
    if (createScope.value === 'project' && !canUseProjectScope.value) {
      createScope.value = 'user'
    }
  })

  async function refresh() {
    try {
      const data = await $fetch<ProjectConfig>('/api/config')
      projectClaudeExists.value = data.projectExists
      projectClaudeDir.value = data.projectClaudeDir
    } catch {
      projectClaudeExists.value = false
      projectClaudeDir.value = null
    }
  }

  /** Create `<project>/.claude` so project-scoped writes have a home. */
  async function initProject() {
    const result = await $fetch<{ created: boolean; claudeDir: string }>('/api/project/init', { method: 'POST' })
    projectClaudeExists.value = true
    projectClaudeDir.value = result.claudeDir
    createScope.value = 'project'
    return result
  }

  /** Append `?scope=` to a request path. */
  function withScope(path: string, scope?: Scope): string {
    const target = scope ?? createScope.value
    const separator = path.includes('?') ? '&' : '?'
    return `${path}${separator}scope=${target}`
  }

  return {
    createScope,
    hasProject,
    canUseProjectScope,
    projectClaudeExists,
    projectClaudeDir,
    refresh,
    initProject,
    withScope,
  }
}
