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
  /**
   * Which turn drew this line.
   *
   * A pane that can fold a turn's steps needs to know which turn the reader is
   * looking at, and the only thing it has is the window of lines on screen.
   */
  turn?: string
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

export interface TranscriptOptions {
  worktreeRoot?: string
  /** The turns whose steps are open. Everything else shows the one-line fold. */
  expanded?: ReadonlySet<string>
}

export function transcriptLines(
  turns: DisplayTurn[],
  width: number,
  options: TranscriptOptions = {},
): TranscriptLine[] {
  const { worktreeRoot, expanded } = options
  const lines: TranscriptLine[] = []

  for (const turn of turns) {
    const from = lines.length

    if (lines.length) lines.push({ kind: 'blank', text: '' })

    pushRule(lines, 'you', width)
    pushWrapped(lines, turn.input.trim() || '(nothing sent)', width, 'text')

    lines.push({ kind: 'blank', text: '' })
    pushRule(lines, turn.live ? 'claude · working' : 'claude', width)

    pushToolCalls(lines, turn, width, worktreeRoot, Boolean(expanded?.has(turn.id)))

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

    // Whose lines these are, decided once rather than passed to every push.
    for (let at = from; at < lines.length; at++) lines[at]!.turn = turn.id
  }

  return lines
}

/**
 * What it did, as one line you can open.
 *
 * A turn is often thirty tool calls long, and thirty lines of `Read …/a.ts` is
 * the transcript: the answer underneath them is off the bottom of the screen
 * and the reasoning above them is off the top. Toning the colour down made them
 * quieter without making them shorter. So they arrive folded — a count, and
 * enough of a summary to know whether opening it is worth it.
 *
 * A live turn folds to what it is doing *now* rather than to a tally, because
 * while a run is going that line is the only sign it is moving.
 */
function pushToolCalls(
  lines: TranscriptLine[],
  turn: DisplayTurn,
  width: number,
  worktreeRoot: string | undefined,
  open: boolean,
) {
  const calls = turn.toolCalls
  if (!calls.length) return

  const steps = calls.map(call => ({ call, ...describeToolCall(call, worktreeRoot) }))
  const failed = calls.filter(call => call.isError).length
  const parts = [
    `${calls.length} step${calls.length === 1 ? '' : 's'}`,
    open ? '' : turn.live ? latest(steps) : tally(steps),
    failed ? `${failed} failed` : '',
  ].filter(Boolean)

  lines.push({
    kind: 'tool',
    text: truncateTo(`${open ? '▾' : '▸'} ${parts.join(' · ')}`, width),
    tone: failed ? 'red' : 'gray',
  })

  if (!open) return

  // One column, as wide as the widest verb in this turn rather than a number
  // picked once: `Searched for` is twelve characters and used to shove its
  // target out of line with every `Read` above it.
  const column = Math.min(14, Math.max(...steps.map(step => step.verb.length)))

  for (const step of steps) {
    const target = step.target ? `  ${step.target}` : ''
    lines.push({
      kind: 'tool',
      text: truncateTo(`  ${step.verb.padEnd(column)}${target}`, width),
      tone: step.call.isError ? 'red' : 'gray',
    })
  }
}

interface Step {
  verb: string
  target: string
}

/**
 * `Read ×4 · Searched · Edited` — what the turn spent its steps on.
 *
 * The verbs lose their preposition here: `describeToolCall` writes them to sit
 * in front of a target, and "Searched for ·" with nothing after it reads as a
 * line that got cut off.
 */
function tally(steps: Step[]): string {
  const counts = new Map<string, number>()
  for (const step of steps) {
    const verb = step.verb.replace(/ (for|at|in)$/, '')
    counts.set(verb, (counts.get(verb) ?? 0) + 1)
  }
  return [...counts]
    .map(([verb, count]) => (count === 1 ? verb : `${verb} ×${count}`))
    .join(' · ')
}

/** The step it is on, which is the one worth showing while it runs. */
function latest(steps: Step[]): string {
  const step = steps[steps.length - 1]!
  return [step.verb, step.target].filter(Boolean).join(' ')
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
