import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCursorMapper, toolNameOf } from '../../server/utils/providers/cursor'
import type { ResolvedRunOptions } from '../../server/utils/runOptions'
import type { RunEvent } from '../../server/utils/runStore'

/**
 * The mapping, run against three real `cursor-agent` streams.
 *
 * The fixtures are recorded output, not hand-written: `cursor-stream-turn1` is a
 * read and an edit in a scratch repository, `cursor-stream-resumed` is a second
 * turn resumed by chat id with a shell call, and `cursor-stream-rejected` is a
 * run whose tool calls were refused by policy. Every assertion below is about
 * something the flag names would not have told us, which is the whole reason
 * the recording came before the adapter.
 */

const base: ResolvedRunOptions = {
  cwd: '/scratch/repo',
  permissionMode: 'acceptEdits',
  maxTurns: 10,
  loadSettings: true,
  plugins: [],
  systemAppend: '',
  agent: null,
  allowRules: [],
  additionalDirectories: [],
  sandbox: { enabled: false, allowedDomains: [] },
  unattended: false,
  effort: 'high',
  standingBrief: '',
}

type Emitted = Omit<RunEvent, 'seq' | 'at'>

function replay(fixture: string, options: ResolvedRunOptions = base) {
  const mapper = createCursorMapper(options)
  const events: Emitted[] = []
  const patched: Record<string, unknown> = {}

  const lines = readFileSync(join(__dirname, '..', 'fixtures', fixture), 'utf8')
    .split('\n')
    .filter(line => line.trim())

  for (const line of lines) {
    const { events: emitted, patch } = mapper.take(JSON.parse(line))
    events.push(...emitted)
    if (patch) Object.assign(patched, patch)
  }

  return { events, patched, complete: mapper.complete }
}

const textOf = (events: Emitted[]) =>
  events.filter(e => e.type === 'text').map(e => String(e.text)).join('')

describe('the recorded Cursor stream', () => {
  it('takes the chat id off the init line, which is what the next turn resumes with', () => {
    const { patched } = replay('cursor-stream-turn1.jsonl')
    expect(patched.sdkSessionId).toBe('57ab654c-7728-49fe-a740-0a7c59885454')
  })

  /**
   * The rule the recording existed to find. Cursor sends each finished block a
   * second time — once stamped with the `model_call_id` that produced it, and
   * once more with no timestamp at the end of the stream. Emitting every
   * `assistant` event tripled the answer, and nothing in `--help` says so.
   */
  it('streams each answer once, not three times', () => {
    const { events } = replay('cursor-stream-turn1.jsonl')

    expect(textOf(events)).toBe(
      'I\'ll read `numbers.txt` first, then append the line "four".'
      + '\n\nThe file has `one`, `two`, and `three`. I\'ll append `four` now.'
      + '\n\nDONE',
    )
  })

  /** A tool call is what separates one block of the answer from the next. */
  it('opens a paragraph where the answer resumes after a tool', () => {
    const { events } = replay('cursor-stream-turn1.jsonl')
    expect(textOf(events)).toContain('.\n\nThe file has')
  })

  it('maps a read and an edit to the tool names the rest of the app knows', () => {
    const { events } = replay('cursor-stream-turn1.jsonl')
    const calls = events.filter(e => e.type === 'tool_use')

    expect(calls.map(c => c.toolName)).toEqual(['Read', 'Edit'])
  })

  /**
   * Not cosmetic. `outcomes.ts` decides whether a turn changed any files by
   * looking for `Edit`/`Write` in the log, and `describeToolCall` renders a step
   * from `file_path`. Cursor says `path`, so without the translation a night of
   * real work counts as a night of reading and every row renders blank.
   */
  it('gives an edit a file_path, so the turn counts as having changed files', () => {
    const { events } = replay('cursor-stream-turn1.jsonl')
    const edit = events.find(e => e.type === 'tool_use' && e.toolName === 'Edit')

    expect((edit?.input as { file_path?: string }).file_path)
      .toBe('/scratch/repo/numbers.txt')
    // The original argument is still there — nothing about the call is lost.
    expect((edit?.input as { path?: string }).path).toBe('/scratch/repo/numbers.txt')
  })

  it('pairs each result with the call it belongs to', () => {
    const { events } = replay('cursor-stream-turn1.jsonl')
    const uses = events.filter(e => e.type === 'tool_use')
    const results = events.filter(e => e.type === 'tool_result')

    expect(results).toHaveLength(2)
    expect(results.map(r => r.id)).toEqual(uses.map(u => u.id))
    // The id arrives with a newline in it — two ids joined. A stray line break
    // would break a row of the log in half.
    for (const result of results) expect(String(result.id)).not.toContain('\n')
  })

  it('reads what a tool actually returned', () => {
    const { events } = replay('cursor-stream-turn1.jsonl')
    const [read] = events.filter(e => e.type === 'tool_result')

    expect(read!.isError).toBe(false)
    expect(String(read!.preview)).toContain('one\ntwo\nthree')
  })

  it('records the thinking as well as the answer', () => {
    const { events } = replay('cursor-stream-turn1.jsonl')
    const thinking = events.filter(e => e.type === 'thinking').map(e => String(e.text)).join('')

    expect(thinking).toContain('Reading numbers.txt now.')
    // Separate blocks, separated — the same rule the answer gets.
    expect(thinking).toContain('\n\nThe file currently contains')
  })

  it('ends with a result carrying the tokens, the duration and the final text', () => {
    const { events, patched, complete } = replay('cursor-stream-turn1.jsonl')
    const result = events.at(-1)!

    expect(complete).toBe(true)
    expect(result.type).toBe('result')
    expect(result.stats).toMatchObject({
      usage: { input: 18827, output: 312, cacheRead: 36992, cacheCreation: 0 },
      durationMs: 29634,
    })
    // The final result is authoritative, exactly as it is for Claude Code.
    expect(patched.output).toContain('DONE')
  })

  /**
   * Cursor reports no `total_cost_usd`, so this is zero and stays zero. A price
   * table multiplied by tokens would put a figure in the ledger that nobody
   * here can keep current — see `outcomes.ts`, which reads the capability and
   * says the cost is unreported rather than saying it was nothing.
   */
  it('leaves the cost at zero rather than inventing one from the tokens', () => {
    const { events } = replay('cursor-stream-turn1.jsonl')
    expect((events.at(-1)!.stats as { costUsd: number }).costUsd).toBe(0)
  })

  it('counts model calls as turns, which is the nearest thing Cursor reports', () => {
    const { events } = replay('cursor-stream-turn1.jsonl')
    expect((events.at(-1)!.stats as { numTurns: number }).numTurns).toBe(2)
  })
})

describe('a resumed Cursor turn', () => {
  it('keeps the same chat id, which is what makes it one conversation', () => {
    const { patched } = replay('cursor-stream-resumed.jsonl')
    expect(patched.sdkSessionId).toBe('57ab654c-7728-49fe-a740-0a7c59885454')
  })

  it('maps a shell call to Bash, with the command where the UI reads it', () => {
    const { events } = replay('cursor-stream-resumed.jsonl')
    const call = events.find(e => e.type === 'tool_use')

    expect(call!.toolName).toBe('Bash')
    expect((call!.input as { command?: string }).command).toBe('ls -la')
  })

  it('reads a shell result off stdout', () => {
    const { events } = replay('cursor-stream-resumed.jsonl')
    const result = events.find(e => e.type === 'tool_result')

    expect(result!.isError).toBe(false)
    expect(String(result!.preview)).toContain('numbers.txt')
  })
})

describe('a Cursor turn refused by policy', () => {
  /**
   * The second thing the recording found. A refusal is not an error result and
   * not a permission prompt — it is `result.rejected`, and the run still ends
   * `subtype: "success"`. Left uncounted, a turn that was allowed to do nothing
   * reads as a clean pass.
   */
  it('reports a rejection as a failed tool result, not a success', () => {
    const { events } = replay('cursor-stream-rejected.jsonl')
    const results = events.filter(e => e.type === 'tool_result')

    expect(results).toHaveLength(3)
    for (const result of results) expect(result.isError).toBe(true)
  })

  it('says why, because Cursor sends an empty reason', () => {
    const { events } = replay('cursor-stream-rejected.jsonl')
    const [first] = events.filter(e => e.type === 'tool_result')

    expect(String(first!.preview)).toContain('`date` was refused')
    expect(String(first!.preview)).toContain('cannot stop to ask')
  })

  it('flags the run, because nobody could have approved it', () => {
    const { patched } = replay('cursor-stream-rejected.jsonl')

    expect(patched.needsAttention).toBe(true)
    expect(patched.deniedTools).toEqual(['Bash'])
  })

  it('counts the refusals as the permission denials they are', () => {
    const { events } = replay('cursor-stream-rejected.jsonl')
    const stats = events.at(-1)!.stats as { permissionDenials: { toolName: string }[] }

    expect(stats.permissionDenials).toEqual([
      { toolName: 'Bash' }, { toolName: 'Bash' }, { toolName: 'Bash' },
    ])
  })
})

describe('tool names', () => {
  it('translates the ones the app has rules for', () => {
    expect(toolNameOf('shellToolCall')).toBe('Bash')
    expect(toolNameOf('readToolCall')).toBe('Read')
    expect(toolNameOf('editToolCall')).toBe('Edit')
    expect(toolNameOf('grepToolCall')).toBe('Grep')
  })

  /** An unknown tool renders as its own verb, which beats a wrong one. */
  it('leaves the rest readable rather than forcing a wrong name', () => {
    expect(toolNameOf('readLintsToolCall')).toBe('ReadLints')
    expect(toolNameOf('somethingNewToolCall')).toBe('SomethingNew')
  })
})
