/**
 * The shapes the terminal app reads off the API.
 *
 * Deliberately narrower than the browser's own types in `app/composables`.
 * Those are written against Nuxt — they pull in `~/types`, which pulls in the
 * component layer — and a terminal client that imported them would drag half
 * the front end into its bundle to read six fields. What is here is only what a
 * pane actually renders, and it is structurally a subset, so the endpoints stay
 * the single source of truth.
 */

export type SessionActivity = 'idle' | 'working' | 'awaiting-permission' | 'failed' | 'missing'
export type CheckStatus = 'passing' | 'failing' | 'errored' | 'running'
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TrustLevel = 'readonly' | 'edits' | 'full'

/**
 * A question the agent asked, and the choices it offered.
 *
 * Declared here rather than imported for the reason the header gives: the
 * browser's copy lives in `~/types` and is structurally the same, so a prompt
 * off the wall endpoint satisfies this without either side importing the other.
 */
export interface QuestionOption {
  label: string
  description: string
  preview?: string
}

export interface QuestionPrompt {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

export interface WorktreeState {
  path: string
  exists: boolean
  branch: string | null
  changedFiles: number
  dirty: boolean
  ahead: number
  behind: number
}

export interface SessionCheck {
  status: CheckStatus
  command: string
  fingerprint?: string
  exitCode: number | null
  output: string
  durationMs: number
  at: number
}

export interface Session {
  id: string
  title: string
  repoDir: string
  worktreePath: string
  branch: string
  baseBranch: string
  status: 'idle' | 'running' | 'archived'
  runIds: string[]
  createdAt: number
  updatedAt: number
  /** Which agent its turns run through. Absent means Claude Code. */
  provider?: string
  trust?: TrustLevel
  prUrl?: string
  check?: SessionCheck
  checkStale?: boolean
  landed?: boolean
  filedAt?: number
  driftedTo?: string | null
  worktree: WorktreeState
  activity: SessionActivity
  pendingPermissions: number
  lastRunId: string | null
  turnCount: number
  inCurrentProject: boolean
  /** One sentence about what it did, when the server has written one. */
  summary?: { text: string }
  /**
   * What was typed while a turn was running, waiting its turn. Empty or absent
   * in the ordinary case — see `server/utils/sessionQueue.ts`.
   */
  queued?: QueuedMessage[]
}

/** Something said to a working session, held until the turn ends. */
export interface QueuedMessage {
  id: string
  text: string
  at: number
}

export interface SessionTurn {
  id: string
  input: string
  output: string
  status: string
  createdAt: number
  completedAt?: number
  costUsd?: number
  error?: string
  toolCalls?: ToolCall[]
}

export interface SessionDetail extends Session {
  turns: SessionTurn[]
  checkCommand: string | null
}

export interface ToolCall {
  id: string
  toolName: string
  input?: unknown
  result?: string
  isError?: boolean
}

export interface PermissionRequest {
  id: string
  ownerId: string
  toolName: string
  input: Record<string, unknown>
  decisionReason?: string
  blockedPath?: string
  canRemember: boolean
  suggestedRules: string[]
  /** Set when the agent asked a question rather than to use a tool. */
  questions?: QuestionPrompt[]
  createdAt: number
}

export interface RunStats {
  costUsd?: number
  durationMs?: number
  numTurns?: number
}

export interface RunSummary {
  id: string
  kind: string
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
  hiddenAt?: number
  sessionId?: string
  /** Which agent took the turn. Absent means Claude Code. */
  provider?: string
  source: string
}

export interface AttentionItem {
  kind: 'blocked-session' | 'failing-ritual'
  id: string
  title: string
  because: string
  at?: number
}

export interface Attention {
  blocked: number
  working: number
  failingRituals: number
  needsYou: number
  items: AttentionItem[]
}

export interface Schedule {
  id: string
  title: string
  input: string
  invocation?: string
  agentSlug?: string
  projectDir?: string
  enabled: boolean
  origin: 'user' | 'team'
  permission: TrustLevel
  /** Written by the server, so every client says the recurrence the same way. */
  description: string
  createdAt: number
  lastRunAt?: number
  lastRunId?: string
  nextRunAt?: number
  missedAt?: number
  /** Set only when the scheduler turned it off itself, which is not the same
   * as somebody switching it off. */
  pausedReason?: string
}

export interface RitualHistory {
  runs: { id: string; at: number; outcome: string; costUsd?: number; error?: string }[]
  failingStreak: number
  lastOkAt?: number
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
  createdAt: number
  updatedAt: number
  additions: number
  deletions: number
  changedFiles: number
  checks: 'pending' | 'passing' | 'failing' | 'none'
  /** Decided on the server, so two clients cannot disagree about a pull request. */
  verdict: { state: string; label: string; detail: string; onYou: boolean }
  intent: 'review' | 'address' | 'fix' | 'update' | null
}

export interface PullsReading {
  ok: boolean
  reason?: string
  repo: string | null
  viewer: string | null
  reviewing: Pull[]
  mine: Pull[]
  summary: { onYou: number; toReview: number; toMerge: number; waiting: number }
  readAt: number
}

export interface InboxItem {
  id: string
  title: string
  url: string
  why: string
}

export interface InboxSource {
  key: string
  label: string
  requires: string[]
  items: InboxItem[]
  checkedAt?: number
  costUsd?: number
  error?: string
}

export interface Project {
  id?: string
  name?: string
  path: string
  exists: boolean
  isRepo: boolean
  branch: string | null
  hasClaudeDir: boolean
  sessionCount: number
}

export interface ProjectState {
  projects: Project[]
  activePath: string | null
  home: string
}

export interface DiffFile {
  path: string
  added: number
  removed: number
  staged: boolean
}

export interface SessionDiff {
  files: DiffFile[]
  patch: string
}

/** One of the server's notifications, as `/api/notifications/stream` writes it. */
export interface StudioNotification {
  id: string
  kind: 'needsYou' | 'failed' | 'finished'
  title: string
  body: string
  /** A path within the app, for `o`. */
  link: string
  at: number
}

/** What a merge would do, asked before anything is written. */
export interface MergePreview {
  canMerge: boolean
  blockedReason?: string
  targetBranch: string
  currentBranch: string
  repoClean: boolean
  commits: number
  uncommittedFiles: string[]
  conflicts: string[]
  check?: SessionCheck | null
  checkStale?: boolean
  /** The only thing in the way is the checks — a judgement, so overridable. */
  blockedByChecks?: boolean
}

/** A conversation held in a terminal that could be continued in a worktree. */
export interface TranscriptSummary {
  sdkSessionId: string
  title: string
  turnCount: number
  updatedAt: number
}

/** What catching up with the base branch did, and whether it still works. */
export interface UpdateBaseResult {
  status: 'updated' | 'up-to-date' | 'conflicted' | 'refused'
  message?: string
  check?: SessionCheck | null
}

/** Whether a pull request can be opened from here, and what it would say. */
export interface PrPreview {
  canOpen: boolean
  blockedReason?: string
  suggestedTitle: string
  suggestedBody: string
  existingUrl?: string
}

/** A detached run, as the run view reads it. */
export interface RunDetail {
  id: string
  input: string
  output: string
  status: RunStatus
  error?: string
  title: string
  costUsd?: number
  durationMs?: number
}

/** What `/api/runs` accepts, so a filter can be answered by the server. */
export interface RunQuery {
  limit?: number
  q?: string
  source?: string
  outcome?: string
  hidden?: 'exclude' | 'only'
}
