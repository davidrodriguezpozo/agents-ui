import type { PermissionRequest, RunStats, RunStatus, ToolCall } from './types'

/**
 * A run as it arrives, frame by frame.
 *
 * The same fold the browser does in `app/composables/useRuns.ts`, kept as a
 * pure function of (state, event) rather than mutations against a reactive
 * object. Two reasons: React wants new objects to re-render, and a reducer with
 * no I/O in it can be tested against a recorded stream — which is the only way
 * to be sure the terminal shows the same run the browser does.
 */
export interface LiveRun {
  id: string
  status: RunStatus
  output: string
  thinking: string
  toolCalls: ToolCall[]
  /** Tool calls waiting on an answer. Empty for a run nobody has to unblock. */
  prompts: PermissionRequest[]
  stats?: RunStats
  error?: string
  /**
   * The highest sequence number seen.
   *
   * Reconnecting asks for everything after it, which is what makes dropping the
   * stream and picking it up again cheap rather than a replay from the start.
   */
  lastSeq: number
}

export function emptyRun(id: string): LiveRun {
  return { id, status: 'queued', output: '', thinking: '', toolCalls: [], prompts: [], lastSeq: -1 }
}

const FINISHED: RunStatus[] = ['completed', 'failed', 'cancelled']

export function isFinished(status: RunStatus): boolean {
  return FINISHED.includes(status)
}

export function applyRunEvent(run: LiveRun, event: Record<string, unknown>): LiveRun {
  const seq = typeof event.seq === 'number' ? Math.max(run.lastSeq, event.seq) : run.lastSeq
  const next: LiveRun = { ...run, lastSeq: seq }

  switch (event.type) {
    case 'status':
      next.status = event.status as RunStatus
      break

    case 'text':
      next.output = run.output + String(event.text ?? '')
      break

    case 'thinking':
      next.thinking = run.thinking + String(event.text ?? '')
      break

    case 'tool_use':
      next.toolCalls = [...run.toolCalls, {
        id: String(event.id),
        toolName: String(event.toolName),
        input: event.input,
      }]
      break

    case 'tool_result':
      next.toolCalls = run.toolCalls.map(call => (call.id === String(event.id)
        ? { ...call, result: String(event.preview ?? ''), isError: Boolean(event.isError) }
        : call))
      break

    case 'permission_request': {
      const request = event.request as PermissionRequest | undefined
      // A replayed stream can carry the same prompt twice; answering one that is
      // already on screen twice is worse than ignoring the duplicate.
      if (request && !run.prompts.some(p => p.id === request.id)) {
        next.prompts = [...run.prompts, request]
      }
      break
    }

    case 'permission_resolved':
      next.prompts = run.prompts.filter(prompt => prompt.id !== String(event.id))
      break

    case 'result':
      // Authoritative: the deltas above are partial by nature, and this is the
      // whole answer as the run finally reported it.
      next.output = String(event.text ?? run.output)
      next.stats = event.stats as RunStats
      break

    case 'error':
      next.error = String(event.message ?? 'Unknown error')
      break

    case 'done':
      next.status = event.status as RunStatus
      // Nothing can be approved for a run that has stopped, and leaving the
      // prompt up invites an answer that goes nowhere.
      if (isFinished(next.status)) next.prompts = []
      break
  }

  return next
}

/**
 * Follow a run to the end, across a dropped connection.
 *
 * The stream endpoint replays from `?after=`, which is what `lastSeq` is for —
 * and until now nothing sent it. A stream that ended early (a server restart, a
 * laptop lid, a proxy idle timeout) simply stopped, and the pane fell back to
 * the four-second poll for the rest of the run without saying so. Reconnecting
 * from the cursor is cheap: the server writes only what came after it.
 *
 * Written against the two methods it uses rather than the client class, so a
 * test can hand it a recorded stream — including one that stops halfway.
 */
export interface EventSource {
  events: (
    path: string,
    options: { query?: Record<string, string | number | boolean | undefined>; signal?: AbortSignal },
  ) => AsyncGenerator<Record<string, unknown>>
}

export interface FollowOptions {
  signal: AbortSignal
  /** Called after every folded event, with the whole run so far. */
  onRun: (run: LiveRun) => void
  /** Whether the transport is up, so a pane can say "reconnecting…". */
  onConnected?: (connected: boolean) => void
  /** Attempt n waits this long. Injected so tests do not sleep. */
  backoffMs?: (attempt: number) => number
  sleep?: (ms: number) => Promise<void>
}

export async function followRun(
  source: EventSource,
  runId: string,
  options: FollowOptions,
): Promise<LiveRun> {
  const {
    signal,
    onRun,
    onConnected,
    backoffMs = attempt => Math.min(5_000, 400 * 2 ** attempt),
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  } = options

  let run = emptyRun(runId)
  let attempt = 0

  while (!signal.aborted) {
    try {
      const stream = source.events(`/api/runs/${encodeURIComponent(runId)}/stream`, {
        // -1 on the first attempt, which is what the endpoint defaults to: the
        // whole run, so opening something that finished hours ago still draws.
        query: { after: run.lastSeq },
        signal,
      })

      for await (const event of stream) {
        onConnected?.(true)
        attempt = 0
        run = applyRunEvent(run, event)
        onRun(run)
      }
    } catch {
      // Any transport failure is a reconnect, not an end. A run that really has
      // finished says so in a `done` frame, which is the case below.
    }

    if (signal.aborted || isFinished(run.status)) break

    onConnected?.(false)
    await sleep(backoffMs(attempt++))
  }

  return run
}
