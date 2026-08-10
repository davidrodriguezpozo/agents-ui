import type { ProjectConfig } from './useScope'

export function useClaudeDir() {
  const claudeDir = useState<string | null>('claudeDir', () => null)
  const exists = useState<boolean>('claudeDirExists', () => true)
  /**
   * Whether there is a Claude Code set-up here, rather than merely a directory.
   * The two differ on a cold machine, where this app creates the directory for
   * its own storage before anybody has set anything up. Defaults to true so a
   * slow or failed load never flashes the welcome at someone who is set up.
   */
  const configured = useState<boolean>('claudeDirConfigured', () => true)
  const loading = useState('claudeDirLoading', () => false)
  const error = useState<string | null>('claudeDirError', () => null)
  const projectClaudeDir = useState<string | null>('projectClaudeDir', () => null)
  const projectClaudeExists = useState('projectClaudeExists', () => false)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<ProjectConfig>('/api/config')
      claudeDir.value = data.claudeDir || null
      exists.value = data.exists
      configured.value = data.configured ?? data.exists
      projectClaudeDir.value = data.projectClaudeDir
      projectClaudeExists.value = data.projectExists
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load config'
      error.value = msg
      console.error('[useClaudeDir] load:', msg)
    } finally {
      loading.value = false
    }
  }

  async function set(dir: string) {
    await $fetch('/api/config', { method: 'POST', body: { claudeDir: dir } })
    claudeDir.value = dir
    exists.value = true
    configured.value = true
  }

  return { claudeDir, exists, configured, loading, error, projectClaudeDir, projectClaudeExists, load, set }
}
