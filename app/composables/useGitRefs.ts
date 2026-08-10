export interface BranchRef {
  name: string
  updatedAt: number
  subject: string
  /** Only on a remote so far — checking it out is what creates it here. */
  remoteOnly: boolean
  current: boolean
}

export interface PullRequestRef {
  number: number
  title: string
  url: string
  headBranch: string
  draft: boolean
}

interface RefsResponse {
  branches: BranchRef[]
  pullRequests: PullRequestRef[]
  /** False when GitHub could not be asked, as opposed to having nothing. */
  pullRequestsAsked: boolean
}

/**
 * The branches and pull requests a picker can offer.
 *
 * Cached per repository and per whether pull requests were wanted, because a
 * dialog that opens and closes three times should ask git once. Deliberately
 * module-level rather than per-component: two pickers open on the same
 * repository are the normal case, not a reason to ask twice.
 *
 * Nothing here invalidates on a timer. A branch created while a dialog is open
 * is rare, the field still takes free text, and `refresh` exists for the case
 * where somebody knows the list is stale.
 */
const cache = new Map<string, Promise<RefsResponse>>()

const EMPTY: RefsResponse = { branches: [], pullRequests: [], pullRequestsAsked: false }

export function useGitRefs() {
  const refs = ref<RefsResponse>(EMPTY)
  const loading = ref(false)

  function keyFor(repoDir: string | null | undefined, pulls: boolean) {
    return `${pulls ? 'pr' : 'br'}:${repoDir ?? ''}`
  }

  async function load(repoDir: string | null | undefined, options: { pulls?: boolean } = {}) {
    const pulls = options.pulls !== false
    const key = keyFor(repoDir, pulls)

    if (!cache.has(key)) {
      cache.set(key, $fetch<RefsResponse>('/api/refs', {
        query: {
          ...(repoDir ? { repoDir } : {}),
          ...(pulls ? {} : { pulls: '0' }),
        },
      // A picker that cannot list is a plain text box, which is what it was
      // before. Never a reason to fail the dialog around it.
      }).catch(() => EMPTY))
    }

    loading.value = true
    try {
      refs.value = await cache.get(key)!
    } finally {
      loading.value = false
    }
  }

  /** Forget what was cached for this repository, then ask again. */
  async function refresh(repoDir: string | null | undefined, options: { pulls?: boolean } = {}) {
    cache.delete(keyFor(repoDir, options.pulls !== false))
    await load(repoDir, options)
  }

  return { refs, loading, load, refresh }
}
