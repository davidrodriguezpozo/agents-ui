import { describeToolCall } from '~/utils/toolCalls'
import type { LiveRun } from './runStream'
import { isFinished } from './runStream'
import { toLines, type Tone } from './format'
import type { SessionDetail, SessionTurn, ToolCall } from './types'

/**
 * A session's conversation as the rows a pane can draw.
 *
 * The browser renders turns as components; a terminal has to know, before it
 * paints, how many lines there are and which of them are on screen. This is
 * that conversion: each turn becomes a labelled block, a live run replaces its
 * own recorded turn rather than appearing twice, and wrapping happens here so
 * scrolling stays honest.
 */

export type LineKind = 'rule' | 'text' | 'tool' | 'error' | 'blank' | 'dim'

export interface TranscriptLine {
  kind: LineKind
  text: string
  tone?: Tone
}

export interface DisplayTurn {
  id: string
  input: string
  output: string
  status: string
  error?: string
  toolCalls: ToolCall[]
  live: boolean
}

/**
 * The turns to show, with a live run folded in.
 *
 * A send is a POST that returns a run id, then a stream. The session record
 * catches up on the next poll, so for a moment the live run is not in
 * `session.turns`. Appending it covers that gap. Once it is recorded, the live
 * copy *replaces* that turn — output streaming in is the same turn, not a
 * second one underneath.
 */
export function displayTurns(
  session: Pick<SessionDetail, 'turns'>,
  live: LiveRun | null,
  pendingInput = '',
): DisplayTurn[] {
  const turns: DisplayTurn[] = session.turns.map(turn => fromRecorded(turn, live))

  if (live && !turns.some(turn => turn.id === live.id)) {
    const recorded = session.turns.find(turn => turn.id === live.id)
    turns.push({
      id: live.id,
      input: recorded?.input || pendingInput,
      output: live.output,
      status: live.status,
      error: live.error,
      toolCalls: live.toolCalls,
      live: true,
    })
  }

  return turns
}

function fromRecorded(turn: SessionTurn, live: LiveRun | null): DisplayTurn {
  if (live && live.id === turn.id) {
    return {
      id: turn.id,
      input: turn.input,
      output: live.output || turn.output,
      status: live.status,
      error: live.error || turn.error,
      toolCalls: live.toolCalls.length ? live.toolCalls : (turn.toolCalls ?? []),
      live: !isFinished(live.status),
    }
  }

  return {
    id: turn.id,
    input: turn.input,
    output: turn.output,
    status: turn.status,
    error: turn.error,
    toolCalls: turn.toolCalls ?? [],
    live: false,
  }
}

export function transcriptLines(
  turns: DisplayTurn[],
  width: number,
  worktreeRoot?: string,
): TranscriptLine[] {
  const lines: TranscriptLine[] = []

  for (const turn of turns) {
    if (lines.length) lines.push({ kind: 'blank', text: '' })

    pushRule(lines, 'you', width)
    pushWrapped(lines, turn.input.trim() || '(nothing sent)', width, 'text')

    lines.push({ kind: 'blank', text: '' })
    pushRule(lines, turn.live ? 'claude · working' : 'claude', width)

    for (const call of turn.toolCalls) {
      const described = describeToolCall(call, worktreeRoot)
      const target = described.target ? `  ${described.target}` : ''
      lines.push({
        kind: 'tool',
        text: truncateTo(described.verb.padEnd(8) + target, width),
        tone: call.isError ? 'red' : 'gray',
      })
    }

    if (turn.output.trim()) pushWrapped(lines, turn.output.trim(), width, 'text')
    if (turn.error) pushWrapped(lines, turn.error, width, 'error', 'red')
    if (turn.live && !turn.output.trim() && !turn.toolCalls.length && !turn.error) {
      lines.push({ kind: 'dim', text: '…', tone: 'gray' })
    }
  }

  return lines
}

function pushRule(lines: TranscriptLine[], label: string, width: number) {
  const body = `─ ${label} `
  lines.push({
    kind: 'rule',
    text: body + '─'.repeat(Math.max(0, width - body.length)),
    tone: 'gray',
  })
}

function pushWrapped(
  lines: TranscriptLine[],
  text: string,
  width: number,
  kind: LineKind,
  tone?: Tone,
) {
  for (const line of toLines(text, width)) {
    lines.push({ kind, text: line, tone })
  }
}

function truncateTo(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`
}
