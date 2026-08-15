import { describe, expect, it } from 'vitest'
import { outcomeOf, summarizeRitualRuns } from '../server/utils/ritualHistory'
import type { RunSummary } from '../server/utils/runStore'

/**
 * A ritual fires when nobody is watching, so the only thing that makes a broken
 * one noticeable is its history being right. The case that matters most is the
 * one that does not look like a failure: an unattended run refused a tool it
 * needed finishes "completed" having done half the job.
 */

let seq = 0

function run(patch: Partial<RunSummary> = {}): RunSummary {
  return {
    id: `r${seq++}`,
    kind: 'command',
    title: 'Morning briefing',
    status: 'completed',
    createdAt: 1_000 - seq,
    preview: '',
    source: 'ritual',
    ...patch,
  }
}

describe('reading an outcome', () => {
  it('counts a clean run as worked', () => {
    expect(outcomeOf(run())).toBe('ok')
  })

  it('counts a completed-but-refused run as blocked, not as success', () => {
    expect(outcomeOf(run({ needsAttention: true }))).toBe('blocked')
    expect(outcomeOf(run({ deniedTools: ['Bash'] }))).toBe('blocked')
  })

  /**
   * A briefing that could not reach the API it summarises finished with nothing
   * in it, exactly like one refused a tool. Counting it as `ok` would let a
   * ritual that has genuinely stopped working keep its clean record — and would
   * also hand it the automatic retry, which would produce the identical refusal
   * a minute later for money.
   */
  it('counts a run the sandbox refused as blocked too', () => {
    expect(outcomeOf(run({ refusedHosts: ['registry.npmjs.org'] }))).toBe('blocked')
  })

  it('still counts a run that reached everything it wanted as worked', () => {
    expect(outcomeOf(run({ refusedHosts: [] }))).toBe('ok')
  })

  it('separates a crash from a refusal and from being stopped by hand', () => {
    expect(outcomeOf(run({ status: 'failed' }))).toBe('failed')
    expect(outcomeOf(run({ status: 'cancelled' }))).toBe('stopped')
    expect(outcomeOf(run({ status: 'running' }))).toBe('running')
    expect(outcomeOf(run({ status: 'queued' }))).toBe('running')
  })
})

describe('a ritual that has stopped working', () => {
  it('counts the run of failures back from the most recent', () => {
    const { failingStreak } = summarizeRitualRuns([
      run({ status: 'failed' }),
      run({ deniedTools: ['Bash(gh:*)'] }),
      run({ status: 'failed' }),
      run(),
      run({ status: 'failed' }),
    ])

    expect(failingStreak).toBe(3)
  })

  it('is not failing when the last run worked', () => {
    const { failingStreak } = summarizeRitualRuns([
      run(),
      run({ status: 'failed' }),
      run({ status: 'failed' }),
    ])

    expect(failingStreak).toBe(0)
  })

  it('does not let an in-flight run hide the failures behind it', () => {
    // Otherwise a ritual that fails every morning looks fine for as long as
    // today's attempt is still going.
    const { failingStreak } = summarizeRitualRuns([
      run({ status: 'running' }),
      run({ status: 'failed' }),
      run({ status: 'failed' }),
    ])

    expect(failingStreak).toBe(2)
  })

  it('does not blame the ritual for a run someone stopped', () => {
    const { failingStreak } = summarizeRitualRuns([
      run({ status: 'cancelled' }),
      run(),
    ])

    expect(failingStreak).toBe(0)
  })

  /**
   * Found on a real machine: `Morning brief` sat at two failures, one restart
   * away from turning itself off, and all three records said the same thing —
   * "Interrupted — the server stopped while this was running." Nothing was
   * wrong with the ritual. Working on this app was a way to silently disable
   * the briefing it runs every morning.
   */
  it('does not blame the ritual for a run the server stopped', () => {
    const { failingStreak } = summarizeRitualRuns([
      run({ status: 'failed', interrupted: true }),
      run({ status: 'failed', interrupted: true }),
      run({ status: 'failed', interrupted: true }),
      run(),
    ])

    expect(failingStreak).toBe(0)
  })

  it('still counts real failures either side of a restart', () => {
    // The restart is not evidence, but it is not an alibi for the runs around
    // it either — skipped, not treated as a run that worked.
    const { failingStreak } = summarizeRitualRuns([
      run({ status: 'failed' }),
      run({ status: 'failed', interrupted: true }),
      run({ status: 'failed' }),
      run(),
    ])

    expect(failingStreak).toBe(2)
  })

  it('keeps the run in the history, because Activity should still say it failed', () => {
    // Only the ritual's health record ignores it. The run genuinely did not
    // finish, and a list that hid that would be lying about the morning.
    const { runs } = summarizeRitualRuns([run({ status: 'failed', interrupted: true })])

    expect(runs[0]).toMatchObject({ outcome: 'failed', interrupted: true })
  })

  it('reports when it last produced something usable', () => {
    const worked = run({ createdAt: 500 })
    const { lastOkAt } = summarizeRitualRuns([run({ status: 'failed' }), worked, run()])

    expect(lastOkAt).toBe(500)
  })

  it('leaves lastOkAt unset for a ritual that has never finished cleanly', () => {
    const { lastOkAt, failingStreak } = summarizeRitualRuns([run({ status: 'failed' })])

    expect(lastOkAt).toBeUndefined()
    expect(failingStreak).toBe(1)
  })

  it('handles a ritual that has never run', () => {
    expect(summarizeRitualRuns([])).toEqual({ runs: [], failingStreak: 0, lastOkAt: undefined })
  })

  it('carries the reason forward, so the row can say what was needed', () => {
    const { runs } = summarizeRitualRuns([
      run({ needsAttention: true, deniedTools: ['Bash(gh issue edit:*)'], suggestedRules: ['Bash(gh issue edit:*)'] }),
    ])

    expect(runs[0]).toMatchObject({
      outcome: 'blocked',
      deniedTools: ['Bash(gh issue edit:*)'],
      suggestedRules: ['Bash(gh issue edit:*)'],
    })
  })
})
