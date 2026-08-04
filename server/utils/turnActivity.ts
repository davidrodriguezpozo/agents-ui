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
