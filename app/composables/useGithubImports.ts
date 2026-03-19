import type { GithubImport, GithubImportsRegistry, ScanResult } from '~/types'

export function useGithubImports() {
  const imports = useState<GithubImport[]>('githubImports', () => [])
  const loading = useState('githubImportsLoading', () => false)
  const scanning = useState('githubImportsScanning', () => false)
  const updatesAvailable = useState('githubImportsUpdates', () => 0)

  async function fetchImports() {
    loading.value = true
    try {
      const data = await $fetch<GithubImportsRegistry>('/api/github/imports')
      imports.value = data.imports
    } catch (e) {
      console.error('Failed to fetch GitHub imports:', e)
    } finally {
      loading.value = false
    }
  }

  async function scan(url: string): Promise<ScanResult> {
    scanning.value = true
    try {
      return await $fetch<ScanResult>('/api/github/scan', {
        method: 'POST',
        body: { url },
      })
    } finally {
      scanning.value = false
    }
  }

  async function importRepo(params: {
    owner: string
    repo: string
    url: string
    targetPath: string
    selectedSkills: string[]
  }): Promise<GithubImport> {
    const entry = await $fetch<GithubImport>('/api/github/import', {
      method: 'POST',
      body: params,
    })
    imports.value.push(entry)
    return entry
  }

  async function checkUpdates() {
    try {
      const data = await $fetch<{ imports: GithubImport[]; updatesAvailable: number }>(
        '/api/github/check-updates',
        { method: 'POST' },
      )
      imports.value = data.imports
      updatesAvailable.value = data.updatesAvailable
    } catch {
      // Silently fail — cached state is fine
    }
  }

  async function updateImport(owner: string, repo: string): Promise<{ changedFiles: string[] }> {
    const data = await $fetch<{ entry: GithubImport; changedFiles: string[] }>(
      '/api/github/update',
      { method: 'POST', body: { owner, repo } },
    )
    const idx = imports.value.findIndex(i => i.owner === owner && i.repo === repo)
    if (idx !== -1) imports.value[idx] = data.entry
    updatesAvailable.value = imports.value.filter(i => i.currentSha !== i.remoteSha).length
    return { changedFiles: data.changedFiles }
  }

  async function getAvailableSkills(owner: string, repo: string) {
    const data = await $fetch<{
      entry: GithubImport
      availableSkills: { slug: string; name: string; description: string; selected: boolean }[]
    }>('/api/github/edit-selection', {
      method: 'POST',
      body: { owner, repo },
    })
    return data.availableSkills
  }

  async function updateSelectedSkills(owner: string, repo: string, selectedSkills: string[]) {
    const data = await $fetch<{ entry: GithubImport }>('/api/github/edit-selection', {
      method: 'POST',
      body: { owner, repo, selectedSkills },
    })
    const idx = imports.value.findIndex(i => i.owner === owner && i.repo === repo)
    if (idx !== -1) imports.value[idx] = data.entry
    return data.entry
  }

  async function removeImport(owner: string, repo: string) {
    await $fetch('/api/github/remove', {
      method: 'POST',
      body: { owner, repo },
    })
    imports.value = imports.value.filter(i => !(i.owner === owner && i.repo === repo))
    updatesAvailable.value = imports.value.filter(i => i.currentSha !== i.remoteSha).length
  }

  return {
    imports,
    loading,
    scanning,
    updatesAvailable,
    fetchImports,
    scan,
    importRepo,
    checkUpdates,
    updateImport,
    removeImport,
    getAvailableSkills,
    updateSelectedSkills,
  }
}
