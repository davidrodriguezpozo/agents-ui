export interface ProjectEntry {
  path: string
  name: string
  addedAt: number
  lastUsedAt: number
  /** A folder this repository sits inside, kept readable from every session. */
  contextDir?: string
  /** Whether the directory is still there. A registered path can go away. */
  exists: boolean
  isRepo: boolean
  branch: string | null
  hasClaudeDir: boolean
  sessionCount: number
}

interface ProjectsResponse {
  projects: ProjectEntry[]
  activePath: string | null
  home: string
}

/** `/Users/you/code/thing` reads better as `~/code/thing` in a narrow sidebar. */
export function shortenPath(path: string, home: string): string {
  if (!path) return ''
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

/**
 * The repositories you work in, and which one you are looking at.
 *
 * The list lives on the server so it survives the browser, and so that a
 * session started from anywhere registers the repository it branched from.
 * Which one is *active* is mirrored into local storage as well, because the
 * request interceptor has to stamp `x-project-dir` on a request synchronously,
 * before any of this has had a chance to load.
 */
export function useProjects() {
  const projects = useState<ProjectEntry[]>('projects', () => [])
  const home = useState<string>('projects-home', () => '')
  const loading = useState<boolean>('projects-loading', () => false)
  const loaded = useState<boolean>('projects-loaded', () => false)

  const { workingDir, setWorkingDir } = useWorkingDir()

  const active = computed(() => projects.value.find(p => p.path === workingDir.value) ?? null)
  const others = computed(() => projects.value.filter(p => p.path !== workingDir.value))

  function apply(data: ProjectsResponse) {
    projects.value = data.projects
    home.value = data.home ?? home.value
  }

  async function refresh() {
    loading.value = true
    try {
      const data = await $fetch<ProjectsResponse>('/api/projects')
      apply(data)

      // The server's idea of the active project wins on first load — it is what
      // survived the browser being closed. After that the client leads, so a
      // switch is not undone by a refresh racing it.
      if (!loaded.value && data.activePath && data.activePath !== workingDir.value) {
        setWorkingDir(data.activePath, { persist: false })
      }
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /** Load once per page, not once per component that happens to want the list. */
  async function ensureLoaded() {
    if (loaded.value || loading.value) return
    await refresh()
  }

  /** Add a directory and switch to it — one intention, from the switcher. */
  /**
   * `contextDir` is the folder this repository sits inside, when it was picked
   * out of a larger one. Sessions keep it readable — see `Project.contextDir`.
   */
  async function addProject(path: string, options: { name?: string; contextDir?: string } = {}) {
    const result = await $fetch<{ project: ProjectEntry; activePath: string }>('/api/projects', {
      method: 'POST',
      body: { path, name: options.name, contextDir: options.contextDir },
    })
    setWorkingDir(result.project.path)
    await refresh()
    return result.project
  }

  async function activate(path: string | null) {
    setWorkingDir(path ?? '')
    await $fetch('/api/projects/active', { method: 'PUT', body: { path } })
    await refresh()
  }

  /**
   * Returns whether anything was actually removed.
   *
   * The endpoint answers 200 either way — a path it does not recognise is not
   * an error, it is just nothing to do. Swallowing that distinction is what
   * turned a decline into "I clicked Remove and nothing happened".
   */
  async function remove(path: string): Promise<boolean> {
    const result = await $fetch<{ removed: boolean; activePath: string | null }>('/api/projects/remove', {
      method: 'POST',
      body: { path },
    })
    // Removing the one you were in moves you to whatever you used most recently,
    // which the server decided — following it keeps both ends in agreement.
    if (workingDir.value === path) setWorkingDir(result.activePath ?? '', { persist: false })
    await refresh()
    return result.removed
  }

  async function rename(path: string, name: string) {
    await $fetch('/api/projects/rename', { method: 'POST', body: { path, name } })
    await refresh()
  }

  /** What to call a repository path in a list, whether registered or not. */
  function nameFor(path: string | null | undefined): string {
    if (!path) return 'No project'
    const known = projects.value.find(p => p.path === path)
    return known?.name ?? path.split('/').filter(Boolean).pop() ?? path
  }

  function display(path: string | null | undefined): string {
    return path ? shortenPath(path, home.value) : ''
  }

  return {
    projects,
    home,
    loading,
    loaded,
    active,
    others,
    refresh,
    ensureLoaded,
    addProject,
    activate,
    remove,
    rename,
    nameFor,
    display,
  }
}
