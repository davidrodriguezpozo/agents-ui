export interface BuildStatus {
  mode: 'deployed' | 'source'
  sha?: string
  subject?: string
  deployedAt?: number
  repoDir?: string
  behind: number
  stale: boolean
  unknownCommit?: boolean
  summary: string
}

/**
 * Whether the app you are looking at is the app you last built.
 *
 * Only interesting when it is not: running from source, or running the current
 * build, both warrant silence.
 */
export function useBuildStatus() {
  const build = useState<BuildStatus | null>('build-status', () => null)

  async function load() {
    try {
      build.value = await $fetch<BuildStatus>('/api/system/build')
    } catch {
      build.value = null
    }
  }

  const isStale = computed(() => Boolean(build.value?.stale))

  return { build, isStale, load }
}
