import { describe, expect, it } from 'vitest'
import { canRemember, promptDetail, promptHeadline, waitingPrompts } from '../prompts'

function tile(over: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    title: 'Fix the flaky test',
    repo: 'agents-ui',
    branch: 'feat/flaky',
    runId: 'r1',
    activity: 'awaiting-permission',
    prompts: [],
    pending: 0,
    turns: 1,
    updatedAt: 10,
    ...over,
  } as never
}

function prompt(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    toolName: 'Bash',
    input: { command: 'gh pr create --fill' },
    canRemember: true,
    at: 100,
    ...over,
  }
}

describe('waitingPrompts', () => {
  it('collects every prompt on the machine, oldest first', () => {
    const queue = waitingPrompts([
      tile({ prompts: [prompt({ id: 'late', at: 300 })] }),
      tile({ sessionId: 's2', title: 'Other', prompts: [prompt({ id: 'early', at: 100 })] }),
    ])

    expect(queue.map(item => item.prompt.id)).toEqual(['early', 'late'])
    // Being blocked in another checkout is still being blocked, so the queue
    // carries which session each one came from.
    expect(queue[0]!.title).toBe('Other')
    expect(queue[0]!.sessionId).toBe('s2')
  })

  it('drops the ones already answered, so an answer is not asked twice', () => {
    const tiles = [tile({ prompts: [prompt({ id: 'a' }), prompt({ id: 'b', at: 200 })] })]
    expect(waitingPrompts(tiles, ['a']).map(item => item.prompt.id)).toEqual(['b'])
    expect(waitingPrompts(tiles, ['a', 'b'])).toEqual([])
  })
})

describe('promptDetail', () => {
  it('shows a command in full, because that is what you are agreeing to', () => {
    const lines = promptDetail(prompt())
    expect(lines[0]!.text).toBe('gh pr create --fill')
    expect(lines[0]!.tone).toBe('green')
  })

  it('shows an edit as the lines it would write', () => {
    const lines = promptDetail({
      toolName: 'Edit',
      input: { file_path: '/repo/a.ts', old_string: 'const x = 1', new_string: 'const x = 2' },
    })
    expect(lines.map(line => line.text)).toEqual(['- const x = 1', '+ const x = 2'])
    expect(lines[0]!.tone).toBe('red')
    expect(lines[1]!.tone).toBe('green')
  })

  it('shows what a write would contain', () => {
    const lines = promptDetail({ toolName: 'Write', input: { file_path: '/a', content: 'hello\nthere' } })
    expect(lines.map(line => line.text)).toEqual(['+ hello', '+ there'])
  })

  it('falls back to a tool’s own fields rather than to nothing', () => {
    const lines = promptDetail({ toolName: 'Weird', input: { depth: 3, mode: 'quick' } })
    expect(lines.map(line => line.text)).toEqual(['depth  3', 'mode  quick'])
  })

  it('never says nothing at all', () => {
    expect(promptDetail({ toolName: 'Read', input: {} })).toHaveLength(1)
  })

  it('keeps a long command inside the room it was given', () => {
    const long = { toolName: 'Bash', input: { command: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') } }
    expect(promptDetail(long, undefined, 5)).toHaveLength(5)
  })
})

describe('promptHeadline', () => {
  it('reads as a sentence about what it wants', () => {
    expect(promptHeadline(prompt())).toContain('wants to run')
  })
})

describe('canRemember', () => {
  it('is the broker’s answer, so `a` is an offer rather than a lie', () => {
    expect(canRemember(prompt())).toBe(true)
    expect(canRemember(prompt({ canRemember: false }))).toBe(false)
  })
})
