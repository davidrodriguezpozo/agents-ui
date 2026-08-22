/** Mirrors `IssueState` on the server. */
export type IssueState =
  | 'awaiting-reply' | 'has-session' | 'assigned' | 'assigned-elsewhere' | 'unassigned'

/** Mirrors `IssueIntent` on the server. Two actions, not one. */
export type IssueIntent = 'investigate' | 'implement'

/** Mirrors `IssueSource`. Which tracker a row came from, on every row. */
export type IssueSource = 'github' | 'notion'

export interface Issue {
  source: IssueSource
  /** Null on anything that is not a GitHub issue. `ref` is what a row shows. */
  number: number | null
  /** The Notion page id, for a ticket. */
  ticketId?: string
  /** For a ticket, the status value that let it into the band. */
  status?: string
  title: string
  url: string
  /** Empty when the tracker does not record it. Notion tickets have none. */
  author: string
  assignees: string[]
  labels: { name: string; color: string }[]
  createdAt: number
  updatedAt: number
  assignedToYou: boolean
  youAuthored: boolean
  /** Null means the tracker was not asked, or the last word was yours. */
  lastCommenter: string | null
  youCommented: boolean
  comments: number
  /** The session already working on it. */
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
  /** What identifies this row across both sources, and what a press sends back. */
  key: string
  /** `#42`, or the first eight characters of a Notion page id. */
  ref: string
}

/**
 * How the Notion half of the band is doing. Mirrors `NotionHalf`.
 *
 * Separate from the reading's own `ok`/`reason`, which are about `gh`. The two
 * halves fail for different reasons at different times, and a page that had one
 * sentence for both would explain the wrong thing half the time.
 */
export interface NotionHalf {
  configured: boolean
  statusValue: string
  ok: boolean
  reason?: string
  /** 0 means Notion has never been read on this machine. */
  checkedAt: number
  costUsd?: number
  durationMs?: number
  count: number
}

export interface IssuesReading {
  /** Whether GitHub could be asked. The Notion half has its own answer. */
  ok: boolean
  reason?: string
  repo: string | null
  viewer: string | null
  /** The label that was asked for. The empty state names it. */
  label: string
  /** Both sources, in one list, sorted by the one rule. */
  issues: Issue[]
  onYou: number
  readAt: number
  notion?: NotionHalf
}

/** What pressing a row gives back. */
export interface StartedOnIssue {
  id: string
  /** Which of the two actions ran, as the server settled it. */
  intent: IssueIntent
  /**
   * Whether a workspace was cut, or the one already on this row took the
   * instruction. Same URL either way; not the same news.
   */
  how: 'created' | 'continued'
  /** The turn was not started, and this is why. The session exists regardless. */
  startError?: string
}

/** What a Notion reading reports when it comes back. */
export interface NotionReadResult {
  checkedAt?: number
  costUsd?: number
  durationMs?: number
  error?: string
  count: number
}

const EMPTY: IssuesReading = {
  ok: true, repo: null, viewer: null, label: '', issues: [], onYou: 0, readAt: 0,
}

/**
 * What has been asked of you, from both trackers, shared app-wide.
 *
 * Shared for the same reason `useGithubPulls` is: the GitHub half leaves the
 * machine, and two components asking the same question independently would spend
 * somebody's rate limit twice over.
 *
 * **It has no timer of its own.** The Land page refreshes it whenever the pull
 * request reading changes — mount, project switch, the header's refresh button,
 * and the two-minute poll that was already running. One loop asks both bands, so
 * adding this did not add a second background request to a tab left open all day.
 *
 * **Reading Notion is not part of that.** It is a model run costing cents, so it
 * happens only when somebody presses `readNotion` — never on the poll, never on
 * mount. The band shows the age of what it last found instead.
 */
export function useGithubIssues() {
  const reading = useState<IssuesReading>('githubIssues', () => ({ ...EMPTY }))
  const loading = useState('githubIssuesLoading', () => false)
  /** Whether it has ever come back, so the page can tell empty from unasked. */
  const loaded = useState('githubIssuesLoaded', () => false)
  /** The row a button on it is busy with, so only that row spins. */
  const busy = useState<string | null>('githubIssuesBusy', () => null)
  /** Whether a reading of Notion is in flight. It takes tens of seconds. */
  const readingNotion = useState('notionIntakeReading', () => false)

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
   * A GitHub issue is re-read on the server, which is where the body and the
   * comments come from — this page has never held either, and the prompt is mostly
   * them. A Notion ticket comes from what the last reading stored. Pressing a row
   * twice does not make two workspaces: a session already on it takes the
   * instruction, and `how` says which happened.
   */
  async function work(key: string, intent: IssueIntent) {
    busy.value = key
    try {
      const session = await $fetch<StartedOnIssue>('/api/github/issues/work', {
        method: 'POST',
        body: { key, intent },
      })
      void refresh()
      return session
    } finally {
      busy.value = null
    }
  }

  /**
   * Go and read Notion now.
   *
   * Deliberately its own control rather than part of `refresh`: this one spends
   * money and takes long enough that the page has to say it is happening. The
   * band is refreshed afterwards so the new tickets appear without a second press.
   */
  async function readNotion() {
    readingNotion.value = true
    try {
      const result = await $fetch<NotionReadResult>('/api/notion/refresh', { method: 'POST' })
      await refresh()
      return result
    } finally {
      readingNotion.value = false
    }
  }

  return { reading, loading, loaded, busy, readingNotion, refresh, work, readNotion }
}
