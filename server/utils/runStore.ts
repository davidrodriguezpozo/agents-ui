import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { matchesFilter, sourceOf, type RunFilter, type RunSource } from './runFilter'
import type { RunStats } from '~/types'

export type RunKind = 'command' | 'chat' | 'agent'
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface RunEvent {
  seq: number
  at: number
  type: 'status' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'result' | 'error'
    | 'permission_request' | 'permission_resolved'
  [key: string]: unknown
}

export interface Run {
  id: string
  kind: RunKind
  title: string
  /** The prompt as sent, e.g. `/hd:goodmorning` or free text. */
  input: string
  invocation?: string
  agentSlug?: string
  projectDir?: string
  status: RunStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  /** Accumulated assistant text — the run's result. */
  output: string
  error?: string
  stats?: RunStats
  sdkSessionId?: string
  /** A scheduled run hit a permission prompt with nobody there to answer it. */
  needsAttention?: boolean
  /** Tools refused because the run was unattended — the result is incomplete. */
  deniedTools?: string[]
  /** Set when a limit cut the run short, so the output is not the whole job. */
  stoppedBy?: 'budget' | 'turns'
  /** Rules that would have let this run through, gathered from its prompts. */
  suggestedRules?: string[]
  /** Set when a ritual started this run, so its allowlist can be updated. */
  scheduleId?: string
  /** Set when the run is a turn in a session, which owns a worktree. */
  sessionId?: string
  events: RunEvent[]
}

interface ActiveRun {
  run: Run
  emitter: EventEmitter
  abort: AbortController
  persistTimer?: ReturnType<typeof setTimeout>
}

/**
 * Runs are owned by the server, not by whoever opened the page. A run keeps
 * going when the tab closes, can be reattached to, and is on disk when it
 * finishes — which is what makes scheduled and background runs possible at all.
 *
 * Process-global, like the rest of this app's state. Single local user.
 */
const active = new Map<string, ActiveRun>()

function runsDir(): string {
  return join(getClaudeDir(), 'agents-ui', 'runs')
}

function runPath(id: string): string {
  return join(runsDir(), `${id.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`)
}

export function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createRun(init: Omit<Run, 'id' | 'status' | 'createdAt' | 'output' | 'events'> & { id?: string }): Run {
  const run: Run = {
    id: init.id || newRunId(),
    status: 'queued',
    createdAt: Date.now(),
    output: '',
    events: [],
    ...init,
  }

  active.set(run.id, {
    run,
    emitter: new EventEmitter(),
    abort: new AbortController(),
  })

  // Emitters can have many attached viewers; the default cap of 10 is noise.
  active.get(run.id)!.emitter.setMaxListeners(50)
  void persist(run.id)

  return run
}

export function getActive(id: string): ActiveRun | undefined {
  return active.get(id)
}

/** Append an event, keep the derived fields in sync, and notify listeners. */
export function emit(id: string, event: Omit<RunEvent, 'seq' | 'at'>): void {
  const entry = active.get(id)
  if (!entry) return

  const full = {
    ...event,
    seq: entry.run.events.length,
    at: Date.now(),
  } as RunEvent

  entry.run.events.push(full)

  if (full.type === 'text' && typeof full.text === 'string') {
    entry.run.output += full.text
  }

  entry.emitter.emit('event', full)
  schedulePersist(id)
}

export function setStatus(id: string, status: RunStatus, patch: Partial<Run> = {}): void {
  const entry = active.get(id)
  if (!entry) return

  Object.assign(entry.run, patch, { status })
  if (status === 'running' && !entry.run.startedAt) entry.run.startedAt = Date.now()
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    entry.run.completedAt = Date.now()
  }

  emit(id, { type: 'status', status })
  void persist(id)
}

export function cancel(id: string): boolean {
  const entry = active.get(id)
  if (!entry) return false
  if (entry.run.status !== 'running' && entry.run.status !== 'queued') return false

  entry.abort.abort()
  setStatus(id, 'cancelled')
  return true
}

/** Debounced write — a streaming run would otherwise write on every token. */
function schedulePersist(id: string): void {
  const entry = active.get(id)
  if (!entry || entry.persistTimer) return

  entry.persistTimer = setTimeout(() => {
    entry.persistTimer = undefined
    void persist(id)
  }, 500)
}

let tmpCounter = 0

/**
 * A streaming run rewrites its file every half second, so an interrupted write
 * is a realistic way to lose one. Write-then-rename keeps the last complete
 * version instead of leaving a truncated file that `readRun` would reject.
 *
 * Unlike sessions and rituals, each run is its own file — so damage here costs
 * one run's history rather than all of them, and no lock is needed because only
 * this process writes a given run.
 */
export async function persist(id: string): Promise<void> {
  const entry = active.get(id)
  if (!entry) return

  try {
    await mkdir(runsDir(), { recursive: true })
    const path = runPath(id)
    const tmp = `${path}.${process.pid}.${tmpCounter++}.tmp`
    await writeFile(tmp, JSON.stringify(entry.run, null, 2), 'utf-8')
    await rename(tmp, path)
  } catch (e) {
    console.error('[runStore] failed to persist run', id, e)
  }
}

export async function readRun(id: string): Promise<Run | null> {
  const entry = active.get(id)
  if (entry) return entry.run

  const path = runPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as Run
  } catch {
    return null
  }
}

export interface RunSummary {
  id: string
  kind: RunKind
  title: string
  invocation?: string
  agentSlug?: string
  status: RunStatus
  createdAt: number
  completedAt?: number
  durationMs?: number
  costUsd?: number
  /** First line or so of the output, for a list view. */
  preview: string
  error?: string
  needsAttention?: boolean
  deniedTools?: string[]
  suggestedRules?: string[]
  scheduleId?: string
  sessionId?: string
  /** What set it going — worked out once here rather than in every view. */
  source: RunSource
}

function summarize(run: Run): RunSummary {
  const preview = run.output.replace(/[\s#*`>-]+/g, ' ').trim().slice(0, 160)
  return {
    id: run.id,
    kind: run.kind,
    title: run.title,
    invocation: run.invocation,
    agentSlug: run.agentSlug,
    status: run.status,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    durationMs: run.completedAt && run.startedAt ? run.completedAt - run.startedAt : undefined,
    costUsd: run.stats?.costUsd,
    preview,
    error: run.error,
    needsAttention: run.needsAttention,
    deniedTools: run.deniedTools,
    suggestedRules: run.suggestedRules,
    scheduleId: run.scheduleId,
    sessionId: run.sessionId,
    source: sourceOf(run),
  }
}

/** Every run this machine has a record of, newest first. */
async function collectRuns(): Promise<Run[]> {
  const byId = new Map<string, Run>()

  // Anything in flight is newer than what's on disk, so seed from memory first.
  for (const entry of active.values()) byId.set(entry.run.id, entry.run)

  const dir = runsDir()
  if (existsSync(dir)) {
    const files = (await readdir(dir)).filter((f: string) => f.endsWith('.json'))
    for (const file of files) {
      const id = file.replace(/\.json$/, '')
      if (byId.has(id)) continue
      try {
        byId.set(id, JSON.parse(await readFile(join(dir, file), 'utf-8')) as Run)
      } catch {
        // Skip malformed run files
      }
    }
  }

  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * The run log, newest first. Filtering happens before the limit, so a search
 * reaches everything on disk rather than only the most recent page of it.
 */
/**
 * Everything since a moment, uncapped.
 *
 * `listRuns` exists to fill a page and is limited accordingly; adding up what a
 * month cost has to see the month, not the most recent fifty.
 */
export async function runsSince(sinceMs: number): Promise<RunSummary[]> {
  return (await collectRuns()).filter(run => run.createdAt >= sinceMs).map(summarize)
}

export async function listRuns(options: RunFilter & { limit?: number } = {}): Promise<RunSummary[]> {
  const { limit = 50, ...filter } = options

  return (await collectRuns())
    .filter(run => matchesFilter(run, filter))
    .slice(0, limit)
    .map(summarize)
}

/**
 * The runs each ritual has produced, newest first.
 *
 * Grouped in one pass rather than one request per ritual: a ritual's history is
 * wanted for every row at once, and the whole set has to be read either way.
 * Capped per ritual so a year of a daily briefing doesn't come back in full.
 */
export async function listRunsBySchedule(perSchedule = 10): Promise<Record<string, RunSummary[]>> {
  const grouped: Record<string, RunSummary[]> = {}

  for (const run of await collectRuns()) {
    if (!run.scheduleId) continue
    const bucket = grouped[run.scheduleId] ??= []
    if (bucket.length < perSchedule) bucket.push(summarize(run))
  }

  return grouped
}

/**
 * Close off runs that were in flight when the server stopped.
 *
 * A run lives in memory: the SDK query, the abort controller, the listeners.
 * Restarting loses all of that, but the record on disk still says `running`,
 * so an interrupted run sits in Activity forever claiming to be working, keeps
 * its session marked busy, and counts toward the badge that says something
 * needs you.
 *
 * Called once at boot, when nothing can legitimately be running yet.
 */
export async function closeInterruptedRuns(): Promise<Run[]> {
  const dir = runsDir()
  if (!existsSync(dir)) return []

  const files = (await readdir(dir).catch(() => [] as string[])).filter(f => f.endsWith('.json'))
  const closed: Run[] = []

  for (const file of files) {
    const path = join(dir, file)
    let run: Run
    try {
      run = JSON.parse(await readFile(path, 'utf-8')) as Run
    } catch {
      continue
    }

    if (run.status !== 'running' && run.status !== 'queued') continue

    run.status = 'failed'
    run.completedAt = Date.now()
    run.error = 'Interrupted — the server stopped while this was running. Nothing was lost on disk, but the run did not finish.'

    try {
      await writeFile(path, JSON.stringify(run, null, 2), 'utf-8')
      // Returned, not just counted: what was interrupted decides what should
      // be picked up again, and this is the only place that knows.
      closed.push(run)
    } catch {
      // A run we cannot rewrite is not worth failing startup over.
    }
  }

  return closed
}

/**
 * Drop finished runs from memory once nothing is watching them. They stay on
 * disk; this just stops a long-lived server accumulating completed runs.
 */
export function releaseIfIdle(id: string): void {
  const entry = active.get(id)
  if (!entry) return
  if (entry.run.status === 'running' || entry.run.status === 'queued') return
  if (entry.emitter.listenerCount('event') > 0) return

  void persist(id).then(() => active.delete(id))
}
