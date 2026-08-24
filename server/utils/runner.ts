import { emit, getActive, persist, setStatus, type Run } from './runStore'
import { type ResolvedRunOptions } from './runOptions'
import { closeSteerChannel, type SteerMessage } from './liveSteer'
import { queueMessage } from './sessionQueue'
import { providerFor } from './providers'
import type { ModelImage } from '~/utils/imageAttachments'

/**
 * Drive a run to completion, detached from any HTTP request. Nothing here
 * touches the response — progress goes into the run store, which streams to
 * whoever is currently attached and persists for whoever attaches later.
 *
 * Everything about *how* a turn is taken now lives behind `providers/`: which
 * CLI, which flags, which stream to translate. What is left here is what is true
 * of every provider — the status, the failure, the undelivered messages, the
 * write to disk — which is why this file no longer imports an SDK.
 */
export async function executeRun(
  run: Run,
  options: ResolvedRunOptions,
  opts: {
    unattended?: boolean
    resumeSessionId?: string
    maxBudgetUsd?: number
    /**
     * Images for the opening message. Passed per execution rather than read off
     * the run, because the run record deliberately holds no bytes — see `Run`.
     */
    images?: ModelImage[]
  } = {},
): Promise<void> {
  const entry = getActive(run.id)
  if (!entry) return

  setStatus(run.id, 'running')

  /** Accepted mid-turn and never handed over, because the turn ended first. */
  const undelivered: SteerMessage[] = []

  try {
    const taken = await providerFor(run.provider).runTurn({
      run: entry.run,
      options,
      resumeSessionId: opts.resumeSessionId,
      unattended: opts.unattended,
      maxBudgetUsd: opts.maxBudgetUsd,
      images: opts.images,
      abort: entry.abort,
      emit: event => emit(run.id, event),
      // The live record, so a provider writes where the store is already
      // watching rather than acquiring a second way to change a run's status.
      patch: fields => Object.assign(entry.run, fields),
    })

    if (taken?.length) undelivered.push(...taken)

    if (entry.abort.signal.aborted) {
      // cancel() already set the status; just make sure it's on disk.
      await persist(run.id)
      return
    }

    setStatus(run.id, 'completed')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    emit(run.id, { type: 'error', message })
    setStatus(run.id, 'failed', { error: message })
  } finally {
    /**
     * Every ending that was not the turn's own — stopped, failed, the CLI going
     * away — closes here. A provider that closed its channel on the result has
     * already handed back what was pending, and closing twice reports nothing
     * the second time. A provider with no channel at all gets nothing, which is
     * the same answer.
     */
    undelivered.push(...closeSteerChannel(run.id))

    /**
     * A message taken for this turn that the turn ended before delivering is
     * still the next thing somebody meant to say, so it becomes what it would
     * have been had they pressed the other button: the front of the session's
     * queue, which `startTurn` flushes as soon as this run's status settles.
     */
    if (run.sessionId) {
      for (const message of undelivered) {
        // Its images go with it. They were in memory for a turn that never took
        // them, and the queue is what puts them somewhere that outlives this.
        await queueMessage(run.sessionId, message.text, message.images).catch(() => null)
      }
    }

    await persist(run.id)
  }
}
