import { describe, expect, it } from 'vitest'
import { compactInput, toolCallsFromEvents } from '../server/utils/turnActivity'
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
