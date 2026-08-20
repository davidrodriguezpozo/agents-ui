import { describe, expect, it } from 'vitest'
import { applyRunEvent, emptyRun, isFinished } from '../cli/runStream'
import type { PermissionRequest } from '../cli/types'

describe('applyRunEvent', () => {
  it('folds a recorded stream into output, tools and a finished status', () => {
    const events: Record<string, unknown>[] = [
      { type: 'status', status: 'running', seq: 0 },
      { type: 'text', text: 'Hello ', seq: 1 },
      { type: 'tool_use', id: 't1', toolName: 'Read', input: { file_path: '/a.ts' }, seq: 2 },
      { type: 'tool_result', id: 't1', preview: 'ok', isError: false, seq: 3 },
      { type: 'text', text: 'world', seq: 4 },
      { type: 'result', text: 'Hello world', stats: { costUsd: 0.02 }, seq: 5 },
      { type: 'done', status: 'completed', seq: 6 },
    ]

    const run = events.reduce(applyRunEvent, emptyRun('r1'))
    expect(run.output).toBe('Hello world')
    expect(run.status).toBe('completed')
    expect(run.toolCalls).toEqual([
      { id: 't1', toolName: 'Read', input: { file_path: '/a.ts' }, result: 'ok', isError: false },
    ])
    expect(run.stats).toEqual({ costUsd: 0.02 })
    expect(run.lastSeq).toBe(6)
    expect(isFinished(run.status)).toBe(true)
  })

  it('replays from lastSeq without duplicating a permission prompt', () => {
    const request: PermissionRequest = {
      id: 'p1',
      ownerId: 'r1',
      toolName: 'Bash',
      input: { command: 'ls' },
      canRemember: true,
      suggestedRules: ['Bash(ls:*)'],
      createdAt: 1,
    }

    let run = emptyRun('r1')
    run = applyRunEvent(run, { type: 'permission_request', request, seq: 3 })
    run = applyRunEvent(run, { type: 'text', text: 'working', seq: 4 })
    expect(run.prompts).toHaveLength(1)
    expect(run.lastSeq).toBe(4)

    // A reconnect that replays from after=4 still receives the earlier prompt
    // if the client asked from -1; the reducer must not stack it.
    run = applyRunEvent(run, { type: 'permission_request', request, seq: 3 })
    expect(run.prompts).toHaveLength(1)

    run = applyRunEvent(run, { type: 'permission_resolved', id: 'p1', seq: 5 })
    expect(run.prompts).toHaveLength(0)
  })

  it('clears outstanding prompts when the run is done', () => {
    const request: PermissionRequest = {
      id: 'p1',
      ownerId: 'r1',
      toolName: 'Bash',
      input: {},
      canRemember: false,
      suggestedRules: [],
      createdAt: 1,
    }
    let run = applyRunEvent(emptyRun('r1'), { type: 'permission_request', request })
    run = applyRunEvent(run, { type: 'done', status: 'failed' })
    expect(run.prompts).toHaveLength(0)
    expect(run.status).toBe('failed')
  })
})
