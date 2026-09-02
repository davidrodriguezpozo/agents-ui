import { describeToolCall, presentVerb } from '~/utils/toolCalls'
import type { WallTile } from '~/utils/wall'
import type { QuestionPrompt } from './types'
import { plain, type Tone } from './format'

/**
 * The prompts waiting on a person, as a queue you can work through.
 *
 * With several agents running, permission prompts arrive as a stream, and
 * answering one meant being in the right view on the right row. The queue is the
 * thing a terminal is genuinely better at than a tab: `git add -p` for
 * permissions — one key from anywhere, then one decision at a time until there
 * are none left.
 *
 * The wall already reports every prompt on the machine, across projects, which
 * is exactly the scope this wants: being blocked somewhere else is still being
 * blocked.
 */

/**
 * A prompt, in the shape both sources agree on.
 *
 * The wall reports every prompt on the machine and the run stream reports the
 * ones for a session you have open; the two records are not the same type, but
 * everything a person weighs is in both.
 */
export interface QueuedPrompt {
  id: string
  toolName: string
  input: Record<string, unknown>
  /** Whether "allow for the rest of this run" is a meaningful answer. */
  canRemember: boolean
  /**
   * Set when the agent asked a question rather than asking to use a tool. A
   * terminal is a good place to answer one — the options are numbered and the
   * answer is a digit — but they are not the same question: `y` in front of a
   * permission means "allow it", and in front of a question it means "send what
   * I picked". See `server/utils/askUserQuestion`.
   */
  questions?: QuestionPrompt[]
}

/** What has been picked so far, per question. Empty until a digit is pressed. */
export type Picked = Record<string, string[]>

export function isQuestion(prompt: Pick<QueuedPrompt, 'questions'>): boolean {
  return Boolean(prompt.questions?.length)
}

/**
 * Every option in the prompt, numbered once across all of its questions.
 *
 * Numbered flat rather than per question because the number *is* the key, and a
 * key has to reach the thing it names: per-question numbering needs a cursor to
 * say which question a `2` belongs to, and then answering the second question
 * puts the first one out of reach of the keyboard. Nine is where the digits run
 * out, so anything past that is shown without a number rather than given a key
 * that does not exist — a prompt that large is one to answer in the browser.
 */
export function numberedOptions(questions: QuestionPrompt[]): {
  question: QuestionPrompt
  label: string
  description: string
  /** Its digit, or null past the ninth option. */
  digit: number | null
}[] {
  const flat = questions.flatMap(question => question.options.map(option => ({
    question,
    label: option.label,
    description: option.description,
    digit: null as number | null,
  })))

  return flat.map((entry, i) => ({ ...entry, digit: i < 9 ? i + 1 : null }))
}

/**
 * A digit pressed in front of a question. Out of range is ignored rather than
 * guessed at, and on a multi-select it toggles, because the whole point of a
 * multi-select is that the second press is not a correction of the first.
 */
export function pickOption(questions: QuestionPrompt[], picked: Picked, digit: number): Picked {
  const entry = numberedOptions(questions).find(option => option.digit === digit)
  if (!entry) return picked

  const { question, label } = entry
  const current = picked[question.question] ?? []
  const next = question.multiSelect
    ? current.includes(label) ? current.filter(l => l !== label) : [...current, label]
    : current.includes(label) ? [] : [label]

  return { ...picked, [question.question]: next }
}

/** Only the questions that got an answer; the rest are left unanswered on purpose. */
export function answersFrom(picked: Picked): Picked {
  return Object.fromEntries(Object.entries(picked).filter(([, values]) => values.length))
}

/**
 * The questions, their options numbered, and what is picked so far.
 *
 * A line reading `2  Spaces` is both the option and the instruction for
 * choosing it, which is the whole reason a terminal can answer one of these in
 * a keystroke.
 */
export function questionLines(questions: QuestionPrompt[], picked: Picked): PromptLine[] {
  const numbered = numberedOptions(questions)
  const lines: PromptLine[] = []

  for (const question of questions) {
    const chosen = picked[question.question] ?? []
    lines.push({
      text: plain(`${question.question}${question.multiSelect ? '  [pick any]' : ''}`),
      tone: 'cyan',
    })
    for (const option of numbered.filter(entry => entry.question === question)) {
      const taken = chosen.includes(option.label)
      lines.push({
        text: plain(`  ${taken ? '●' : '○'} ${option.digit ?? '·'}  ${option.label}${
          option.description ? `  — ${option.description}` : ''
        }`),
        tone: taken ? 'green' : undefined,
      })
    }
  }

  return lines
}

export interface Waiting {
  prompt: QueuedPrompt
  sessionId: string
  runId?: string
  title: string
  repo: string
  branch: string
}

export function waitingPrompts(tiles: WallTile[], answered: string[] = []): Waiting[] {
  const done = new Set(answered)
  const queue: (Waiting & { at: number })[] = []

  for (const tile of tiles) {
    for (const prompt of tile.prompts) {
      if (done.has(prompt.id)) continue
      queue.push({
        prompt,
        sessionId: tile.sessionId,
        runId: tile.runId,
        title: tile.title,
        repo: tile.repo,
        branch: tile.branch,
        at: prompt.at,
      })
    }
  }

  // Oldest first: the agent that has been blocked longest has been blocked
  // longest, and answering newest-first is how one ends up waiting all morning.
  return queue.sort((a, b) => a.at - b.at)
}

export interface PromptLine {
  text: string
  tone?: Tone
}

/**
 * What it wants to do, in enough detail to decide without opening the session.
 *
 * A verb and a path is enough for a read; it is not enough for an edit, and
 * "allow this?" with no sight of what would be written is the question this
 * queue exists to stop asking. So each tool shows the part of its input that a
 * person would actually weigh — the command, the patch, the URL — and anything
 * unrecognised falls back to its fields rather than to nothing.
 */
export function promptDetail(
  prompt: Pick<QueuedPrompt, 'toolName' | 'input' | 'questions'>,
  root?: string,
  max = 12,
  picked: Picked = {},
): PromptLine[] {
  // A question's arguments are the question: there is no command to show and no
  // patch to weigh, so the options are the detail.
  if (prompt.questions?.length) return questionLines(prompt.questions, picked).slice(0, max)

  const input = (prompt.input ?? {}) as Record<string, unknown>
  const lines: PromptLine[] = []

  const text = (key: string): string | null => {
    const value = input[key]
    return typeof value === 'string' && value.trim() ? value : null
  }

  const command = text('command')
  if (command) {
    for (const line of plain(command).split('\n').slice(0, max)) lines.push({ text: line, tone: 'green' })
    const description = text('description')
    if (description) lines.push({ text: description, tone: 'gray' })
    return lines
  }

  const removed = text('old_string')
  const added = text('new_string') ?? text('content')
  if (removed || added) {
    const room = Math.max(2, Math.floor(max / (removed && added ? 2 : 1)))
    for (const line of plain(removed ?? '').split('\n').slice(0, room)) {
      if (removed) lines.push({ text: `- ${line}`, tone: 'red' })
    }
    for (const line of plain(added ?? '').split('\n').slice(0, room)) {
      if (added) lines.push({ text: `+ ${line}`, tone: 'green' })
    }
    return lines
  }

  const url = text('url')
  if (url) return [{ text: plain(url), tone: 'green' }]

  const pattern = text('pattern') ?? text('query')
  if (pattern) return [{ text: plain(pattern), tone: 'green' }]

  // Anything else: its own fields, which is more than the verb alone.
  for (const [key, value] of Object.entries(input).slice(0, max)) {
    if (value == null || typeof value === 'object') continue
    lines.push({ text: plain(`${key}  ${String(value)}`), tone: 'gray' })
  }

  if (lines.length === 0) {
    lines.push({ text: describeToolCall({ toolName: prompt.toolName, input }, root).target || '—', tone: 'gray' })
  }

  return lines
}

/** `wants to run  gh pr create --fill`, for a heading. */
export function promptHeadline(
  prompt: Pick<QueuedPrompt, 'toolName' | 'input' | 'questions'>,
  root?: string,
): string {
  // The questions are on the lines below, so the headline says only that this
  // is one — `wants to use AskUserQuestion` is the sentence this replaces.
  if (prompt.questions?.length) {
    return plain(prompt.questions.length > 1
      ? `wants to ask you ${prompt.questions.length} things`
      : 'wants to ask you something')
  }

  const { target } = describeToolCall({ toolName: prompt.toolName, input: prompt.input }, root)
  // Built from the tool's own input, which is to say from somewhere else.
  return plain(`wants to ${presentVerb(prompt.toolName)}${target ? `  ${target}` : ''}`)
}

/**
 * Whether answering this one can safely be remembered for the run.
 *
 * The broker says so per prompt, and it is the difference between `a` being an
 * offer and `a` being a lie.
 */
export function canRemember(prompt: Pick<QueuedPrompt, 'canRemember'>): boolean {
  return Boolean(prompt.canRemember)
}
