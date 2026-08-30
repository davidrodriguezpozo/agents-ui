/** Mirrors `PullState` on the server. */
export type PullState =
  | 'draft' | 'conflicted' | 'changes-requested' | 'unanswered'
  | 'checks-failing' | 'checks-running' | 'ready' | 'awaiting-review'

export type WorkIntent = 'review' | 'address' | 'fix' | 'update'

export interface Reviewer {
  name: string
  team: boolean
}

export interface Pull {
  number: number
  title: string
  url: string
  author: string
  mine: boolean
  draft: boolean
  headBranch: string
  baseBranch: string
  headSha: string
  createdAt: number
  updatedAt: number
  additions: number
  deletions: number
  changedFiles: number
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'NONE'
  mergeable: string
  checks: 'pending' | 'passing' | 'failing' | 'none'
  failing: { name: string; url: string }[]
  awaiting: Reviewer[]
  labels: { name: string; color: string }[]
  /** Null means GitHub could not be asked, which is not the same as none. */
  unresolved: number | null
  approvals: number | null
  changesRequested: number | null
  /**
   * Worked out on the server and drawn here as given. Deciding it a second time
   * in the page is how two numbers on one screen start disagreeing.
   */
  verdict: {
    state: PullState
    label: string
    detail: string
    /** Whether this does not move until you do something. */
    onYou: boolean
  }
  /** What the row's button does, or null when it has none. */
  intent: WorkIntent | null
}

export interface PullsSummary {
  onYou: number
  toReview: number
  toMerge: number
  waiting: number
}

export interface PullsReading {
  ok: boolean
  reason?: string
  repo: string | null
  viewer: string | null
  reviewing: Pull[]
  mine: Pull[]
  summary: PullsSummary
  readAt: number
}

/** What pressing a row gives back. */
export interface StartedOnPull {
  id: string
  /** The turn was not started, and this is why. The session exists regardless. */
  startError?: string
  /**
   * Whether a workspace was made, or one that already had this branch was
   * continued or taken over. Same session either way as far as the URL is
   * concerned; not the same news.
   */
  how?: 'created' | 'continued' | 'adopted'
  /** Something the server did on the way in, worth repeating once. */
  note?: string
}

/**
 * What "Review all" gives back.
 *
 * The batch shape — some started, some did not, and the whole press is legible
 * either way. Three pull requests reviewed and one that would not check out is
 * the ordinary outcome and it is not an error; a page that only knew how to draw
 * "it worked" or "it threw" would have to pick one of those and be wrong.
 */
export interface ReviewAllResult {
  started: StartedOnPull[]
  /** Never made it as far as a workspace, and why. */
  failed: { number: number; reason: string }[]
}

const EMPTY: PullsReading = {
  ok: true, repo: null, viewer: null, reviewing: [], mine: [],
  summary: { onYou: 0, toReview: 0, toMerge: 0, waiting: 0 },
  readAt: 0,
}

/**
 * The pull requests with your name on them, shared app-wide.
 *
 * Shared rather than owned by the page because the sidebar needs the count as
 * well, and two components asking GitHub the same question independently would
 * double a request that is not free — this one leaves the machine, and on a
 * repository with thirty open pull requests it is the better part of a second.
 *
 * Refreshed far more slowly than `useAttention`, and deliberately. That polls a
 * local file every eight seconds; this asks github.com. A review request that
 * arrives while you are looking at something else can wait two minutes, and a
 * background tab hammering somebody's rate limit for a badge is not a trade
 * this app should be making on your behalf.
 */
export function useGithubPulls() {
  const reading = useState<PullsReading>('githubPulls', () => ({ ...EMPTY }))
  const loading = useState('githubPullsLoading', () => false)
  /** Whether it has ever come back, so the page can tell empty from unasked. */
  const loaded = useState('githubPullsLoaded', () => false)
  const poll = useState<ReturnType<typeof setInterval> | null>('githubPullsPoll', () => null)
  /** The pull request a button on it is busy with, so only that row spins. */
  const busy = useState<number | null>('githubPullsBusy', () => null)
  /**
   * Whether the whole band is being started, which no single row can say.
   *
   * Its own flag rather than `busy`, which holds one number: cutting several
   * worktrees takes seconds each, and a control that looks pressable throughout
   * is one that gets pressed twice.
   */
  const startingAll = useState('githubPullsStartingAll', () => false)

  async function refresh() {
    loading.value = true
    try {
      reading.value = await $fetch<PullsReading>('/api/github/pulls')
      loaded.value = true
    } catch (e: any) {
      reading.value = {
        ...EMPTY,
        ok: false,
        reason: e?.data?.data?.message ?? e?.data?.message ?? 'Could not read pull requests.',
        readAt: Date.now(),
      }
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  function watchContinuously(everyMs = 120_000) {
    if (poll.value) return
    void refresh()
    poll.value = setInterval(refresh, everyMs)
  }

  function stopWatching() {
    if (!poll.value) return
    clearInterval(poll.value)
    poll.value = null
  }

  /**
   * Start a session on one, already working.
   *
   * The intent is left to the server when it is not given: it re-reads the pull
   * request anyway, and the row's suggestion should come from the same reading
   * the prompt is built from rather than from whatever this page loaded with.
   *
   * Pressing a row twice does not make two workspaces. A review is a detached
   * checkout and can happen any number of times; the intents that change the
   * branch land in the workspace that already has it, and `how` says which of
   * those happened so the page can tell you rather than imply a fresh start.
   */
  async function work(number: number, intent?: WorkIntent) {
    busy.value = number
    try {
      const session = await $fetch<StartedOnPull>('/api/github/pulls/work', {
        method: 'POST',
        body: { number, intent },
      })
      void refresh()
      return session
    } finally {
      busy.value = null
    }
  }

  /**
   * Start a review on every one of them, in one request.
   *
   * One request rather than a loop of `work` calls, because the cap and the
   * budget are questions about the press and not about each pull request: five
   * sessions started and the sixth refused for spend is the outcome worth not
   * having. The server does them one at a time regardless — concurrent
   * `git worktree add` against one repository contends on the index lock.
   */
  async function reviewAll(numbers: number[]) {
    startingAll.value = true
    try {
      const result = await $fetch<ReviewAllResult>('/api/github/pulls/review-all', {
        method: 'POST',
        body: { numbers },
      })
      void refresh()
      return result
    } finally {
      startingAll.value = false
    }
  }

  async function merge(number: number) {
    busy.value = number
    try {
      const result = await $fetch<{ merged: boolean; number: number }>('/api/github/pulls/merge', {
        method: 'POST',
        body: { number },
      })
      await refresh()
      return result
    } finally {
      busy.value = null
    }
  }

  const summary = computed(() => reading.value.summary)
  const all = computed(() => [...reading.value.reviewing, ...reading.value.mine])

  return {
    reading, summary, all, loading, loaded, busy, startingAll,
    refresh, watchContinuously, stopWatching, work, reviewAll, merge,
  }
}
