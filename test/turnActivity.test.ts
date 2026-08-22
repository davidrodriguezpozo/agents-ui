import { describe, expect, it } from 'vitest'
import {
  compactInput, latestStep, recentSteps, steersFromEvents, toolCallsFromEvents,
} from '../server/utils/turnActivity'
import type { RunEvent } from '../server/utils/runStore'

/**
 * A turn's steps live in its event log, which is also where a `Write` keeps the
 * entire new contents of a file. Recovering the first without shipping the
 * second is the whole job here.
 */

function event(patch: Partial<RunEvent> & { type: RunEvent['type'] }): RunEvent {
  return { seq: 0, at: 0, ...patch } as RunEvent
}

describe('trimming a step\'s arguments', () => {
  it('keeps what a description needs', () => {
    expect(compactInput({ file_path: '/repo/a.ts', limit: 20, all: true }))
      .toEqual({ file_path: '/repo/a.ts', limit: 20, all: true })
  })

  it('truncates a value long enough to be a file', () => {
    const { content } = compactInput({ content: 'x'.repeat(5_000) }) as { content: string }

    expect(content.length).toBeLessThan(250)
    expect(content.endsWith('…')).toBe(true)
  })

  it('drops nested structures, which never describe a step', () => {
    expect(compactInput({ edits: [{ old: 'a' }], file_path: '/a.ts' })).toEqual({ file_path: '/a.ts' })
  })

  it('copes with arguments that are not an object at all', () => {
    expect(compactInput('nope')).toEqual({})
    expect(compactInput(null)).toEqual({})
    expect(compactInput(['a'])).toEqual({})
  })
})

describe('recovering the steps', () => {
  it('pairs each result with the call it belongs to', () => {
    const calls = toolCallsFromEvents([
      event({ type: 'tool_use', id: 't1', toolName: 'Read', input: { file_path: '/a.ts' } }),
      event({ type: 'tool_use', id: 't2', toolName: 'Bash', input: { command: 'ls' } }),
      event({ type: 'tool_result', id: 't2', preview: 'a.ts b.ts', isError: false }),
      event({ type: 'tool_result', id: 't1', preview: '40 lines', isError: false }),
    ])

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ toolName: 'Read', result: '40 lines' })
    expect(calls[1]).toMatchObject({ toolName: 'Bash', result: 'a.ts b.ts' })
  })

  it('keeps the order the turn did things in', () => {
    const calls = toolCallsFromEvents([
      event({ type: 'tool_use', id: 'a', toolName: 'Grep', input: {} }),
      event({ type: 'tool_use', id: 'b', toolName: 'Edit', input: {} }),
    ])

    expect(calls.map(c => c.toolName)).toEqual(['Grep', 'Edit'])
  })

  it('carries a failure through', () => {
    const calls = toolCallsFromEvents([
      event({ type: 'tool_use', id: 't1', toolName: 'Bash', input: { command: 'gh issue edit' } }),
      event({ type: 'tool_result', id: 't1', preview: 'permission denied', isError: true }),
    ])

    expect(calls[0]).toMatchObject({ isError: true, result: 'permission denied' })
  })

  it('caps a turn that read half the repository', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      event({ type: 'tool_use', id: `t${i}`, toolName: 'Read', input: { file_path: `/f${i}.ts` } }))

    expect(toolCallsFromEvents(many).length).toBeLessThanOrEqual(60)
  })

  it('ignores a result whose call was capped away', () => {
    const events = [
      ...Array.from({ length: 70 }, (_, i) =>
        event({ type: 'tool_use', id: `t${i}`, toolName: 'Read', input: {} })),
      event({ type: 'tool_result', id: 't69', preview: 'late', isError: false }),
    ]

    expect(() => toolCallsFromEvents(events)).not.toThrow()
    expect(toolCallsFromEvents(events).some(c => c.result === 'late')).toBe(false)
  })

  it('has nothing to say about a turn with no events', () => {
    expect(toolCallsFromEvents([])).toEqual([])
    expect(toolCallsFromEvents()).toEqual([])
  })
})

/**
 * A steered message is not another turn, and the transcript has to be able to
 * say so. Where it landed is the fact that explains the rest of the turn, and the
 * event log is the only place it survives.
 */
describe('recovering what was said into a turn while it ran', () => {
  it('counts the steps that had already happened', () => {
    const steers = steersFromEvents([
      event({ type: 'tool_use', id: 't0', toolName: 'Read', input: {} }),
      event({ type: 'tool_use', id: 't1', toolName: 'Read', input: {} }),
      event({ type: 'steer', text: 'not that file', at: 500 }),
      event({ type: 'tool_use', id: 't2', toolName: 'Edit', input: {} }),
      event({ type: 'steer', text: 'the other one', at: 900 }),
    ])

    expect(steers).toEqual([
      { text: 'not that file', at: 500, afterSteps: 2 },
      { text: 'the other one', at: 900, afterSteps: 3 },
    ])
  })

  it('places one that arrived before the turn used a tool at all', () => {
    expect(steersFromEvents([event({ type: 'steer', text: 'wait', at: 10 })]))
      .toEqual([{ text: 'wait', at: 10, afterSteps: 0 }])
  })

  it('has nothing to say about a turn nobody steered', () => {
    expect(steersFromEvents([event({ type: 'tool_use', id: 't', toolName: 'Read', input: {} })]))
      .toEqual([])
    expect(steersFromEvents()).toEqual([])
  })
})

/**
 * The live counterpart, read from the end of the log rather than the start. It
 * feeds the wall's "what is it doing" line and its ticker, which are the two
 * things on that screen that have to be true *this second*.
 */
describe('reading a running turn from the end', () => {
  const log = [
    event({ type: 'status', status: 'running' }),
    event({ type: 'tool_use', id: 't0', toolName: 'Read', input: { file_path: '/repo/a.ts' }, at: 100 }),
    event({ type: 'text', text: 'thinking about it' }),
    event({ type: 'tool_use', id: 't1', toolName: 'Edit', input: { file_path: '/repo/b.ts' }, at: 200 }),
    event({ type: 'tool_use', id: 't2', toolName: 'Bash', input: { command: 'bun run test' }, at: 300 }),
  ]

  it('gives the newest step first', () => {
    expect(recentSteps(log, 2)).toEqual([
      { toolName: 'Bash', input: { command: 'bun run test' }, at: 300 },
      { toolName: 'Edit', input: { file_path: '/repo/b.ts' }, at: 200 },
    ])
  })

  it('stops as soon as it has enough, however long the log is', () => {
    const long = [...Array(400)].map((_, i) =>
      event({ type: 'tool_use', id: `t${i}`, toolName: 'Read', input: { file_path: `/repo/${i}.ts` }, at: i }))

    expect(recentSteps(long, 3).map(s => s.at)).toEqual([399, 398, 397])
  })

  it('reports the step in flight rather than waiting for its result', () => {
    // The call with no result yet is the one worth showing; waiting for it would
    // mean always naming the step before the current one.
    expect(latestStep(log)).toEqual({ toolName: 'Bash', input: { command: 'bun run test' }, at: 300 })
  })

  it('trims arguments the same way a finished turn does', () => {
    const write = [event({ type: 'tool_use', id: 'w', toolName: 'Write', input: { file_path: '/repo/c.ts', content: 'x'.repeat(5_000) }, at: 1 })]
    const { content } = latestStep(write)!.input as { content: string }

    expect(content.length).toBeLessThan(250)
  })

  it('is empty for a turn that has not used a tool yet', () => {
    expect(latestStep([event({ type: 'status', status: 'running' })])).toBeNull()
    expect(recentSteps([], 5)).toEqual([])
  })

  it('names an unnamed tool rather than dropping the step', () => {
    expect(latestStep([event({ type: 'tool_use', id: 'x', input: {}, at: 5 })])!.toolName).toBe('tool')
  })
})
