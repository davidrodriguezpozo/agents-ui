import { describe, expect, it } from 'vitest'
import { GIVE_UP_AFTER, shouldGiveUp, shouldRetry } from '../server/utils/ritualHealth'
import { summarizeRitualRuns } from '../server/utils/ritualHistory'
import type { RunSummary } from '../server/utils/runStore'

/**
 * What to do about a ritual that isn't working.
 *
 * Histories are built through `summarizeRitualRuns` rather than by hand, so
 * these also pin down the thing that actually matters: which outcomes count
 * against a ritual and which say nothing about it.
 */

let seq = 0
function run(partial: Partial<RunSummary> & { status: string }): RunSummary {
  return {
    id: `run-${++seq}`,
    createdAt: Date.now() - seq * 1000,
    preview: '',
    ...partial,
  } as RunSummary
}

/** Newest first, as the run store returns them. */
const history = (...runs: RunSummary[]) => summarizeRitualRuns(runs)

const ok = () => run({ status: 'completed' })
const failed = () => run({ status: 'failed', error: 'ended early' })
const blocked = () => run({ status: 'completed', deniedTools: ['Bash'] })
const stopped = () => run({ status: 'cancelled' })

describe('shouldRetry', () => {
  it('gives a first failure one more go', () => {
    expect(shouldRetry('failed', history(ok(), ok()))).toBe(true)
  })

  it('will not retry a run that was refused a tool', () => {
    // Running it again produces the identical refusal a minute later, for
    // money. What it needs is the rule, which it already offers you.
    expect(shouldRetry('blocked', history(ok()))).toBe(false)
  })

  it('will not retry once a streak is under way', () => {
    // Past the first failure the retry has stopped being a second chance and
    // become a way to fail twice as often.
    expect(shouldRetry('failed', history(failed(), ok()))).toBe(false)
  })

  it('has nothing to retry when the run worked', () => {
    expect(shouldRetry('ok', history(ok()))).toBe(false)
    expect(shouldRetry('stopped', history(ok()))).toBe(false)
  })
})

describe('shouldGiveUp', () => {
  it('holds on while there is still hope', () => {
    expect(shouldGiveUp(history(failed(), ok()))).toBeNull()
    expect(shouldGiveUp(history(failed(), failed(), ok()))).toBeNull()
  })

  it('stops firing once it has clearly broken', () => {
    const verdict = shouldGiveUp(history(failed(), failed(), failed(), ok()))
    expect(verdict?.reason).toContain('3 runs in a row')
  })

  it('counts blocked runs against it, since they produce nothing either', () => {
    const verdict = shouldGiveUp(history(blocked(), blocked(), blocked()))
    expect(verdict).not.toBeNull()
  })

  it('says when it last worked, because that is the useful bit', () => {
    const lastGood = ok()
    const verdict = shouldGiveUp(history(failed(), failed(), failed(), lastGood))
    expect(verdict?.reason).toContain(new Date(lastGood.createdAt).toLocaleDateString())
  })

  it('says so plainly when it has never worked', () => {
    const verdict = shouldGiveUp(history(failed(), failed(), failed()))
    expect(verdict?.reason).toContain('never produced a usable result')
  })

  it('is not fooled by runs somebody stopped by hand', () => {
    // Stopping a run says something about the person, not the ritual — it
    // must neither break the streak nor count towards it.
    const verdict = shouldGiveUp(history(failed(), stopped(), failed(), stopped(), failed()))
    expect(verdict).not.toBeNull()

    expect(shouldGiveUp(history(stopped(), stopped(), stopped()))).toBeNull()
  })

  it('is not tripped by work still in flight', () => {
    const running = run({ status: 'running' })
    expect(shouldGiveUp(history(running, failed(), failed()))).toBeNull()
  })

  it('forgives everything once it works again', () => {
    expect(shouldGiveUp(history(ok(), failed(), failed(), failed()))).toBeNull()
  })

  it('needs exactly the threshold, not one short of it', () => {
    const short = Array.from({ length: GIVE_UP_AFTER - 1 }, failed)
    const enough = Array.from({ length: GIVE_UP_AFTER }, failed)
    expect(shouldGiveUp(history(...short, ok()))).toBeNull()
    expect(shouldGiveUp(history(...enough, ok()))).not.toBeNull()
  })
})
