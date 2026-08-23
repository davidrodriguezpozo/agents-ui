import type { Overlap } from '~/utils/overlap'
import type { DiffNote } from '~/utils/patch'
import type { ChatAttachment, ChatAttachmentRef } from '~/types'

export interface WorktreeState {
  path: string
  exists: boolean
  branch: string | null
  changedFiles: number
  dirty: boolean
  ahead: number
  /**
   * Commits on the base branch this session hasn't got. Above zero means any
   * check it has passed was against a base that has since moved on — which is
   * what happens to every other session the moment you merge one.
   */
  behind: number
}

export type SessionActivity = 'idle' | 'working' | 'awaiting-permission' | 'failed' | 'missing'

export type CheckStatus = 'passing' | 'failing' | 'errored' | 'running'

/** What a session did, in a sentence, written by a small model. */
export interface SessionSummary {
  text: string
  fingerprint: string
  costUsd: number
  at: number
}

/** How the project's own checks last went in a session's workspace. */
export interface SessionCheck {
  status: CheckStatus
  command: string
  fingerprint: string
  exitCode: number | null
  output: string
  durationMs: number
  at: number
}

/** Whether a session is trying to fix its own failing checks, and how far in. */
export interface SessionRepair {
  attempts: number
  max: number
  state: 'running' | 'fixed' | 'gave-up'
  /** Why it stopped, when it stopped for a reason worth reading. */
  reason?: string
  startedAt: number
  updatedAt: number
}

/** How the pull request this session opened is being followed, if it is. */
export interface SessionPrWatch {
  state: 'watching' | 'fixing' | 'landed' | 'stopped'
  number: number
  url: string
  /** Whether it merges itself once the checks are green. */
  land: boolean
  attempts: number
  max: number
  reason?: string
  startedAt: number
  updatedAt: number
  lastPolledAt?: number
}

/**
 * That a session's landed work was taken back out of the base branch.
 *
 * Mirrors `SessionReverted` in `server/utils/revertWatch.ts`, which is the
 * authority and holds the reasoning. Worth knowing here: it is only ever set from
 * a commit that *says* it reverts the merge, so its absence is not a claim that
 * nothing was reverted — and it is cleared again if the revert is itself reverted.
 */
export interface SessionReverted {
  at: number
  sha: string
  committedAt: number
  /** Absent when git records no name, which a bot's commit often does not. */
  by?: string
  subject: string
  landedSha: string
  branch: string
}

/** Something you typed while it was working, waiting for the turn to end. */
export interface QueuedMessage {
  id: string
  text: string
  at: number
  /**
   * Images waiting with it, by name and type. The bytes are on the server —
   * they have to outlive this tab, which is the whole point of the queue.
   */
  attachments?: ChatAttachmentRef[]
}

/**
 * What came of saying something to a session: a turn started, or a message
 * waiting for the one that is still running to end.
 */
export type SendResult = { runId: string; queued?: undefined } | { queued: QueuedMessage; runId?: undefined }

/**
 * What came of steering: it reached the running turn, or the turn ended first
 * and it went the ordinary way. The page says which, because "steered" and
 * "queued" are different things to have happened to your sentence.
 */
export type SteerResult =
  | { steered: true; runId: string; queued?: undefined }
  | { runId: string; steered?: undefined; queued?: undefined }
  | { queued: QueuedMessage; runId?: undefined; steered?: undefined }

export interface Session {
  id: string
  title: string
  repoDir: string
  worktreePath: string
  branch: string
  baseBranch: string
  baseSha: string
  status: 'idle' | 'running' | 'archived'
  agentSlug?: string
  runIds: string[]
  createdAt: number
  updatedAt: number
  worktreeRemovedAt?: number
  /** Set when this continues a conversation started in the terminal. */
  adoptedAt?: number
  /**
   * Set when the workspace is a detached checkout of a commit — how a review is
   * taken. `branch` still names the pull request's head branch, because that is
   * what identifies the work, but nothing here has it checked out.
   */
  detached?: true
  /** Set when the branch predates the session, so closing will not delete it. */
  borrowedBranch?: true
  /** How much it may do without asking. Absent means `edits`. */
  trust?: TrustLevel
  /** Set once this session's branch has a pull request open. */
  prUrl?: string
  /**
   * The pull request this session was opened to *read*, and the commit it read.
   *
   * The opposite fact from `prUrl`: this session's work is somebody else's pull
   * request, held as a detached checkout. Its presence is what puts the Review
   * tab on the strip — see `ReviewPane.vue`.
   */
  reviewOf?: { number: number; headSha: string; url?: string }
  /**
   * Other sessions changing files this one changes.
   *
   * Computed on the server from paths it already had, and absent when there are
   * none — which is the usual case. The complement to `worktree.behind`: that
   * one becomes true once somebody else has merged, this one is true while it is
   * still cheap to know. See `~/utils/overlap`.
   */
  overlaps?: Overlap[]
  /** Absent means nothing is following that pull request. */
  prWatch?: SessionPrWatch
  /** Absent means the checks have never run here — not that they passed. */
  check?: SessionCheck
  /** The recorded verdict predates what is in the workspace now. */
  checkStale?: boolean
  /** What this session did, in a sentence. Absent until it has done something. */
  summary?: SessionSummary
  /** Absent means it has not tried to fix itself on this instruction. */
  repair?: SessionRepair
  /**
   * What was typed while a turn was running, oldest first.
   *
   * Held on the server — see `server/utils/sessionQueue.ts` — because the turn
   * it waits for outlasts this tab. Absent or empty means nothing is waiting.
   */
  queued?: QueuedMessage[]
  worktree: WorktreeState
  /**
   * The branch the worktree is really on, when the record does not name it.
   *
   * Null in the ordinary case, and null for a `detached` review session, whose
   * record names a branch nobody has checked out on purpose. Set means every
   * measurement on this row is about somewhere other than `branch` — see the
   * sessions index endpoint and `~/utils/checkout`.
   */
  driftedTo?: string | null
  /** Its work is in the base branch already — see the sessions index endpoint. */
  landed?: boolean
  /**
   * Set when the work that landed has since been taken back out.
   *
   * Comes through from the session record untouched, unlike `landed`, which the
   * endpoint replaces with what git says right now. Both can be true at once and
   * usually are: the branch is still contained in the base — that is what a
   * revert leaves behind — while the base no longer has the change.
   */
  reverted?: SessionReverted
  /**
   * When you said you were done with this session.
   *
   * The one signal for "finished with" that nothing infers and nothing can
   * argue with. Set means History regardless of what the workspace holds;
   * cleared by the next turn, because sending an instruction to a session is
   * the plainest possible statement that you are not done with it.
   */
  filedAt?: number
  /** What the session is doing right now — see the sessions index endpoint. */
  activity: SessionActivity
  pendingPermissions: number
  lastRunId: string | null
  turnCount: number
  /** False when the session belongs to a repo other than the selected folder. */
  inCurrentProject: boolean
}

/**
 * The pull request a session's branch has on GitHub, whoever opened it.
 *
 * Null while nothing is known — a cold cache, no `gh`, no remote — which is not
 * the same as "there is none", so the page draws nothing rather than "no pull
 * request".
 */
export interface BranchPullRequest {
  number: number
  url: string
  title: string
  /** What it merges into, which is the base that will actually be used. */
  baseBranch: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
}

export type TrustLevel = 'readonly' | 'edits' | 'full'

/**
 * What a session that never recorded a trust level runs as.
 *
 * Mirrors `DEFAULT_TRUST` in `server/utils/trust.ts`, which is the authority —
 * the server decides what a turn is actually permitted, and this exists so the
 * control on the page cannot show a different answer from the one the next turn
 * will use. The reasoning for the value is over there; if it changes, it changes
 * in both places or the page starts lying.
 */
export const DEFAULT_TRUST: TrustLevel = 'full'

/** What each level means for a session you are watching, in its own words. */
export const TRUST_CHOICES: { value: TrustLevel; label: string; hint: string }[] = [
  { value: 'readonly', label: 'Plan only', hint: 'Reads and proposes. Changes nothing at all.' },
  { value: 'edits', label: 'Edit files', hint: 'Writes files freely. Asks before anything riskier.' },
  {
    value: 'full',
    label: 'Auto',
    // Sandboxing arrived after this vocabulary was written, and "runs commands
    // too" read as unrestricted when it never was: an Auto run still reaches
    // only the hosts the project allows, and still cannot let itself out.
    hint: 'Runs commands too, and never stops to ask. Still sandboxed — it reaches only the hosts this project allows. Only in a workspace you are happy to throw away.',
  },
]

export interface TranscriptMessage {
  role: 'user' | 'assistant'
  text: string
  at?: number
}

export interface TurnToolCall {
  id: string
  toolName: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
}

/** Something said into a turn while it ran, and how far in it landed. */
export interface TurnSteer {
  text: string
  at: number
  afterSteps: number
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
  /** What the turn did, recovered from its event log. */
  toolCalls?: TurnToolCall[]
  /** What was said into it mid-turn, from the same log. */
  steers?: TurnSteer[]
  /** Images the instruction came with, by name and type — the bytes are gone. */
  attachments?: ChatAttachmentRef[]
}

/** What a worktree with no session could be restored into, and what it holds. */
export interface WorktreeRecovery {
  id: string
  title: string
  branch: string
  worktreePath: string
  sdkSessionId?: string
  turnCount: number
  /** Whether the directory is on disk. Not whether there is anything to recover. */
  exists: boolean
  /** Whether there is a conversation to bring back, which is the other question. */
  hasConversation: boolean
  /** Commits that exist nowhere else — what deleting it would cost. */
  unmergedCommits: number
}

export interface WorktreeEntry {
  path: string
  branch: string | null
  head: string | null
  prunable: boolean
  isMain: boolean
  sessionId: string | null
  sessionTitle: string | null
  orphaned: boolean
  recovery: WorktreeRecovery | null
}

export interface PullRequestPreview {
  canOpen: boolean
  blockedReason?: string
  baseBranch: string
  branch: string
  commits: { sha: string; subject: string }[]
  uncommittedFiles: string[]
  files: string[]
  remote: string | null
  existingUrl?: string
  suggestedTitle: string
  suggestedBody: string
  /**
   * The issue opening this would comment on, from `issueToTell` on the server.
   * Absent means nothing will be said — which is every session until somebody
   * turns the setting on.
   */
  tellsIssue?: { number: number; url: string }
}

/**
 * A check this project has seen pass and fail on identical code. Mirrors
 * `server/utils/checkFlakes.ts`, which is where the judgement is made.
 */
export interface Flake {
  name: string
  runs: number
  failures: number
  rate: number
  note: string
}

/**
 * A name this merge takes away that another session in flight still calls.
 * Mirrors `server/utils/collisions.ts`, which is where the judgement is made.
 */
export interface Collision {
  name: string
  path: string
  sessions: { id: string; title: string }[]
  total: number
  note: string
}

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
  /** Git has no objection; only the checks do. This one can be overruled. */
  blockedByChecks?: boolean
  /** Known flakes among this failure's own failures. Never changes the gate. */
  flakes?: Flake[]
  flakeNote?: string
  /** Names other live sessions call that this merge removes. Blocks nothing. */
  collisions?: Collision[]
  collisionNote?: string
}

/**
 * A session fresh from being started. `runId` is present when it was given
 * something to do; `startError` when the workspace was cut but the first turn
 * would not go — the session is real either way.
 */
export type StartedSession = Session & { runId?: string; startError?: string }

export interface BatchResult {
  started: StartedSession[]
  /** Never made it as far as a workspace, and why. */
  failed: { prompt: string; reason: string }[]
}

export interface DiffFile {
  path: string
  added: number
  removed: number
  staged: boolean
}

export function useSessions() {
  const sessions = useState<Session[]>('sessions', () => [])
  const loading = useState('sessionsLoading', () => false)

  async function fetchAll() {
    loading.value = true
    try {
      sessions.value = await $fetch<Session[]>('/api/sessions')
    } catch (e) {
      console.error('[useSessions] fetchAll:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * Start a session. Given a prompt it also starts working, and names itself
   * from what it was asked to do rather than making you type the intent twice.
   */
  async function create(
    prompt: string,
    agentSlug?: string,
    trust?: TrustLevel,
    attachments: ChatAttachment[] = [],
  ) {
    const session = await $fetch<StartedSession>('/api/sessions', {
      method: 'POST',
      // Chosen before it starts, so the first turn — usually the longest —
      // honours it rather than running at the default and being changed after.
      body: { prompt, agentSlug, trust, attachments },
    })
    await fetchAll()
    return session
  }

  /** One session per instruction, each on its own branch, all working at once. */
  async function createMany(prompts: string[], agentSlug?: string, trust?: TrustLevel) {
    const result = await $fetch<BatchResult>('/api/sessions/batch', {
      method: 'POST',
      body: { prompts, agentSlug, trust },
    })
    await fetchAll()
    return result
  }

  /**
   * Start on work that already exists — a pull request or a branch. The server
   * decides which from what was pasted.
   *
   * `how` says whether a workspace was made or whether one that already had
   * that branch was continued or taken over. A branch can only be checked out
   * once, so asking for one twice used to fail; now it lands you in the
   * workspace that has it, and the difference is worth saying out loud.
   */
  async function startFrom(ref: string) {
    const session = await $fetch<Session & { how?: 'created' | 'continued' | 'adopted'; note?: string }>(
      '/api/sessions/from-existing',
      { method: 'POST', body: { ref } },
    )
    await fetchAll()
    return session
  }

  async function fetchOne(id: string) {
    return $fetch<Session & {
      turns: SessionTurn[]
      checkStale: boolean
      checkCommand: string | null
      pr: BranchPullRequest | null
    }>(`/api/sessions/${encodeURIComponent(id)}`)
  }

  /**
   * Run the project's checks now. Turns that change files do this themselves,
   * so this is for a verdict that has gone stale or one you want before
   * deciding. Resolves with the answer, not with "started".
   */
  async function runCheck(id: string) {
    const result = await $fetch<{ check: SessionCheck | null }>(
      `/api/sessions/${encodeURIComponent(id)}/check`,
      { method: 'POST' },
    )
    await fetchAll()
    return result.check
  }

  /**
   * Have the session fix its own failing checks, starting now.
   *
   * Returns the run id of the first attempt. What follows is not this call's
   * business: the turn runs, the checks run, and a still-failing verdict earns
   * another attempt until they pass or the attempts are spent.
   */
  async function repair(id: string): Promise<string> {
    const result = await $fetch<{ runId: string }>(
      `/api/sessions/${encodeURIComponent(id)}/repair`,
      { method: 'POST' },
    )
    await fetchAll()
    return result.runId
  }

  /**
   * Bring the base branch into this session and re-run its checks.
   *
   * Resolves with the verdict, because that is the question being asked —
   * "is this still good now that main has moved" — and a merge with no answer
   * after it is the stale badge again under a different name.
   */
  async function updateFromBase(id: string) {
    const result = await $fetch<{ status: string; message: string; check: SessionCheck | null }>(
      `/api/sessions/${encodeURIComponent(id)}/update-base`,
      { method: 'POST' },
    )
    await fetchAll()
    return result
  }

  /**
   * Say something to a session.
   *
   * Resolves with a run id when the turn started, and with the waiting message
   * when the session was still working and kept it instead. Which of the two
   * happens is the server's call, not the caller's: the page's idea of busy is
   * as old as its last load, and deciding here is how a message typed a second
   * before a turn ended used to be refused.
   */
  async function send(id: string, input: string, attachments: ChatAttachment[] = []): Promise<SendResult> {
    return $fetch<SendResult>(`/api/sessions/${encodeURIComponent(id)}/message`, {
      method: 'POST',
      body: { input, attachments },
    })
  }

  /**
   * Say something to the turn that is running, now.
   *
   * The deliberate one. `send` queues while a session is busy, which is right
   * for the next instruction and wrong for a correction — this reaches the
   * running query, and the CLI takes it at its next tool boundary. Resolves
   * saying which of steered, sent and queued actually happened: the turn can end
   * between the press and the delivery, and the server decides, not the page.
   */
  async function steer(id: string, input: string, attachments: ChatAttachment[] = []): Promise<SteerResult> {
    return $fetch<SteerResult>(`/api/sessions/${encodeURIComponent(id)}/steer`, {
      method: 'POST',
      body: { input, attachments },
    })
  }

  /**
   * Send what is queued now, rather than waiting for a turn that is not coming.
   *
   * Only needed when a turn ended in a way that holds the queue back — stopped
   * by hand, or failed. Resolves with the run id, or null when there was
   * nothing left to send.
   */
  async function sendQueued(id: string): Promise<string | null> {
    const result = await $fetch<{ runId: string | null }>(
      `/api/sessions/${encodeURIComponent(id)}/queue`,
      { method: 'POST' },
    )
    return result.runId
  }

  /** Drop one waiting message, or all of them when given no id. */
  async function dropQueued(id: string, messageId?: string): Promise<QueuedMessage[]> {
    const result = await $fetch<{ queued: QueuedMessage[] }>(
      `/api/sessions/${encodeURIComponent(id)}/queue`,
      { method: 'DELETE', body: { messageId } },
    )
    return result.queued
  }

  /** The terminal conversation an adopted session continues. History only. */
  async function fetchTranscript(id: string) {
    const result = await $fetch<{ messages: TranscriptMessage[] }>(
      `/api/sessions/${encodeURIComponent(id)}/transcript`,
    )
    return result.messages
  }

  /**
   * File a session away, or take it back out.
   *
   * Nothing is deleted and no worktree is touched — this only answers "am I
   * still working on this", which is the question the In flight tab asks and
   * could not previously be told the answer to.
   */
  async function setAside(id: string, aside = true) {
    const updated = await $fetch<Session>(`/api/sessions/${encodeURIComponent(id)}/file`, {
      method: 'POST',
      body: { aside },
    })
    await fetchAll()
    return updated
  }

  /** Takes effect on the next turn — the SDK is told once, when a run starts. */
  async function setTrust(id: string, trust: TrustLevel) {
    return $fetch<Session>(`/api/sessions/${encodeURIComponent(id)}/trust`, {
      method: 'POST',
      body: { trust },
    })
  }

  async function fetchDiff(id: string) {
    return $fetch<{ files: DiffFile[]; patch: string }>(`/api/sessions/${encodeURIComponent(id)}/diff`)
  }

  /**
   * Notes written on the session's diff and not yet sent.
   *
   * All three resolve with the whole list, so the page never holds a copy it
   * patched itself — the notes outlive the tab, and two tabs on one session
   * appending to their own arrays is how one of them loses a note.
   */
  async function fetchNotes(id: string): Promise<DiffNote[]> {
    const result = await $fetch<{ notes: DiffNote[] }>(
      `/api/sessions/${encodeURIComponent(id)}/notes`,
    )
    return result.notes
  }

  async function addNote(
    id: string,
    note: { file: string; line: number; snippet: string; body: string },
  ): Promise<DiffNote[]> {
    const result = await $fetch<{ notes: DiffNote[] }>(
      `/api/sessions/${encodeURIComponent(id)}/notes`,
      { method: 'POST', body: note },
    )
    return result.notes
  }

  /** Drop one note, or all of them when given no id. */
  async function dropNotes(id: string, noteId?: string): Promise<DiffNote[]> {
    const result = await $fetch<{ notes: DiffNote[] }>(
      `/api/sessions/${encodeURIComponent(id)}/notes`,
      { method: 'DELETE', body: { noteId } },
    )
    return result.notes
  }

  async function previewPullRequest(id: string) {
    return $fetch<PullRequestPreview>(`/api/sessions/${encodeURIComponent(id)}/pr`)
  }

  /**
   * Pushes the branch and opens the request — visible to everyone else.
   *
   * `issue` is the second write: a session started from a GitHub issue comments
   * on it once, here and nowhere else, and only when the setting is on. It is
   * always answered — `posted: false` with the reason — so the page can say what
   * happened rather than inferring it from a missing field.
   */
  async function openPullRequest(id: string, opts: {
    title: string
    body: string
    commitFirst?: boolean
    draft?: boolean
  }) {
    const result = await $fetch<{
      url: string
      committed: boolean
      issue?:
        | { posted: true; issue: number; url: string }
        | { posted: false; reason: string; because: string }
    }>(
      `/api/sessions/${encodeURIComponent(id)}/pr`,
      { method: 'POST', body: opts },
    )
    await fetchAll()
    return result
  }

  /**
   * Follow the pull request, or stop. `land` is passed every time rather than
   * remembered, because merging is the one thing here other people see and it
   * should never be on because it was on last time.
   */
  async function watchPullRequest(id: string, opts: { watch: boolean; land?: boolean }) {
    const result = await $fetch<{ prWatch: SessionPrWatch | null }>(
      `/api/sessions/${encodeURIComponent(id)}/watch`,
      { method: 'POST', body: opts },
    )
    await fetchAll()
    return result
  }

  async function previewMerge(id: string) {
    return $fetch<MergePreview>(`/api/sessions/${encodeURIComponent(id)}/merge`)
  }

  /** `override` proceeds over a failing check, and over nothing else. */
  async function merge(
    id: string,
    opts: { message?: string; commitFirst?: boolean; override?: boolean } = {},
  ) {
    const result = await $fetch<{
      merged: boolean
      commitsBrought: number
      committedBeforeMerge: number
      overrodeChecks?: boolean
    }>(
      `/api/sessions/${encodeURIComponent(id)}/merge`,
      { method: 'POST', body: opts },
    )
    await fetchAll()
    return result
  }

  async function close(id: string, opts: { force?: boolean; keepBranch?: boolean } = {}) {
    const query = new URLSearchParams()
    if (opts.force) query.set('force', '1')
    if (opts.keepBranch) query.set('keepBranch', '1')

    const result = await $fetch<{ closed: boolean; branchKept: string | null }>(
      `/api/sessions/${encodeURIComponent(id)}?${query}`,
      { method: 'DELETE' },
    )
    await fetchAll()
    return result
  }

  const active = computed(() => sessions.value.filter(s => s.status !== 'archived'))
  const workingCount = computed(() => sessions.value.filter(s => s.activity === 'working').length)
  const needsYouCount = computed(() =>
    sessions.value.filter(s => s.activity === 'awaiting-permission').length
  )

  /** Sessions in other repositories, so they are not silently invisible. */
  const elsewhere = computed(() => sessions.value.filter(s => !s.inCurrentProject))
  const here = computed(() => sessions.value.filter(s => s.inCurrentProject))

  return {
    sessions,
    active,
    here,
    elsewhere,
    workingCount,
    needsYouCount,
    loading,
    fetchAll,
    create,
    createMany,
    startFrom,
    fetchOne,
    send,
    steer,
    sendQueued,
    dropQueued,
    fetchTranscript,
    setTrust,
    setAside,
    previewPullRequest,
    openPullRequest,
    watchPullRequest,
    fetchDiff,
    fetchNotes,
    addNote,
    dropNotes,
    previewMerge,
    merge,
    runCheck,
    repair,
    updateFromBase,
    close,
  }
}

/** What a project runs to say whether it works, and what could be inferred. */
export interface ProjectChecks {
  dir: string | null
  command: string | null
  /**
   * `repository` is the shared half — a command committed to the project's
   * `.claude/agents-studio.json` — which applies when this machine has not
   * chosen one. See `useSharedProject`.
   */
  source: 'configured' | 'repository' | 'detected' | null
  /** The file a shared command came from, or the evidence a guess came from. */
  from?: string | null
  /** Null when never chosen; empty string when deliberately turned off. */
  configured: string | null
  detected: { command: string; from: string } | null
}

export function useProjectChecks() {
  const state = useState<ProjectChecks | null>('project-checks', () => null)
  const saving = useState('project-checks-saving', () => false)

  async function load() {
    try {
      state.value = await $fetch<ProjectChecks>('/api/project/checks')
    } catch (e) {
      console.error('[useProjectChecks] load:', e)
    }
  }

  /** An empty command is a real answer: this project has nothing to run. */
  async function save(command: string) {
    saving.value = true
    try {
      await $fetch('/api/project/checks', { method: 'POST', body: { command } })
      await load()
    } finally {
      saving.value = false
    }
  }

  /** Forget the choice, so what the repository suggests applies again. */
  async function reset() {
    saving.value = true
    try {
      await $fetch('/api/project/checks', { method: 'POST', body: { reset: true } })
      await load()
    } finally {
      saving.value = false
    }
  }

  return { state, saving, load, save, reset }
}

/**
 * What makes a fresh workspace of this project runnable.
 *
 * The same shape as the check command, and for a reason: they are two halves
 * of one answer. A worktree is a bare checkout, so without this the checks run
 * somewhere that cannot run anything, and report a missing dependency as
 * broken code.
 */
export function useProjectSetup() {
  const state = useState<ProjectChecks | null>('project-setup', () => null)
  const saving = useState('project-setup-saving', () => false)

  async function load() {
    try {
      state.value = await $fetch<ProjectChecks>('/api/project/setup')
    } catch (e) {
      console.error('[useProjectSetup] load:', e)
    }
  }

  /** An empty command is a real answer: a checkout of this is ready as it is. */
  async function save(command: string) {
    saving.value = true
    try {
      await $fetch('/api/project/setup', { method: 'POST', body: { command } })
      await load()
    } finally {
      saving.value = false
    }
  }

  async function reset() {
    saving.value = true
    try {
      await $fetch('/api/project/setup', { method: 'POST', body: { reset: true } })
      await load()
    } finally {
      saving.value = false
    }
  }

  return { state, saving, load, save, reset }
}

export interface ProjectSandboxState {
  dir: string | null
  enabled: boolean | null
  allowedDomains: string[]
  /** `repository` is the shared half, which applies when this machine is quiet. */
  source: 'configured' | 'repository' | 'default' | null
  /** The file a shared answer came from. */
  from?: string | null
  /** This project has unattended work that predates the sandbox and has not been told. */
  warn: boolean
}

/**
 * What this project's runs are allowed to touch.
 *
 * There is nothing to detect here, unlike the check and setup commands — an
 * unconfigured project is sandboxed — so `source` carries the only distinction
 * worth drawing: whether somebody chose this or it is simply the default.
 */
export function useProjectSandbox() {
  const state = useState<ProjectSandboxState | null>('project-sandbox', () => null)
  const saving = useState('project-sandbox-saving', () => false)

  async function load() {
    try {
      state.value = await $fetch<ProjectSandboxState>('/api/project/sandbox')
    } catch (e) {
      console.error('[useProjectSandbox] load:', e)
    }
  }

  async function save(patch: {
    enabled?: boolean
    allowedDomains?: string[]
    /** Records that the notice was read, without choosing anything. */
    acknowledge?: boolean
  }) {
    saving.value = true
    try {
      await $fetch('/api/project/sandbox', { method: 'POST', body: patch })
      await load()
    } finally {
      saving.value = false
    }
  }

  async function reset() {
    saving.value = true
    try {
      await $fetch('/api/project/sandbox', { method: 'POST', body: { reset: true } })
      await load()
    } finally {
      saving.value = false
    }
  }

  return { state, saving, load, save, reset }
}

/**
 * What this project runs to show itself, alongside the check and setup
 * commands. Same shape as those, because it is the same kind of answer.
 */
export function useProjectDev() {
  const state = useState<ProjectChecks | null>('project-dev', () => null)
  const saving = useState('project-dev-saving', () => false)

  async function load() {
    try {
      state.value = await $fetch<ProjectChecks>('/api/project/dev')
    } catch (e) {
      console.error('[useProjectDev] load:', e)
    }
  }

  async function save(command: string) {
    saving.value = true
    try {
      await $fetch('/api/project/dev', { method: 'POST', body: { command } })
      await load()
    } finally {
      saving.value = false
    }
  }

  async function reset() {
    saving.value = true
    try {
      await $fetch('/api/project/dev', { method: 'POST', body: { reset: true } })
      await load()
    } finally {
      saving.value = false
    }
  }

  return { state, saving, load, save, reset }
}

/** Worktrees as git reports them, including ones with no session behind them. */
export function useWorktrees() {
  const data = useState<{ repoDir: string | null; isRepo: boolean; root: string | null; home: string | null; worktrees: WorktreeEntry[] }>(
    'worktrees',
    () => ({ repoDir: null, isRepo: false, root: null, home: null, worktrees: [] }),
  )

  async function fetchAll() {
    try {
      data.value = await $fetch('/api/worktrees')
    } catch (e) {
      console.error('[useWorktrees] fetchAll:', e)
    }
  }

  async function prune(opts: { paths?: string[]; force?: boolean } = {}) {
    const result = await $fetch<{ removed: string[]; failed: { path: string; reason: string }[] }>(
      '/api/worktrees/prune',
      { method: 'POST', body: opts },
    )
    await fetchAll()
    return result
  }

  async function recover(opts: { paths?: string[] } = {}) {
    const result = await $fetch<{ recovered: Session[]; skipped: { path: string; reason: string }[] }>(
      '/api/worktrees/recover',
      { method: 'POST', body: opts },
    )
    await fetchAll()
    return result
  }

  const orphans = computed(() => data.value.worktrees.filter(w => w.orphaned))

  // Both take their answer from `orphanKind`, so the two lists cannot overlap
  // and cannot disagree with whatever the panel decides to draw.
  const restorable = computed(() =>
    orphans.value.filter(w => orphanKind(w.recovery) === 'restorable'))

  const strays = computed(() =>
    orphans.value.filter(w => orphanKind(w.recovery) === 'stray'))

  return { data, orphans, restorable, strays, fetchAll, prune, recover }
}
