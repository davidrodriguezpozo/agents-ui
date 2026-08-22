/** Mirrors `IssueState` on the server. */
export type IssueState =
  | 'awaiting-reply' | 'has-session' | 'assigned' | 'assigned-elsewhere' | 'unassigned'

/** Mirrors `IssueIntent` on the server. Two actions, not one. */
export type IssueIntent = 'investigate' | 'implement'

export interface Issue {
  number: number
  title: string
  url: string
  author: string
  assignees: string[]
  labels: { name: string; color: string }[]
  createdAt: number
  updatedAt: number
  assignedToYou: boolean
  youAuthored: boolean
  /** Null means GitHub was not asked, or the last word was yours. */
  lastCommenter: string | null
  youCommented: boolean
  comments: number
  /** The session already working on it, matched on the branch naming the number. */
  session: { id: string; title: string } | null
  /**
   * Worked out on the server and drawn here as given. Deciding it a second time
   * in the page is how two answers on one screen start disagreeing.
   */
  verdict: {
    state: IssueState
    label: string
    detail: string
    /** Whether this does not move until you do something. */
    onYou: boolean
  }
}

export interface IssuesReading {
  ok: boolean
  reason?: string
  repo: string | null
  viewer: string | null
  /** The label that was asked for. The empty state names it. */
  label: string
  issues: Issue[]
  onYou: number
  readAt: number
}

/** What pressing a row gives back. */
export interface StartedOnIssue {
  id: string
  /** Which of the two actions ran, as the server settled it. */
  intent: IssueIntent
  /**
   * Whether a workspace was cut, or the one already on this issue took the
   * instruction. Same URL either way; not the same news.
   */
  how: 'created' | 'continued'
  /** The turn was not started, and this is why. The session exists regardless. */
  startError?: string
}

const EMPTY: IssuesReading = {
  ok: true, repo: null, viewer: null, label: '', issues: [], onYou: 0, readAt: 0,
}

/**
 * The issues that are yours to pick up, shared app-wide.
 *
 * Shared for the same reason `useGithubPulls` is: this one leaves the machine,
 * and two components asking GitHub the same question independently would spend
 * somebody's rate limit twice over.
 *
 * **It has no timer of its own.** The Land page refreshes it whenever the pull
 * request reading changes — mount, project switch, the header's refresh button,
 * and the two-minute poll that was already running. One loop asks both bands, so
 * adding the issues did not add a second background request to a tab left open
 * all day.
 */
export function useGithubIssues() {
  const reading = useState<IssuesReading>('githubIssues', () => ({ ...EMPTY }))
  const loading = useState('githubIssuesLoading', () => false)
  /** Whether it has ever come back, so the page can tell empty from unasked. */
  const loaded = useState('githubIssuesLoaded', () => false)
  /** The issue a button on it is busy with, so only that row spins. */
  const busy = useState<number | null>('githubIssuesBusy', () => null)

  async function refresh() {
    loading.value = true
    try {
      reading.value = await $fetch<IssuesReading>('/api/github/issues')
      loaded.value = true
    } catch (e: any) {
      reading.value = {
        ...EMPTY,
        ok: false,
        reason: e?.data?.data?.message ?? e?.data?.message ?? 'Could not read issues.',
        readAt: Date.now(),
      }
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /**
   * Start a session on one, already working.
   *
   * The issue is re-read on the server, which is where the body and the comments
   * come from — this page has never held either, and the prompt is mostly them.
   * Pressing a row twice does not make two workspaces: a session already on the
   * issue takes the instruction, and `how` says which happened.
   */
  async function work(number: number, intent: IssueIntent) {
    busy.value = number
    try {
      const session = await $fetch<StartedOnIssue>('/api/github/issues/work', {
        method: 'POST',
        body: { number, intent },
      })
      void refresh()
      return session
    } finally {
      busy.value = null
    }
  }

  return { reading, loading, loaded, busy, refresh, work }
}
