import { describe, expect, it, vi } from 'vitest'
import { compactQuestions, parseQuestions, withAnswers } from '../server/utils/askUserQuestion'
import { answerPermission, createPermissionBroker, type PermissionRequest } from '../server/utils/permissionBroker'

/**
 * A question reaches a person and their answer reaches the agent.
 *
 * The bug this covers had no error in it: `AskUserQuestion` arrived at
 * `canUseTool` like any other tool, was allowed like any other tool, and the
 * tool then reported "The user did not answer the questions." — so every
 * session that stopped to ask something was told, in effect, that there was
 * nobody there. The answers only travel one way, inside the allowed tool
 * input, which is why the assertions here are about `updatedInput`.
 */

function questionInput(overrides: Record<string, unknown> = {}) {
  return {
    questions: [
      {
        question: 'Which test runner?',
        header: 'Runner',
        multiSelect: false,
        options: [
          { label: 'vitest', description: 'Already in the repo' },
          { label: 'jest', description: 'Slower here' },
        ],
      },
    ],
    ...overrides,
  }
}

/** The parts of the SDK's `canUseTool` context this code actually reads. */
function context(overrides: Record<string, unknown> = {}) {
  return {
    signal: new AbortController().signal,
    toolUseID: 'toolu_1',
    ...overrides,
  } as unknown as Parameters<ReturnType<typeof createPermissionBroker>['canUseTool']>[2]
}

describe('parseQuestions', () => {
  it('reads the questions, their options and their headers', () => {
    const [question] = parseQuestions(questionInput())

    expect(question).toEqual({
      question: 'Which test runner?',
      header: 'Runner',
      multiSelect: false,
      options: [
        { label: 'vitest', description: 'Already in the repo' },
        { label: 'jest', description: 'Slower here' },
      ],
    })
  })

  it('keeps a preview, which is the option a person has to look at to choose', () => {
    const [question] = parseQuestions({
      questions: [{
        question: 'Which layout?',
        header: 'Layout',
        multiSelect: false,
        options: [
          { label: 'Split', description: 'Two columns', preview: '<div>mock</div>' },
          { label: 'Stacked', description: 'One column' },
        ],
      }],
    })

    expect(question!.options[0]!.preview).toBe('<div>mock</div>')
    expect(question!.options[1]!.preview).toBeUndefined()
  })

  it('says nothing about an input that is not a question', () => {
    expect(parseQuestions({ command: 'ls' })).toEqual([])
    expect(parseQuestions(null)).toEqual([])
    expect(parseQuestions('questions')).toEqual([])
    expect(parseQuestions({ questions: 'two' })).toEqual([])
  })

  /**
   * A dialog with nothing to choose is worse than a permission prompt, because
   * there is no button on it that answers the question. Dropped, so the caller
   * falls back to allow/deny.
   */
  it('drops a question with no usable options', () => {
    expect(parseQuestions({ questions: [{ question: 'Well?', options: [] }] })).toEqual([])
    expect(parseQuestions({ questions: [{ question: 'Well?', options: [{ description: 'no label' }] }] })).toEqual([])
    expect(parseQuestions({ questions: [{ options: [{ label: 'a' }, { label: 'b' }] }] })).toEqual([])
  })

  it('drops a repeat of a question already asked, because the text is the key', () => {
    const questions = parseQuestions({
      questions: [
        { question: 'Which?', options: [{ label: 'a' }, { label: 'b' }] },
        { question: 'Which?', options: [{ label: 'c' }, { label: 'd' }] },
      ],
    })

    expect(questions).toHaveLength(1)
    expect(questions[0]!.options.map(o => o.label)).toEqual(['a', 'b'])
  })
})

describe('withAnswers', () => {
  it('writes the answers into the input, keyed by the question', () => {
    const input = withAnswers(questionInput(), { 'Which test runner?': ['vitest'] })

    expect(input.answers).toEqual({ 'Which test runner?': 'vitest' })
    // The questions go back untouched: the CLI reports them alongside the answer.
    expect(input.questions).toEqual(questionInput().questions)
  })

  it('joins a multi-select answer the way the tool reads it', () => {
    const input = withAnswers(questionInput(), { 'Which test runner?': ['vitest', 'jest'] })

    expect(input.answers).toEqual({ 'Which test runner?': 'vitest, jest' })
  })

  it('takes text nobody chose from a list, because the tool takes any string', () => {
    const input = withAnswers(questionInput(), { 'Which test runner?': ['neither, use node:test'] })

    expect(input.answers).toEqual({ 'Which test runner?': 'neither, use node:test' })
  })

  it('ignores an answer to a question that was not asked', () => {
    const input = withAnswers(questionInput(), {
      'Which test runner?': ['vitest'],
      'Which package manager?': ['pnpm'],
    })

    expect(input.answers).toEqual({ 'Which test runner?': 'vitest' })
  })

  /** Which is the CLI's own encoding of a skip — see the broker's answer path. */
  it('leaves the answers off entirely when nothing was answered', () => {
    expect(withAnswers(questionInput(), {})).not.toHaveProperty('answers')
    expect(withAnswers(questionInput(), { 'Which test runner?': ['  '] })).not.toHaveProperty('answers')
  })

  it('sends back the preview of what was chosen, without being handed it', () => {
    const input = {
      questions: [{
        question: 'Which layout?',
        header: 'Layout',
        multiSelect: false,
        options: [
          { label: 'Split', description: 'Two columns', preview: '<div>mock</div>' },
          { label: 'Stacked', description: 'One column' },
        ],
      }],
    }

    expect(withAnswers(input, { 'Which layout?': ['Split'] }).annotations)
      .toEqual({ 'Which layout?': { preview: '<div>mock</div>' } })
    expect(withAnswers(input, { 'Which layout?': ['Stacked'] })).not.toHaveProperty('annotations')
  })
})

describe('a question through the broker', () => {
  function ask(input: Record<string, unknown> = questionInput(), ctx = context()) {
    const requests: PermissionRequest[] = []
    const broker = createPermissionBroker({
      ownerId: `q-${Math.random().toString(36).slice(2)}`,
      onRequest: request => requests.push(request),
    })
    const result = broker.canUseTool('AskUserQuestion', input, ctx)
    return { requests, result, broker }
  }

  it('arrives as a request carrying its questions', () => {
    const { requests } = ask()

    expect(requests).toHaveLength(1)
    expect(requests[0]!.questions?.[0]?.question).toBe('Which test runner?')
  })

  /**
   * "Always allow AskUserQuestion" would buy the right to be asked without
   * being asked, which is not a thing anyone means to grant — so the offer is
   * never made, whatever the CLI suggested alongside it.
   */
  it('is never rememberable, even when the CLI suggested a rule', () => {
    const { requests } = ask(questionInput(), context({
      suggestions: [{ type: 'addRules', rules: [{ toolName: 'AskUserQuestion' }], behavior: 'allow', destination: 'session' }],
    }))

    expect(requests[0]!.canRemember).toBe(false)
    expect(requests[0]!.suggestedRules).toEqual([])
  })

  it('lets an answer through to the tool input', async () => {
    const { requests, result } = ask()

    expect(answerPermission(requests[0]!.id, {
      behavior: 'allow',
      answers: { 'Which test runner?': ['vitest'] },
    })).toBe(true)

    expect(await result).toEqual({
      behavior: 'allow',
      updatedInput: { ...questionInput(), answers: { 'Which test runner?': 'vitest' } },
    })
  })

  /**
   * Skipping is answering: allowed with nothing in it is how the CLI hears that
   * nobody answered, which leaves the agent free to decide and say what it
   * assumed. A denial would hand it an error instead.
   */
  it('sends an empty allow when the question is skipped', async () => {
    const { requests, result } = ask()

    answerPermission(requests[0]!.id, { behavior: 'allow' })

    expect(await result).toEqual({ behavior: 'allow', updatedInput: questionInput() })
  })

  it('never turns an answer into a permission rule, however it was asked to', async () => {
    const { requests, result } = ask(questionInput(), context({
      suggestions: [{ type: 'addRules', rules: [{ toolName: 'AskUserQuestion' }], behavior: 'allow', destination: 'session' }],
    }))

    // What the UI cannot offer, a hand-written request still should not get.
    answerPermission(requests[0]!.id, {
      behavior: 'allow',
      scope: 'session',
      answers: { 'Which test runner?': ['vitest'] },
    })

    expect(await result).not.toHaveProperty('updatedPermissions')
  })

  it('waits an hour for an answer, not the ten minutes a permission waits', async () => {
    vi.useFakeTimers()
    try {
      const requests: PermissionRequest[] = []
      const broker = createPermissionBroker({
        ownerId: 'q-timeout',
        onRequest: request => requests.push(request),
      })
      const question = broker.canUseTool('AskUserQuestion', questionInput(), context())
      const permission = broker.canUseTool('Bash', { command: 'ls' }, context())

      vi.advanceTimersByTime(11 * 60_000)
      expect(await permission).toMatchObject({ behavior: 'deny' })
      // Still waiting, where the permission beside it has already been denied.
      expect(broker.hasPending()).toBe(true)

      vi.advanceTimersByTime(50 * 60_000)
      expect(await question).toMatchObject({
        behavior: 'deny',
        message: expect.stringContaining('Nobody answered your question within 60 minutes'),
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('compactQuestions', () => {
  it('drops previews, which are mockups and belong to the session view', () => {
    const compacted = compactQuestions(parseQuestions({
      questions: [{
        question: 'Which layout?',
        header: 'Layout',
        multiSelect: true,
        options: [{ label: 'Split', description: 'Two columns', preview: 'x'.repeat(5_000) }],
      }],
    }))

    expect(compacted[0]!.options[0]).toEqual({ label: 'Split', description: 'Two columns' })
    expect(compacted[0]!.multiSelect).toBe(true)
  })
})
