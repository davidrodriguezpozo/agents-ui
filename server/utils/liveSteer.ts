import { emit, getActive } from './runStore'
import { userTurn } from './chatPrompt'
import type { ModelImage } from '~/utils/imageAttachments'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * Getting a sentence into a turn that is already running.
 *
 * The queue in `sessionQueue` is the right answer to "and then do this" and the
 * wrong one to "no, not that file": it waits for the turn to end, so the only
 * way to correct a turn heading somewhere useless was to stop it and pay again
 * for everything it had already worked out. Ten minutes of context thrown away
 * to change one noun.
 *
 * A `query()` handed a plain string cannot be told anything else — the SDK
 * writes that one message and, on the first result, closes the CLI's stdin
 * itself. Handed an async iterable instead, the same call is in *streaming
 * input* mode: stdin stays open, and every message the iterable yields reaches
 * the CLI that is already mid-turn. That is what this module is. It owns one
 * channel per run: the opening prompt, anything typed into the turn afterwards,
 * and the close that ends the conversation.
 *
 * Two consequences worth stating, because both are load-bearing:
 *
 *   - **Closing is now ours.** In streaming input mode nothing else will do it,
 *     so a run whose channel is never closed is a CLI process that never exits.
 *     `executeRun` closes on the result and again in its `finally`.
 *   - **The CLI decides when the message lands**, and it lands it at a tool
 *     boundary rather than in the middle of one — a message arriving mid-turn is
 *     attached to the running turn rather than run as a turn of its own. So
 *     nothing here interrupts: `Query.interrupt()` would abort the very work
 *     being steered.
 *
 * A message accepted here but never yielded — the turn ended in the window
 * between the two — comes back out of `closeSteerChannel` so the caller can put
 * it in the session's queue instead. Losing it would be the worst option: it was
 * typed, it was accepted, and nothing would say where it went.
 */

/** What was said, and anything it was said about. */
export interface SteerMessage {
  text: string
  images: ModelImage[]
}

interface Channel {
  /** Accepted, not yet handed to the CLI. Usually empty or one long. */
  pending: SteerMessage[]
  closed: boolean
  /** Resolves the iterable out of its wait. Present only while it is waiting. */
  wake?: () => void
}

const channels = new Map<string, Channel>()

/**
 * The message shape comes from `chatPrompt`, which is where the assistant panel
 * builds the same thing.
 *
 * It used to be built here as a single text block, which was correct for as
 * long as a turn was only ever words. Two copies of "what a user message looks
 * like" is how one of them ends up without images on it, and the one that would
 * have drifted is this one — the panel's is exercised by every screenshot
 * anybody pastes, and this path is only exercised by a session.
 */
function userMessage(text: string, images: ModelImage[] = []): SDKUserMessage {
  return userTurn(text, images)
}

/**
 * Open this run's input channel and return the prompt to hand `query()`.
 *
 * The iterable yields the opening instruction, then blocks — which is the point.
 * A generator that has not returned is a stdin that is still open.
 */
export function openSteerChannel(
  runId: string,
  input: string,
  images: ModelImage[] = [],
): AsyncIterable<SDKUserMessage> {
  const channel: Channel = { pending: [], closed: false }
  channels.set(runId, channel)

  return {
    async *[Symbol.asyncIterator]() {
      yield userMessage(input, images)

      for (;;) {
        const next = channel.pending.shift()
        if (next !== undefined) {
          // Recorded here rather than where it was accepted, because this is the
          // moment it goes to the CLI. An event written on acceptance would
          // claim a delivery for the one message that never made it.
          emit(runId, { type: 'steer', text: next.text })
          yield userMessage(next.text, next.images)
          continue
        }

        if (channel.closed) return

        await new Promise<void>((resolve) => {
          channel.wake = () => {
            channel.wake = undefined
            resolve()
          }
        })
      }
    },
  }
}

/**
 * Say something to a turn that is still going. True when it was taken.
 *
 * False covers every reason it could not be: no such run, a run that has
 * finished or been stopped, a channel already closed, nothing to say. All of
 * them mean the same thing to the caller — this has to go through the queue
 * instead — so they are one answer rather than five.
 *
 * An image with nothing typed under it is something to say. "Not this, look at
 * this" is the correction a screenshot is for, and refusing it for having no
 * words would send the person back to describing the picture.
 */
export function steerRun(runId: string, text: string, images: ModelImage[] = []): boolean {
  const trimmed = text.trim()
  if (!trimmed && !images.length) return false

  const channel = channels.get(runId)
  if (!channel || channel.closed) return false

  // The channel outlives the turn by a moment — it is closed in `executeRun`'s
  // `finally`, after the run's status is already settled — so the run itself is
  // asked as well. Without this, a message typed into the second between the
  // last result and the teardown would be accepted by a CLI that is exiting.
  const entry = getActive(runId)
  if (!entry || entry.run.status !== 'running' || entry.abort.signal.aborted) return false

  channel.pending.push({ text: trimmed, images })
  channel.wake?.()
  return true
}

/**
 * End the input, and hand back anything that never made it.
 *
 * Idempotent: called on the turn's result and again when the run tears down, and
 * the second call has nothing to report. Closing is what lets the CLI exit, so
 * it must happen on every ending — including the ones that throw.
 *
 * Whatever came back still has its images: they are handed to the queue along
 * with the words, and the queue is what puts them somewhere that survives.
 */
export function closeSteerChannel(runId: string): SteerMessage[] {
  const channel = channels.get(runId)
  if (!channel) return []

  channels.delete(runId)
  channel.closed = true

  const undelivered = channel.pending.splice(0)
  channel.wake?.()

  return undelivered
}
