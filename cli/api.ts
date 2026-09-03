import type { WallSnapshot } from '~/utils/wall'
import type { StudioClient } from './client'
import type {
  Attention,
  InboxSource,
  MergePreview,
  PrPreview,
  ProjectState,
  PullsReading,
  QueuedMessage,
  RitualHistory,
  RunDetail,
  RunQuery,
  RunSummary,
  Schedule,
  Session,
  SessionDetail,
  SessionDiff,
  TranscriptSummary,
  TrustLevel,
  UpdateBaseResult,
} from './types'

/**
 * The endpoints the terminal app actually calls.
 *
 * A thin list so a view never has to remember a path. Each method is one
 * request the browser already makes; nothing here adds behaviour.
 */
export function createApi(client: StudioClient) {
  const at = (id: string) => `/api/sessions/${encodeURIComponent(id)}`

  return {
    client,

    sessions: (signal?: AbortSignal) =>
      client.request<Session[]>('/api/sessions', { signal }),

    session: (id: string, signal?: AbortSignal) =>
      client.request<SessionDetail>(at(id), { signal }),

    startSession: (body: { prompt: string; repoDir?: string }) =>
      client.request<{ id: string; runId?: string; startError?: string }>('/api/sessions', {
        method: 'POST',
        body,
      }),

    /**
     * Say something to a session. A session already working keeps it and sends
     * it when the turn ends, which is why `runId` is optional: what comes back
     * is either the turn that started or the message now waiting.
     */
    send: (id: string, input: string) =>
      client.request<{ runId?: string; queued?: QueuedMessage; sessionId: string }>(`${at(id)}/message`, {
        method: 'POST',
        body: { input },
      }),

    runChecks: (id: string) =>
      client.request<{ check: SessionDetail['check'] }>(`${at(id)}/check`, {
        method: 'POST',
        timeoutMs: 10 * 60_000,
      }),

    /**
     * Have the session fix its own failing checks — the browser's move once the
     * verdict is red, and the state the Fleet tile already knows how to draw.
     */
    repair: (id: string) =>
      client.request<{ runId: string; sessionId: string }>(`${at(id)}/repair`, { method: 'POST' }),

    /** Bring the base branch in and find out whether the work still holds. */
    updateFromBase: (id: string) =>
      client.request<UpdateBaseResult>(`${at(id)}/update-base`, {
        method: 'POST',
        // It merges and then runs the project's own checks, which is a build.
        timeoutMs: 10 * 60_000,
      }),

    /** How much this session may do without asking. Takes effect mid-run. */
    setTrust: (id: string, trust: TrustLevel) =>
      client.request<Session>(`${at(id)}/trust`, { method: 'POST', body: { trust } }),

    diff: (id: string, signal?: AbortSignal) =>
      client.request<SessionDiff>(`${at(id)}/diff`, { signal }),

    closeSession: (id: string, opts: { force?: boolean; keepBranch?: boolean } = {}) =>
      client.request<{ closed: boolean }>(at(id), {
        method: 'DELETE',
        query: {
          force: opts.force ? 1 : undefined,
          keepBranch: opts.keepBranch ? 1 : undefined,
        },
      }),

    previewPr: (id: string) => client.request<PrPreview>(`${at(id)}/pr`),

    openPr: (id: string, body: { title: string; body?: string; commitFirst?: boolean; draft?: boolean }) =>
      client.request<{ url: string }>(`${at(id)}/pr`, { method: 'POST', body }),

    /** What a merge would do, before it does it. */
    previewMerge: (id: string) => client.request<MergePreview>(`${at(id)}/merge`),

    mergeSession: (id: string, body: { commitFirst?: boolean; override?: boolean } = {}) =>
      client.request<{ merged?: boolean }>(`${at(id)}/merge`, { method: 'POST', body }),

    cancelRun: (id: string) =>
      client.request(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),

    /**
     * Answer a prompt. A denial can carry a reason, and usually should — "no,
     * use bun" is an instruction, where a bare no is a wall the agent has to
     * guess its way around.
     */
    answerPermission: (
      id: string,
      behavior: 'allow' | 'deny',
      opts: { scope?: 'once' | 'session'; message?: string; answers?: Record<string, string[]> } = {},
    ) =>
      client.request(`/api/permissions/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: {
          behavior,
          scope: behavior === 'allow' ? (opts.scope ?? 'once') : undefined,
          message: behavior === 'deny' ? opts.message : undefined,
          // Answers to a question, which is allowed rather than approved: the
          // agent reads them out of the tool input it was handed back. Nothing
          // in them means anything for an ordinary permission.
          answers: behavior === 'allow' ? opts.answers : undefined,
        },
      }),

    runs: (query: RunQuery = {}, signal?: AbortSignal) =>
      client.request<RunSummary[]>('/api/runs', {
        query: { limit: query.limit ?? 80, q: query.q, source: query.source, outcome: query.outcome },
        signal,
      }),

    run: (id: string, signal?: AbortSignal) =>
      client.request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`, { signal }),

    startRun: (body: {
      input: string
      title?: string
      invocation?: string
      agentSlug?: string
      projectDir?: string
      kind?: string
    }) => client.request<{ id: string }>('/api/runs', { method: 'POST', body }),

    /** Conversations held in a terminal that could be continued in a worktree. */
    transcripts: (signal?: AbortSignal) =>
      client.request<{ dir: string | null; transcripts: TranscriptSummary[] }>(
        '/api/transcripts',
        { signal },
      ),

    adoptTranscript: (sdkSessionId: string) =>
      client.request<Session>('/api/transcripts/adopt', {
        method: 'POST',
        body: { sdkSessionId },
      }),

    schedules: (signal?: AbortSignal) =>
      client.request<Schedule[]>('/api/schedules', { signal }),

    scheduleHistory: (signal?: AbortSignal) =>
      client.request<Record<string, RitualHistory>>('/api/schedules/history', { signal }),

    saveSchedule: (schedule: Partial<Schedule> & { title: string; input: string }) =>
      client.request<Schedule>('/api/schedules', { method: 'POST', body: schedule }),

    pulls: (signal?: AbortSignal) =>
      client.request<PullsReading>('/api/github/pulls', { signal, timeoutMs: 60_000 }),

    workOnPull: (number: number) =>
      client.request<{ id: string; startError?: string; how?: string }>('/api/github/pulls/work', {
        method: 'POST',
        body: { number },
      }),

    mergePull: (number: number) =>
      client.request<{ merged: boolean }>('/api/github/pulls/merge', {
        method: 'POST',
        body: { number },
      }),

    inbox: (signal?: AbortSignal) =>
      client.request<{ sources: InboxSource[] }>('/api/inbox', { signal }),

    refreshInbox: (source: string) =>
      client.request('/api/inbox/refresh', {
        method: 'POST',
        body: { source },
        timeoutMs: 3 * 60_000,
      }),

    dismissInbox: (source: string, id: string) =>
      client.request('/api/inbox/dismiss', { method: 'POST', body: { source, id } }),

    projects: (signal?: AbortSignal) =>
      client.request<ProjectState>('/api/projects', { signal }),

    setActiveProject: (path: string | null) =>
      client.request<{ activePath: string | null }>('/api/projects/active', {
        method: 'PUT',
        body: { path },
      }),

    wall: (signal?: AbortSignal) =>
      client.request<WallSnapshot>('/api/wall', { signal }),

    attention: (signal?: AbortSignal) =>
      client.request<Attention>('/api/attention', { signal }),
  }
}

export type Api = ReturnType<typeof createApi>
