import { describe, expect, it } from 'vitest'
import {
  MAX_CHAIN_STEPS, chainOutcome, chainPrompt, normalizeSteps, shouldContinue, stepTitleFor,
} from '../server/utils/ritualChain'
import { summarizeRitualRuns } from '../server/utils/ritualHistory'
import { shouldGiveUp } from '../server/utils/ritualHealth'
import type { RunSummary } from '../server/utils/runStore'

/**
 * The point of a chain is that four steps are one thing. Everything that can go
 * wrong with it is a place where they go back to being four — most damagingly
 * in the history, where a single bad morning counted four times turns the
 * ritual off after one.
 */

const run = (over: Partial<RunSummary>): RunSummary => ({
  id: 'r1',
  kind: 'command',
  title: 'step',
  status: 'completed',
  createdAt: 1000,
  preview: '',
  source: 'ritual',
  ...over,
} as RunSummary)

describe('one firing, one entry in the history', () => {
  it('collapses a chain into a single run', () => {
    // Newest first, as the run store returns them.
    const history = summarizeRitualRuns([
      run({ id: 'c', chainId: 'x', stepIndex: 2, createdAt: 3000 }),
      run({ id: 'b', chainId: 'x', stepIndex: 1, createdAt: 2000 }),
      run({ id: 'a', chainId: 'x', stepIndex: 0, createdAt: 1000 }),
    ])

    expect(history.runs).toHaveLength(1)
    // The firing began when its first step did.
    expect(history.runs[0]!.at).toBe(1000)
  })

  it('does not turn a ritual off because one morning had three steps in it', () => {
    // The whole reason the collapse exists. Three failing steps of one chain
    // is one bad morning, and GIVE_UP_AFTER is three *mornings*.
    const history = summarizeRitualRuns([
      run({ id: 'c', chainId: 'x', status: 'failed', createdAt: 3000 }),
      run({ id: 'b', chainId: 'x', status: 'failed', createdAt: 2000 }),
      run({ id: 'a', chainId: 'x', status: 'failed', createdAt: 1000 }),
    ])

    expect(history.failingStreak).toBe(1)
    expect(shouldGiveUp(history)).toBeNull()
  })

  it('still gives up after three bad mornings of chains', () => {
    const chain = (id: string, at: number) => [
      run({ id: `${id}b`, chainId: id, status: 'failed', createdAt: at + 1 }),
      run({ id: `${id}a`, chainId: id, status: 'completed', createdAt: at }),
    ]

    const history = summarizeRitualRuns([
      ...chain('z', 3000), ...chain('y', 2000), ...chain('x', 1000),
    ])

    expect(history.failingStreak).toBe(3)
    expect(shouldGiveUp(history)).not.toBeNull()
  })

  it('adds up what the whole firing cost', () => {
    const history = summarizeRitualRuns([
      run({ id: 'b', chainId: 'x', costUsd: 0.2, durationMs: 2000, createdAt: 2000 }),
      run({ id: 'a', chainId: 'x', costUsd: 0.3, durationMs: 1000, createdAt: 1000 }),
    ])

    expect(history.runs[0]!.costUsd).toBeCloseTo(0.5)
    expect(history.runs[0]!.durationMs).toBe(3000)
  })

  it('is identified by the step that decided it, not the last to report', () => {
    // A chain that came to nothing came to nothing somewhere in particular,
    // and that is the run worth opening.
    const history = summarizeRitualRuns([
      run({ id: 'c', chainId: 'x', status: 'completed', createdAt: 3000 }),
      run({ id: 'b', chainId: 'x', status: 'failed', createdAt: 2000, error: 'boom' }),
      run({ id: 'a', chainId: 'x', status: 'completed', createdAt: 1000 }),
    ])

    expect(history.runs[0]!.id).toBe('b')
    expect(history.runs[0]!.error).toBe('boom')
  })

  it('leaves runs that are not part of a chain alone', () => {
    const history = summarizeRitualRuns([
      run({ id: 'b', createdAt: 2000 }),
      run({ id: 'a', createdAt: 1000 }),
    ])

    expect(history.runs.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('keeps separate firings separate', () => {
    const history = summarizeRitualRuns([
      run({ id: 'y2', chainId: 'y', createdAt: 4000 }),
      run({ id: 'y1', chainId: 'y', createdAt: 3000 }),
      run({ id: 'x2', chainId: 'x', createdAt: 2000 }),
      run({ id: 'x1', chainId: 'x', createdAt: 1000 }),
    ])

    expect(history.runs).toHaveLength(2)
    // Newest firing first, as the list was.
    expect(history.runs.map(r => r.at)).toEqual([3000, 1000])
  })
})

describe('what the morning is told about a firing', () => {
  it('gathers what any step was refused, not just the deciding one', () => {
    // The digest offers to grant the rules a blocked run asked for. A rule
    // asked for by step one is still the rule that is needed, so losing it
    // would mean the offer never appears for the thing that actually blocked.
    const history = summarizeRitualRuns([
      run({
        id: 'b',
        chainId: 'x',
        createdAt: 2000,
        needsAttention: true,
        suggestedRules: ['Bash(gh:*)'],
      }),
      run({ id: 'a', chainId: 'x', createdAt: 1000, suggestedRules: ['Bash(git:*)'] }),
    ])

    expect(history.runs[0]!.outcome).toBe('blocked')
    expect(history.runs[0]!.suggestedRules?.sort()).toEqual(['Bash(gh:*)', 'Bash(git:*)'])
  })

  it('does not invent a refusal on a firing where nothing was refused', () => {
    const history = summarizeRitualRuns([
      run({ id: 'b', chainId: 'x', createdAt: 2000 }),
      run({ id: 'a', chainId: 'x', createdAt: 1000 }),
    ])

    expect(history.runs[0]!.outcome).toBe('ok')
    expect(history.runs[0]!.suggestedRules).toBeUndefined()
  })
})

describe('what a firing amounts to', () => {
  it('is still going while any step is', () => {
    expect(chainOutcome(['ok', 'running'])).toBe('running')
  })

  it('is the worst thing that happened, not the most recent', () => {
    expect(chainOutcome(['ok', 'failed', 'ok'])).toBe('failed')
    expect(chainOutcome(['ok', 'blocked'])).toBe('blocked')
  })

  it('is only ok when every step was', () => {
    expect(chainOutcome(['ok', 'ok', 'ok'])).toBe('ok')
  })

  it('counts a firing with nothing reported yet as running, never as a success', () => {
    expect(chainOutcome([])).toBe('running')
  })
})

describe('carrying on', () => {
  it('stops at the first step that did not work', () => {
    // Verifying a fix that failed is a way to spend money confirming it.
    expect(shouldContinue('ok')).toBe(true)
    expect(shouldContinue('failed')).toBe(false)
    expect(shouldContinue('blocked')).toBe(false)
    expect(shouldContinue('stopped')).toBe(false)
  })
})

describe('what each step is told', () => {
  it('sends the instruction alone when there is nothing behind it', () => {
    const step = { title: 'Triage', input: 'Look at what came in.' }

    expect(chainPrompt(step, [])).toBe('Look at what came in.')
  })

  it('keeps the written instruction first and intact', () => {
    // The instruction somebody wrote has to still be the one that arrives.
    const prompt = chainPrompt(
      { title: 'Fix', input: 'Fix what triage found.' },
      [{ title: 'Triage', output: 'Two failing tests.' }],
    )

    expect(prompt.startsWith('Fix what triage found.')).toBe(true)
    expect(prompt).toContain('Two failing tests.')
  })

  it('puts the most recent step first, since it is the one that matters', () => {
    const prompt = chainPrompt(
      { title: 'Verify', input: 'Check it.' },
      [{ title: 'Triage', output: 'AAA' }, { title: 'Fix', output: 'BBB' }],
    )

    expect(prompt.indexOf('BBB')).toBeLessThan(prompt.indexOf('AAA'))
  })

  it('clips a step that printed a novel, and says it clipped it', () => {
    const prompt = chainPrompt(
      { title: 'Fix', input: 'Fix it.' },
      [{ title: 'Triage', output: 'x'.repeat(50_000) }],
    )

    expect(prompt.length).toBeLessThan(10_000)
    expect(prompt).toContain('…')
  })

  it('says how many earlier steps it could not show', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      title: `Step ${i}`,
      output: 'y'.repeat(2000),
    }))

    expect(chainPrompt({ title: 'Last', input: 'Go.' }, many)).toContain('not shown')
  })

  it('does not pretend a silent step said something', () => {
    expect(chainPrompt({ title: 'B', input: 'Go.' }, [{ title: 'A', output: '' }]))
      .toContain('produced no output')
  })
})

describe('naming the rows', () => {
  it('says which part of the ritual this row was', () => {
    expect(stepTitleFor('Nightly triage', { title: 'Fix', input: '' }, 1, 3))
      .toBe('Nightly triage · 2/3 Fix')
  })
})

describe('what comes out of the form', () => {
  it('treats a single step as a plain ritual', () => {
    // A chain of one is not a chain, and the rest of the app should never have
    // to ask whether it is.
    expect(normalizeSteps([{ title: 'Only', input: 'Do it.' }])).toBeUndefined()
  })

  it('drops steps with no instruction in them', () => {
    const steps = normalizeSteps([
      { title: 'Triage', input: 'Look.' },
      { title: 'Empty', input: '   ' },
      { title: 'Fix', input: 'Mend.' },
    ])

    expect(steps?.map(s => s.title)).toEqual(['Triage', 'Fix'])
  })

  it('names a step that was left unnamed', () => {
    const steps = normalizeSteps([
      { input: 'One.' },
      { input: 'Two.' },
    ])

    expect(steps?.map(s => s.title)).toEqual(['Step 1', 'Step 2'])
  })

  it('caps how long a chain may be, since every step is billed', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `S${i}`, input: 'go' }))

    expect(normalizeSteps(many)).toHaveLength(MAX_CHAIN_STEPS)
  })

  it('is undefined for anything that is not a list', () => {
    expect(normalizeSteps(undefined)).toBeUndefined()
    expect(normalizeSteps('nope')).toBeUndefined()
    expect(normalizeSteps([])).toBeUndefined()
  })
})
