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
  /**
   * That its landed work has since been taken back out.
   *
   * Only whether there is one is read by the shared utils — `workList` says so
   * on the row and `sessionBadge` ranks it above `landed` — so the shim carries
   * the presence and enough of the record to be recognisable, not all of it.
   */
  reverted?: { at: number; sha: string; branch: string }
  filedAt?: number
  /**
   * The pull request this session was opened to read, and the commit it read.
   *
   * Carried for the same reason `reverted` is: `workList` reads it to say what
   * has happened to that pull request since — see `prNews` below, which is the
   * other half of that comparison.
   */
  reviewOf?: { number: number; headSha: string }
  /** What GitHub says about that pull request now. */
  prNews?: { at: number; number: number; state: 'OPEN' | 'CLOSED' | 'MERGED'; headSha: string }
  /**
   * How many of the prompts blocking it are questions rather than permissions.
   * `workList` reads it to say which of the two the row is waiting on.
   */
  pendingQuestions?: number
  updatedAt: number
  summary?: { text: string }
  branch?: string
  turnCount?: number
  /**
   * Which agent its turns run through. Absent means Claude Code — the shared
   * `workList` puts it on the row, and only when it is not the usual one.
   */
  provider?: string
}
