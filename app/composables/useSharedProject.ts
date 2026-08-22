/**
 * The half of this project's configuration that lives in the repository.
 *
 * Mirrors `GET /api/project/shared`, and exists so a page can answer the two
 * questions the shared half raises: *is this value mine or ours*, and *what is
 * wrong with what a colleague committed*. The second is the one nothing else
 * can answer — a shared definition with a typo in it is otherwise simply
 * absent, and one that names a path this checkout does not have is present and
 * never fires.
 *
 * Read, never cached across projects: switching the working directory has to
 * re-read, because this is a file in a different repository.
 */

export interface SharedProblem {
  /** A path into the file, as a person would point at it. */
  at: string
  message: string
}

export interface SharedProjectConfig {
  checks?: { command: string }
  sandbox?: { enabled?: boolean; allowedDomains?: string[] }
  rituals?: { key: string; title: string; input: string }[]
}

export interface SharedProjectState {
  dir: string | null
  exists: boolean
  /** Relative, because that is how somebody refers to it in a repository. */
  file: string
  path?: string
  config: SharedProjectConfig
  problems: SharedProblem[]
}

export function useSharedProject() {
  const state = useState<SharedProjectState | null>('shared-project', () => null)
  const saving = useState('shared-project-saving', () => false)
  const error = useState<string | null>('shared-project-error', () => null)

  async function load(dir?: string) {
    try {
      state.value = await $fetch<SharedProjectState>('/api/project/shared', {
        query: dir ? { dir } : undefined,
      })
    } catch (e) {
      error.value = errorMessage(e)
    }
  }

  /**
   * Put this machine's answer in the repository's file, or take it out.
   *
   * Nothing is committed and nothing changes what is in force — the machine
   * keeps overriding the repository — so this is safe to press and visible in
   * the diff afterwards, which is the whole intent.
   */
  async function share(what: 'checks' | 'sandbox', stop = false) {
    saving.value = true
    error.value = null
    try {
      await $fetch('/api/project/shared', { method: 'POST', body: { what, stop } })
      await load(state.value?.dir ?? undefined)
      return true
    } catch (e) {
      error.value = errorMessage(e)
      return false
    } finally {
      saving.value = false
    }
  }

  const sharesChecks = computed(() => Boolean(state.value?.config.checks))
  const sharesSandbox = computed(() => Boolean(state.value?.config.sandbox))

  return { state, saving, error, load, share, sharesChecks, sharesSandbox }
}
