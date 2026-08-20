import { describeToolCall } from '~/utils/toolCalls'
import { formatCost, formatDuration } from '~/utils/time'
import type { LiveRun } from './runStream'
import { isFinished } from './runStream'
import { plain, toLines, type Tone } from './format'
import { markdownLines, type Span } from './markdown'
import type { RunStats, SessionDetail, SessionTurn, ToolCall } from './types'

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
  /**
   * The line as styled pieces, when it came from Markdown.
   *
   * `text` is still the whole line, so anything measuring or matching on it —
   * scroll arithmetic, tests — does not have to know about the styling.
   */
  spans?: Span[]
}

export interface DisplayTurn {
  id: string
  input: string
  output: string
  status: string
  error?: string
  toolCalls: ToolCall[]
  live: boolean
  /**
   * What it is reasoning about, while that is all there is.
   *
   * The stream carries this and the terminal was folding it and throwing it
   * away, so a turn that had been thinking for thirty seconds showed a single
   * dim ellipsis. It is the only thing on screen that says the run is doing
   * something rather than stuck.
   */
  thinking?: string
  /** What the turn cost and how long it took, once it has finished. */
  stats?: RunStats
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
      thinking: live.thinking,
      stats: live.stats,
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
      thinking: live.thinking,
      stats: live.stats ?? statsOf(turn),
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
    stats: statsOf(turn),
  }
}

function statsOf(turn: SessionTurn): RunStats | undefined {
  if (turn.costUsd == null && !turn.completedAt) return undefined
  return {
    costUsd: turn.costUsd,
    durationMs: turn.completedAt ? turn.completedAt - turn.createdAt : undefined,
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

    /*
     * Rendered rather than printed. Everything an agent writes is Markdown, and
     * a pane that shows the punctuation instead of the point is the harder thing
     * to read — a review with six `###` sections and forty backticked
     * identifiers is genuinely worse as source than as prose.
     */
    if (turn.output.trim()) {
      for (const line of markdownLines(turn.output.trim(), width)) {
        lines.push({ kind: 'text', text: line.text, spans: line.spans })
      }
    }
    if (turn.error) pushWrapped(lines, turn.error, width, 'error', 'red')

    // Thinking is shown only while it is the whole story. Once there is an
    // answer, the reasoning that led to it is noise above it.
    if (turn.live && !turn.output.trim() && turn.thinking?.trim()) {
      pushWrapped(lines, tail(turn.thinking.trim(), 400), width, 'dim', 'gray')
    } else if (turn.live && !turn.output.trim() && !turn.toolCalls.length && !turn.error) {
      lines.push({ kind: 'dim', text: '…', tone: 'gray' })
    }

    const summary = statsLine(turn)
    if (summary) lines.push({ kind: 'dim', text: truncateTo(summary, width), tone: 'gray' })
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

/** The last of a long thought, which is the part that is still relevant. */
function tail(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - max)}`
}

/**
 * What the turn cost, in the same words the browser uses.
 *
 * Only for turns that have finished: a running cost that updates every frame
 * reads as a meter rather than as a fact.
 */
function statsLine(turn: DisplayTurn): string | null {
  if (turn.live || !turn.stats) return null
  const parts = [formatCost(turn.stats.costUsd), formatDuration(turn.stats.durationMs)].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function truncateTo(text: string, width: number): string {
  const safe = plain(text).replace(/[\n\t]+/g, ' ')
  if (width <= 0) return ''
  if (safe.length <= width) return safe
  return width <= 1 ? safe.slice(0, width) : `${safe.slice(0, width - 1)}…`
}
