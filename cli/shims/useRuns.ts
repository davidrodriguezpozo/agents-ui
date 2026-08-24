/**
 * Types `workList` needs, without pulling the Nuxt composable in.
 *
 * Same reasoning as `useSessions.ts` in this folder: the Vue file would drag
 * Nuxt into `tsc -p cli`. A structural subset is enough for `fromRun`.
 */
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface RunSummary {
  id: string
  hiddenAt?: number
  title: string
  invocation?: string
  status: RunStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  durationMs?: number
  costUsd?: number
  preview: string
  error?: string
  needsAttention?: boolean
  deniedTools?: string[]
  stoppedBy?: 'budget' | 'turns'
  /** Which agent took the turn. Absent means Claude Code. */
  provider?: string
  source: string
}
