import type { Run, RunEvent } from '../runStore'
import type { ResolvedRunOptions } from '../runOptions'
import type { SteerMessage } from '../liveSteer'
import type { ModelImage } from '~/utils/imageAttachments'

/**
 * Which agent actually runs a turn.
 *
 * This app is about 130,000 lines and almost none of it is Claude-shaped.
 * Worktrees, the merge train, GitHub, reviews, previews, the terminal, the
 * scheduler and the ledger never learn which model ran — everything downstream
 * of a turn already speaks `RunEvent`, not SDK messages. The coupling was
 * twelve imports of `@anthropic-ai/claude-agent-sdk`, six of them the `query()`
 * call itself, and one function shaping every option. So the seam is small.
 *
 * It is worth cutting for a better reason than neutrality: three sessions
 * racing the same brief on three different agents, in three worktrees, gated on
 * the same `make check`, with the train landing whichever one passed. None of
 * the CLIs can do that for itself, and this app already does the hard half.
 *
 * **There is deliberately no second event vocabulary.** A provider's whole job
 * is to turn whatever its CLI says into the `RunEvent`s in `runStore.ts` that
 * the browser, `cli/runStream.ts`, the wall and the ledger already consume. A
 * provider that invented its own shape would push the translation into every
 * one of those instead of doing it once here.
 */
export type ProviderId = 'claude' | 'cursor'

/**
 * Absent on every record already on disk, and that is the migration.
 *
 * Every session, run and schedule written before this existed ran on Claude
 * Code, so absence already means Claude Code. Rewriting live session files to
 * say something they imply would be risk bought for nothing.
 */
export const DEFAULT_PROVIDER: ProviderId = 'claude'

/**
 * What a provider can and cannot do, as a value rather than a comment.
 *
 * Three things do not port from Claude Code, and each has to be visible before
 * the first turn rather than discovered after it — a composer offering Steer on
 * a provider with no stdin is a button that silently does something else. So
 * the honest answer to "can this provider do that" is something the UI can
 * read.
 */
export interface ProviderCapabilities {
  /**
   * Whether a sentence typed mid-turn can reach the turn. Needs a stdin that
   * stays open; see `liveSteer`. Without it `sessionQueue` is the fallback, and
   * the composer offers Queue only.
   */
  canSteer: boolean
  /**
   * Whether the provider can stop and ask before using a tool. Without it the
   * policy is fixed at spawn: what the run was not granted, it is refused,
   * with nobody to appeal to.
   */
  canPromptForPermission: boolean
  /** Whether it reports what a turn cost. See the note in `outcomes.ts`. */
  reportsCostUsd: boolean
}

/** Everything one turn needs, resolved. */
export interface ProviderTurn {
  run: Run
  options: ResolvedRunOptions
  /**
   * The id to resume with, from the previous turn of this conversation. Absent
   * on the first turn of a session, which is what starts a new conversation.
   */
  resumeSessionId?: string
  /** Nobody is watching. A prompt nobody can answer is refused, not waited on. */
  unattended?: boolean
  maxBudgetUsd?: number
  /** Images for the opening message. The run record deliberately holds no bytes. */
  images?: ModelImage[]
  /** Cancellation, shared with the run store's entry for this run. */
  abort: AbortController
  /** Progress goes here, and only here. */
  emit: (event: Omit<RunEvent, 'seq' | 'at'>) => void
  /**
   * Write onto the live run record — `sdkSessionId`, `stats`, `needsAttention`
   * and the rest. Handed over rather than reached for so a provider cannot
   * quietly acquire a second way to change a run's status.
   */
  patch: (fields: Partial<Run>) => void
}

export interface Provider {
  readonly id: ProviderId
  /** What the UI calls it. */
  readonly label: string
  readonly capabilities: ProviderCapabilities
  /**
   * Drive one turn to completion, emitting as it goes.
   *
   * Returns anything that was accepted into this turn and never delivered —
   * the turn ended in the window between the two. It is still the next thing
   * somebody meant to say, so the caller puts it at the front of the session's
   * queue. A provider that cannot take mid-turn input returns nothing, which is
   * the same answer as having taken nothing.
   *
   * Throwing is how a turn fails. The caller records the message and marks the
   * run failed; nothing here should catch to report a failure as a success.
   */
  runTurn: (turn: ProviderTurn) => Promise<SteerMessage[] | void>
}
