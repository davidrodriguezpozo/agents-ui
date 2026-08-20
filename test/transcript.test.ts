import { describe, expect, it } from 'vitest'
import { applyRunEvent, emptyRun } from '../cli/runStream'
import { displayTurns, transcriptLines } from '../cli/transcript'
import type { SessionDetail } from '../cli/types'

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
    const lines = transcriptLines(turns, 24, '/repo/.worktrees/s1')
    const text = lines.map(l => l.text).join('\n')
    expect(text).toContain('you')
    expect(text).toContain('claude')
    expect(text).toContain('Please look')
    expect(text).toContain('Read')
    expect(lines.every(l => l.text.length <= 24)).toBe(true)
  })
})
