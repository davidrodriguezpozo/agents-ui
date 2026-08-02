import type { ProjectConfig } from './useScope'

export function useClaudeDir() {
  const claudeDir = useState<string | null>('claudeDir', () => null)
  const exists = useState<boolean>('claudeDirExists', () => true)
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
  }

  return { claudeDir, exists, loading, error, projectClaudeDir, projectClaudeExists, load, set }
}
