import { describe, expect, it } from 'vitest'
import { applyRunEvent, emptyRun } from '../runStream'
import { displayTurns, transcriptLines } from '../transcript'
import type { SessionDetail } from '../types'

function session(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 's1',
    title: 'Test',
    repoDir: '/repo',
    worktreePath: '/repo/.worktrees/s1',
    branch: 'feat/x',
    baseBranch: 'main',
    status: 'idle',
    runIds: ['r1'],
    createdAt: 1,
    updatedAt: 1,
    worktree: {
      path: '/repo/.worktrees/s1',
      exists: true,
      branch: 'feat/x',
      changedFiles: 0,
      dirty: false,
      ahead: 0,
      behind: 0,
    },
    activity: 'idle',
    pendingPermissions: 0,
    lastRunId: 'r1',
    turnCount: 1,
    inCurrentProject: true,
    turns: [{
      id: 'r1',
      input: 'Please look',
      output: 'Done.',
      status: 'completed',
      createdAt: 1,
      toolCalls: [{ id: 't1', toolName: 'Read', input: { file_path: '/repo/.worktrees/s1/src/a.ts' } }],
    }],
    checkCommand: null,
    ...over,
  }
}

describe('displayTurns', () => {
  it('replaces a recorded turn with the live run of the same id', () => {
    const live = applyRunEvent(emptyRun('r1'), { type: 'text', text: 'Streaming…' })
    const turns = displayTurns(session(), live)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.output).toBe('Streaming…')
    expect(turns[0]!.live).toBe(true)
  })

  it('appends a live run that the session has not recorded yet', () => {
    const live = applyRunEvent(emptyRun('r2'), { type: 'text', text: 'New' })
    const turns = displayTurns(session(), live, 'Do the next thing')
    expect(turns).toHaveLength(2)
    expect(turns[1]!.id).toBe('r2')
    expect(turns[1]!.input).toBe('Do the next thing')
    expect(turns[1]!.output).toBe('New')
  })
})

describe('transcriptLines', () => {
  it('wraps at width and labels each speaker', () => {
    const turns = displayTurns(session(), null)
    const lines = transcriptLines(turns, 24, { worktreeRoot: '/repo/.worktrees/s1' })
    const text = lines.map(l => l.text).join('\n')
    expect(text).toContain('you')
    expect(text).toContain('claude')
    expect(text).toContain('Please look')
    expect(text).toContain('Read')
    expect(lines.every(l => l.text.length <= 24)).toBe(true)
  })

  it('names the turn each line came from, so a pane can fold it', () => {
    const lines = transcriptLines(displayTurns(session(), null), 60)
    expect(lines.every(l => l.turn === 'r1')).toBe(true)
  })
})

describe('the steps of a turn', () => {
  const many = session({
    turns: [{
      id: 'r1',
      input: 'Go',
      output: 'Done.',
      status: 'completed',
      createdAt: 1,
      toolCalls: [
        { id: 't1', toolName: 'Read', input: { file_path: '/repo/.worktrees/s1/a.ts' } },
        { id: 't2', toolName: 'Read', input: { file_path: '/repo/.worktrees/s1/b.ts' } },
        { id: 't3', toolName: 'Bash', input: { command: 'bun test' } },
      ],
    }],
  })

  it('folds to one line, with a tally instead of the list', () => {
    const lines = transcriptLines(displayTurns(many, null), 60)
    const steps = lines.filter(l => l.kind === 'tool')
    expect(steps).toHaveLength(1)
    expect(steps[0]!.text).toContain('3 steps')
    expect(steps[0]!.text).toContain('Read ×2')
    expect(steps[0]!.text).not.toContain('bun test')
  })

  it('lists them once the turn is open', () => {
    const lines = transcriptLines(displayTurns(many, null), 60, { expanded: new Set(['r1']) })
    const steps = lines.filter(l => l.kind === 'tool')
    expect(steps).toHaveLength(4)
    expect(steps.map(l => l.text).join('\n')).toContain('bun test')
  })

  it('folds a running turn to the step it is on', () => {
    const live = applyRunEvent(
      applyRunEvent(emptyRun('r1'), { type: 'status', status: 'running' }),
      { type: 'tool_use', id: 't9', toolName: 'Bash', input: { command: 'bun run typecheck' } },
    )
    const lines = transcriptLines(displayTurns(many, live), 60)
    const steps = lines.filter(l => l.kind === 'tool')
    expect(steps).toHaveLength(1)
    expect(steps[0]!.text).toContain('bun run typecheck')
  })

  it('says so when a step failed, folded', () => {
    const failed = session({
      turns: [{
        id: 'r1',
        input: 'Go',
        output: '',
        status: 'completed',
        createdAt: 1,
        toolCalls: [{ id: 't1', toolName: 'Bash', input: { command: 'nope' }, isError: true }],
      }],
    })
    const line = transcriptLines(displayTurns(failed, null), 60).find(l => l.kind === 'tool')!
    expect(line.text).toContain('1 step')
    expect(line.text).toContain('1 failed')
    expect(line.tone).toBe('red')
  })
})

describe('what a live turn shows before it has an answer', () => {
  it('draws the thinking, and drops it once there is output', () => {
    const thinking = applyRunEvent(emptyRun('r2'), { type: 'thinking', text: 'The timer is fixed at 50ms' })
    const before = transcriptLines(displayTurns(session(), thinking, 'Look again'), 60)
    expect(before.map(l => l.text).join('\n')).toContain('50ms')

    const answered = applyRunEvent(thinking, { type: 'text', text: 'It waits on a fixed timer.' })
    const after = transcriptLines(displayTurns(session(), answered, 'Look again'), 60)
    const text = after.map(l => l.text).join('\n')
    expect(text).toContain('It waits on a fixed timer.')
    expect(text).not.toContain('50ms')
  })

  it('reports what a finished turn cost, and nothing while it runs', () => {
    const done = session({
      turns: [{
        id: 'r1',
        input: 'Go',
        output: 'Done.',
        status: 'completed',
        createdAt: 1_000,
        completedAt: 13_000,
        costUsd: 0.42,
      }],
    })
    expect(transcriptLines(displayTurns(done, null), 60).map(l => l.text).join('\n')).toContain('$0.42')

    const running = applyRunEvent(emptyRun('r1'), { type: 'status', status: 'running' })
    expect(transcriptLines(displayTurns(done, running), 60).map(l => l.text).join('\n')).not.toContain('$0.42')
  })
})
