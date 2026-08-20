/**
 * Types the shared utils need, without pulling the Nuxt composable in.
 *
 * `sessionBadge`, `sessionOutcome`, `workList` and `wall` import these from
 * `~/composables/useSessions`. That file is a Vue composable; typechecking it
 * as part of the terminal app would drag `$fetch` and the rest of Nuxt into
 * `tsc -p cli`. The values are the same, so a shim is enough for the
 * typechecker — esbuild strips the `import type` and never sees this file.
 *
 * Kept as a structural subset of the real `Session`, so a CLI session can be
 * passed to `buildWorkList` without a cast.
 */
export type SessionActivity = 'idle' | 'working' | 'awaiting-permission' | 'failed' | 'missing'

export type CheckStatus = 'passing' | 'failing' | 'errored' | 'running'

export interface SessionCheck {
  status: CheckStatus
  command: string
  fingerprint?: string
  exitCode: number | null
  output: string
  durationMs: number
  at: number
}

export interface WorktreeState {
  path?: string
  exists?: boolean
  branch?: string | null
  changedFiles: number
  dirty: boolean
  ahead?: number
  behind?: number
}

export interface Session {
  id: string
  title: string
  status: 'idle' | 'running' | 'archived'
  activity: SessionActivity
  check?: SessionCheck | null
  worktree?: Pick<WorktreeState, 'changedFiles' | 'dirty'> | null
  landed?: boolean
  filedAt?: number
  updatedAt: number
  summary?: { text: string }
  branch?: string
  turnCount?: number
}
