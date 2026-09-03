import { describe, expect, it } from 'vitest'
import {
  answersFrom,
  canRemember,
  isQuestion,
  numberedOptions,
  pickOption,
  promptDetail,
  promptHeadline,
  questionLines,
  waitingPrompts,
  type QueuedPrompt,
} from '../prompts'

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

function prompt(over: Partial<QueuedPrompt & { at: number }> = {}): QueuedPrompt & { at: number } {
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

/**
 * A question in the terminal.
 *
 * It arrives in the same queue as a permission — see
 * `server/utils/askUserQuestion` — and the queue is a good place to answer one:
 * the options are numbered, so the answer is a digit. What it must not do is
 * offer `y  allow once`, which sends no answer at all and tells the agent
 * nobody was there.
 */
function asking(over: Partial<QueuedPrompt & { at: number }> = {}): QueuedPrompt & { at: number } {
  return {
    id: 'q1',
    toolName: 'AskUserQuestion',
    input: {},
    canRemember: false,
    at: 100,
    questions: [
      {
        question: 'Tabs or spaces?',
        header: 'Indent',
        multiSelect: false,
        options: [
          { label: 'Tabs', description: 'Wider' },
          { label: 'Spaces', description: 'Narrower' },
        ],
      },
      {
        question: 'Which linters?',
        header: 'Linters',
        multiSelect: true,
        options: [
          { label: 'eslint', description: '' },
          { label: 'biome', description: '' },
        ],
      },
    ],
    ...over,
  }
}

describe('a question in the queue', () => {
  it('is told apart from a permission', () => {
    expect(isQuestion(asking())).toBe(true)
    expect(isQuestion(prompt())).toBe(false)
  })

  it('says it is a question rather than naming the tool', () => {
    expect(promptHeadline(asking())).toBe('wants to ask you 2 things')
    expect(promptHeadline(asking({ questions: asking().questions!.slice(0, 1) }))).toBe('wants to ask you something')
  })

  it('numbers every option once across the whole prompt, because the number is the key', () => {
    const lines = questionLines(asking().questions!, {})

    expect(lines.map(line => line.text)).toEqual([
      'Tabs or spaces?',
      '  ○ 1  Tabs  — Wider',
      '  ○ 2  Spaces  — Narrower',
      'Which linters?  [pick any]',
      '  ○ 3  eslint',
      '  ○ 4  biome',
    ])
  })

  it('marks what has been picked', () => {
    const lines = questionLines(asking().questions!, { 'Tabs or spaces?': ['Spaces'] })

    expect(lines[2]!.text).toBe('  ● 2  Spaces  — Narrower')
    expect(lines[2]!.tone).toBe('green')
  })

  /**
   * Ten options across four questions is a prompt to answer in the browser. The
   * ones past the digits are shown without one rather than given a key that
   * would do nothing.
   */
  it('stops numbering where the digits run out', () => {
    const many = Array.from({ length: 3 }, (_, q) => ({
      question: `Q${q}?`,
      header: 'H',
      multiSelect: false,
      options: Array.from({ length: 4 }, (_, o) => ({ label: `q${q}o${o}`, description: '' })),
    }))
    const numbered = numberedOptions(many)

    expect(numbered.filter(option => option.digit !== null)).toHaveLength(9)
    expect(numbered[9]!.digit).toBeNull()
    expect(questionLines(many, {}).some(line => line.text.includes('· '))).toBe(true)
  })

  it('sends a digit to the option that carries it, whichever question that is', () => {
    const questions = asking().questions!

    expect(pickOption(questions, {}, 2)).toEqual({ 'Tabs or spaces?': ['Spaces'] })
    expect(pickOption(questions, { 'Tabs or spaces?': ['Spaces'] }, 3))
      .toEqual({ 'Tabs or spaces?': ['Spaces'], 'Which linters?': ['eslint'] })
  })

  /**
   * The point of a flat numbering: the first question is still reachable after
   * the second has been answered, which a per-question cursor could not do.
   */
  it('lets an answer be corrected after the next question is answered', () => {
    const questions = asking().questions!
    const both = { 'Tabs or spaces?': ['Spaces'], 'Which linters?': ['eslint'] }

    expect(pickOption(questions, both, 1)['Tabs or spaces?']).toEqual(['Tabs'])
  })

  it('toggles on a multi-select and replaces on a single one', () => {
    const questions = asking().questions!

    // The same digit twice on a single-select clears it.
    expect(pickOption(questions, { 'Tabs or spaces?': ['Tabs'] }, 1)['Tabs or spaces?']).toEqual([])
    // Two digits on a multi-select keep both.
    const one = pickOption(questions, {}, 3)
    expect(pickOption(questions, one, 4)['Which linters?']).toEqual(['eslint', 'biome'])
    expect(pickOption(questions, one, 3)['Which linters?']).toEqual([])
  })

  it('ignores a digit with no option behind it', () => {
    const questions = asking().questions!
    expect(pickOption(questions, {}, 7)).toEqual({})
  })

  it('sends only the questions that were answered', () => {
    expect(answersFrom({ 'Tabs or spaces?': ['Tabs'], 'Which linters?': [] }))
      .toEqual({ 'Tabs or spaces?': ['Tabs'] })
  })

  it('shows the question as the prompt detail, since there is no command to weigh', () => {
    const lines = promptDetail(asking(), undefined, 12, { 'Tabs or spaces?': ['Tabs'] })
    expect(lines[1]!.text).toBe('  ● 1  Tabs  — Wider')
  })
})
