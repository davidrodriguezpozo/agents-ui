const STORAGE_KEY = 'agents-ui:working-dir'

/**
 * Which project is active.
 *
 * This used to be the entire notion of a project: one path, in local storage,
 * retyped whenever you wanted to work somewhere else. The list of projects now
 * lives on the server (see `useProjects`) and this is only the pointer into it.
 *
 * Local storage is kept as a mirror rather than as the record, because the
 * request interceptor stamps `x-project-dir` on requests synchronously — before
 * anything has been fetched — and because it makes the sidebar render the right
 * project on the first frame instead of after a round trip.
 */
export function useWorkingDir() {
  const workingDir = useState<string>('working-dir', () => '')

  if (import.meta.client && !workingDir.value) {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) workingDir.value = stored
  }

  /**
   * Point at a project. `persist: false` is for changes that came *from* the
   * server — following one back with a write would be a pointless round trip,
   * and could overwrite a switch that happened while it was in flight.
   */
  function setWorkingDir(dir: string, opts: { persist?: boolean } = {}) {
    const trimmed = dir.trim()
    if (trimmed === workingDir.value && opts.persist === false) return

    workingDir.value = trimmed

    if (import.meta.client) {
      if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed)
      else localStorage.removeItem(STORAGE_KEY)
    }

    if (opts.persist !== false && import.meta.client) {
      // Fire and forget: the pointer is already correct locally, and a failure
      // to record it must not block the switch the person just made.
      $fetch('/api/projects/active', {
        method: 'PUT',
        body: { path: trimmed || null },
      }).catch(() => {})
    }
  }

  function clearWorkingDir() {
    setWorkingDir('')
  }

  const displayPath = computed(() => {
    if (!workingDir.value) return null
    // Show last 2 segments for brevity
    const parts = workingDir.value.split('/')
    return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : workingDir.value
  })

  return {
    workingDir: readonly(workingDir),
    displayPath,
    setWorkingDir,
    clearWorkingDir,
  }
}
