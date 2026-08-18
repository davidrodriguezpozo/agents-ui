import type { RunEvent } from './runStore'

/**
 * The steps a finished turn took, recovered from its event log.
 *
 * While a turn is running the browser gets these from the stream, but a turn
 * read back tomorrow has only what was persisted. Without this a session's
 * history is prose with no account of what it actually did.
 */

export interface TurnToolCall {
  id: string
  toolName: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
}

/** Enough to say what a step did, without shipping a file's entire contents. */
const MAX_VALUE = 200
const MAX_CALLS = 60

/**
 * `Write` carries the whole new file in its arguments, and a turn can have
 * dozens of those. Sending them would make the session endpoint enormous to
 * describe a line of text, so values are trimmed to what a description needs.
 */
export function compactInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}

  const compact: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') {
      compact[key] = value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      compact[key] = value
    }
    // Nested structures are dropped: nothing that describes a step lives in one.
  }
  return compact
}

/** One step, as much of it as a line of text needs. */
export interface StepSummary {
  toolName: string
  input: Record<string, unknown>
  at: number
}

/**
 * The last few steps a run took, newest first.
 *
 * The counterpart to `toolCallsFromEvents`, which reads a finished turn in
 * order so it can pair results with calls. This reads a *running* one from the
 * end, because what a wall or a live feed wants is the newest handful and
 * nothing else — a turn fifty calls in should not be walked from the beginning
 * every two seconds to find out what it is doing now.
 *
 * Results are ignored on purpose. A call that has not come back yet is exactly
 * the one worth showing, and waiting for its result would mean always reporting
 * the step before the current one.
 */
export function recentSteps(events: RunEvent[] = [], limit = 1): StepSummary[] {
  const steps: StepSummary[] = []

  for (let index = events.length - 1; index >= 0 && steps.length < limit; index--) {
    const event = events[index]!
    if (event.type !== 'tool_use') continue

    steps.push({
      // An event with no tool name is not worth dropping the step over; the
      // word "tool" reads better than an empty verb.
      toolName: typeof event.toolName === 'string' && event.toolName ? event.toolName : 'tool',
      input: compactInput(event.input),
      at: event.at,
    })
  }

  return steps
}

/** What a run is doing this second, or null if it has not used a tool yet. */
export function latestStep(events: RunEvent[] = []): StepSummary | null {
  return recentSteps(events, 1)[0] ?? null
}

export function toolCallsFromEvents(events: RunEvent[] = []): TurnToolCall[] {
  const calls: TurnToolCall[] = []
  const byId = new Map<string, TurnToolCall>()

  for (const event of events) {
    if (event.type === 'tool_use') {
      // A turn that reads fifty files does not need fifty rows to be readable.
      if (calls.length >= MAX_CALLS) continue

      const call: TurnToolCall = {
        id: String(event.id),
        toolName: String(event.toolName),
        input: compactInput(event.input),
      }
      calls.push(call)
      byId.set(call.id, call)
      continue
    }

    if (event.type === 'tool_result') {
      // The result arrives separately and may be for a call we capped out of.
      const call = byId.get(String(event.id))
      if (!call) continue

      call.result = typeof event.preview === 'string' ? event.preview : ''
      call.isError = Boolean(event.isError)
    }
  }

  return calls
}
