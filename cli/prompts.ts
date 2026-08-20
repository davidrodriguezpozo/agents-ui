import { describeToolCall, presentVerb } from '~/utils/toolCalls'
import type { WallTile } from '~/utils/wall'
import type { Tone } from './format'

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
  prompt: Pick<QueuedPrompt, 'toolName' | 'input'>,
  root?: string,
  max = 12,
): PromptLine[] {
  const input = (prompt.input ?? {}) as Record<string, unknown>
  const lines: PromptLine[] = []

  const text = (key: string): string | null => {
    const value = input[key]
    return typeof value === 'string' && value.trim() ? value : null
  }

  const command = text('command')
  if (command) {
    for (const line of command.split('\n').slice(0, max)) lines.push({ text: line, tone: 'green' })
    const description = text('description')
    if (description) lines.push({ text: description, tone: 'gray' })
    return lines
  }

  const removed = text('old_string')
  const added = text('new_string') ?? text('content')
  if (removed || added) {
    const room = Math.max(2, Math.floor(max / (removed && added ? 2 : 1)))
    for (const line of (removed ?? '').split('\n').slice(0, room)) {
      if (removed) lines.push({ text: `- ${line}`, tone: 'red' })
    }
    for (const line of (added ?? '').split('\n').slice(0, room)) {
      if (added) lines.push({ text: `+ ${line}`, tone: 'green' })
    }
    return lines
  }

  const url = text('url')
  if (url) return [{ text: url, tone: 'green' }]

  const pattern = text('pattern') ?? text('query')
  if (pattern) return [{ text: pattern, tone: 'green' }]

  // Anything else: its own fields, which is more than the verb alone.
  for (const [key, value] of Object.entries(input).slice(0, max)) {
    if (value == null || typeof value === 'object') continue
    lines.push({ text: `${key}  ${String(value)}`, tone: 'gray' })
  }

  if (lines.length === 0) {
    lines.push({ text: describeToolCall({ toolName: prompt.toolName, input }, root).target || '—', tone: 'gray' })
  }

  return lines
}

/** `wants to run  gh pr create --fill`, for a heading. */
export function promptHeadline(
  prompt: Pick<QueuedPrompt, 'toolName' | 'input'>,
  root?: string,
): string {
  const { target } = describeToolCall({ toolName: prompt.toolName, input: prompt.input }, root)
  return `wants to ${presentVerb(prompt.toolName)}${target ? `  ${target}` : ''}`
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
