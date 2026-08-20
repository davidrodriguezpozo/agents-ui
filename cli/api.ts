import type { WallSnapshot } from '~/utils/wall'
import type { StudioClient } from './client'
import type {
  Attention,
  InboxSource,
  ProjectState,
  PullsReading,
  RitualHistory,
  RunSummary,
  Schedule,
  Session,
  SessionDetail,
  SessionDiff,
} from './types'

/**
 * The endpoints the terminal app actually calls.
 *
 * A thin list so a view never has to remember a path. Each method is one
 * request the browser already makes; nothing here adds behaviour.
 */
export function createApi(client: StudioClient) {
  return {
    client,

    sessions: (signal?: AbortSignal) =>
      client.request<Session[]>('/api/sessions', { signal }),

    session: (id: string, signal?: AbortSignal) =>
      client.request<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`, { signal }),

    startSession: (body: { prompt: string; repoDir?: string }) =>
      client.request<{ id: string; runId?: string; startError?: string }>('/api/sessions', {
        method: 'POST',
        body,
      }),

    send: (id: string, input: string) =>
      client.request<{ runId: string; sessionId: string }>(
        `/api/sessions/${encodeURIComponent(id)}/message`,
        { method: 'POST', body: { input } },
      ),

    runChecks: (id: string) =>
      client.request<{ check: SessionDetail['check'] }>(
        `/api/sessions/${encodeURIComponent(id)}/check`,
        { method: 'POST', timeoutMs: 10 * 60_000 },
      ),

    diff: (id: string, signal?: AbortSignal) =>
      client.request<SessionDiff>(`/api/sessions/${encodeURIComponent(id)}/diff`, { signal }),

    closeSession: (id: string) =>
      client.request<{ closed: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),

    previewPr: (id: string) =>
      client.request<{
        canOpen: boolean
        blockedReason?: string
        suggestedTitle: string
        suggestedBody: string
        existingUrl?: string
      }>(`/api/sessions/${encodeURIComponent(id)}/pr`),

    openPr: (id: string, body: { title: string; body?: string; commitFirst?: boolean; draft?: boolean }) =>
      client.request<{ url: string }>(`/api/sessions/${encodeURIComponent(id)}/pr`, {
        method: 'POST',
        body,
      }),

    mergeSession: (id: string, body: { commitFirst?: boolean; override?: boolean } = {}) =>
      client.request<{ merged?: boolean }>(`/api/sessions/${encodeURIComponent(id)}/merge`, {
        method: 'POST',
        body,
      }),

    cancelRun: (id: string) =>
      client.request(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),

    answerPermission: (id: string, behavior: 'allow' | 'deny', scope?: 'once' | 'session') =>
      client.request(`/api/permissions/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: { behavior, scope: behavior === 'allow' ? scope : undefined },
      }),

    runs: (signal?: AbortSignal) =>
      client.request<RunSummary[]>('/api/runs', { query: { limit: 80 }, signal }),

    run: (id: string, signal?: AbortSignal) =>
      client.request<{
        id: string
        input: string
        output: string
        status: string
        error?: string
        title: string
      }>(`/api/runs/${encodeURIComponent(id)}`, { signal }),

    startRun: (body: {
      input: string
      title?: string
      invocation?: string
      agentSlug?: string
      projectDir?: string
      kind?: string
    }) => client.request<{ id: string }>('/api/runs', { method: 'POST', body }),

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
