import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The format that crosses a machine boundary.
 *
 * Everything else in this app reads records written by the same version of the
 * same code on the same disk. These lines are written by a colleague, on a
 * version that may be newer, and read into a page — so the three cases that
 * matter are not the happy one: a line nobody can parse, a line from a format
 * this reader does not know, and a batch appended twice because the collector
 * covers overlapping windows. Each of those has to have a defined, boring
 * answer, and none of them may quietly change a total.
 */

let claudeDir: string
let ledger: typeof import('../server/utils/sharedLedger')

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-ledger-cfg-'))
  process.env.CLAUDE_DIR = claudeDir

  ledger = await import('../server/utils/sharedLedger')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
})

function turn(id: string, at: number, costUsd?: number, person?: string) {
  return { v: 1, id: `turn:${id}`, event: 'turn' as const, at, ...(costUsd ? { costUsd } : {}), ...(person ? { person } : {}) }
}

describe('a line', () => {
  it('carries only the fields this format names', () => {
    // The guard against a session title reaching another person's browser: the
    // serialiser takes named fields, so adding one upstream cannot leak it.
    const line = ledger.ledgerLine({
      ...turn('a', 1000, 1.5, 'ada@example.com'),
      // @ts-expect-error — exactly the mistake this is here to survive.
      title: 'refactor the billing module',
      sessionId: 's1',
    })

    expect(JSON.parse(line)).toEqual({
      v: 1, at: 1000, event: 'turn', id: 'turn:a', costUsd: 1.5, person: 'ada@example.com', sessionId: 's1',
    })
    expect(line).not.toContain('billing')
  })

  it('reads back what it wrote', () => {
    const entry = { ...turn('a', 1000, 2), sessionId: 's1', landing: undefined }
    const parsed = ledger.parseLedgerLine(ledger.ledgerLine(entry))

    expect('entry' in parsed && parsed.entry).toMatchObject({ id: 'turn:a', at: 1000, costUsd: 2, sessionId: 's1' })
  })

  it('calls unparseable text corrupt rather than throwing', () => {
    expect(ledger.parseLedgerLine('{not json')).toEqual({ skip: 'corrupt' })
    expect(ledger.parseLedgerLine('[1,2,3]')).toEqual({ skip: 'corrupt' })
    expect(ledger.parseLedgerLine('"a string"')).toEqual({ skip: 'corrupt' })
  })

  it('calls a line from a newer format newer, not corrupt', () => {
    // A colleague who updated first. Their line is fine; this reader is behind.
    const line = JSON.stringify({ v: ledger.LEDGER_FORMAT + 1, at: 1, event: 'turn', id: 'turn:z' })

    expect(ledger.parseLedgerLine(line)).toEqual({ skip: 'newer' })
  })

  it('refuses a line whose cost is not a number, rather than counting it as free', () => {
    const line = JSON.stringify({ v: 1, at: 1, event: 'turn', id: 'turn:z', costUsd: 'lots' })

    expect(ledger.parseLedgerLine(line)).toEqual({ skip: 'corrupt' })
  })

  it('refuses a line with no id, which would make appending unrepeatable', () => {
    expect(ledger.parseLedgerLine(JSON.stringify({ v: 1, at: 1, event: 'turn' }))).toEqual({ skip: 'corrupt' })
  })
})

describe('reading a file', () => {
  it('counts what it could not read and keeps going', () => {
    const text = [
      ledger.ledgerLine(turn('a', 1)),
      '{ broken',
      JSON.stringify({ v: 99, at: 2, event: 'turn', id: 'turn:b' }),
      ledger.ledgerLine(turn('c', 3)),
      '',
    ].join('\n')

    const read = ledger.readLedgerText(text)

    expect(read.entries.map(e => e.id)).toEqual(['turn:a', 'turn:c'])
    expect(read.corrupt).toBe(1)
    expect(read.newer).toBe(1)
  })

  it('does not call the trailing newline a corrupt line', () => {
    expect(ledger.readLedgerText(`${ledger.ledgerLine(turn('a', 1))}\n`).corrupt).toBe(0)
  })
})

describe('appending', () => {
  it('is a no-op the second time, which is how often the collector runs', () => {
    const entries = [turn('a', 1, 1), turn('b', 2, 2)]

    const first = ledger.appendLedgerText('', entries)
    const second = ledger.appendLedgerText(first.text, entries)

    expect(first.added).toBe(2)
    expect(second.added).toBe(0)
    expect(second.skipped).toBe(2)
    expect(second.text).toBe(first.text)
  })

  it('skips a repeat inside one batch', () => {
    const { text, added } = ledger.appendLedgerText('', [turn('a', 1), turn('a', 1)])

    expect(added).toBe(1)
    expect(ledger.readLedgerText(text).entries).toHaveLength(1)
  })

  it('adds only what is new when the batch overlaps', () => {
    const first = ledger.appendLedgerText('', [turn('a', 1)])
    const second = ledger.appendLedgerText(first.text, [turn('a', 1), turn('b', 2)])

    expect(second.added).toBe(1)
    expect(ledger.readLedgerText(second.text).entries.map(e => e.id)).toEqual(['turn:a', 'turn:b'])
  })

  it('copies through lines it cannot read, which belong to whoever wrote them', () => {
    const existing = `{ broken\n${JSON.stringify({ v: 99, at: 1, event: 'turn', id: 'turn:z' })}\n`

    const { text } = ledger.appendLedgerText(existing, [turn('a', 1)])

    expect(text.startsWith(existing)).toBe(true)
    expect(ledger.readLedgerText(text)).toMatchObject({ corrupt: 1, newer: 1 })
  })

  it('does not run two lines together when the file has no trailing newline', () => {
    const existing = ledger.ledgerLine(turn('a', 1))

    const { text } = ledger.appendLedgerText(existing, [turn('b', 2)])

    expect(ledger.readLedgerText(text).entries).toHaveLength(2)
  })
})

describe('what an outcome window comes to', () => {
  const session = {
    id: 's1',
    landed: { at: 500, how: 'merged' as const, by: { name: 'Ada', email: 'Ada@Example.com' }, overrodeChecks: true },
    reverted: { at: 900, sha: 'abc', committedAt: 800, subject: 'Revert "x"', landedSha: 'def', branch: 'main' },
    check: { status: 'failing' as const, command: 'make check', fingerprint: 'f1', exitCode: 1, output: 'boom', durationMs: 5, at: 400 },
  }

  it('turns a session into a landing, a revert and a verdict', () => {
    const entries = ledger.ledgerEntriesOf({ turns: [], sessions: [session] })

    expect(entries.map(e => e.event)).toEqual(['landing', 'revert', 'check'])
    expect(entries[0]).toMatchObject({ id: 'landing:s1', landing: 'merged', person: 'ada@example.com', override: true })
    // When the work went back out, not when this machine noticed.
    expect(entries[1]).toMatchObject({ id: 'revert:s1', at: 800 })
    expect(entries[2]).toMatchObject({ event: 'check', verdict: 'failing' })
  })

  it('leaves a check that has no verdict about the code alone', () => {
    const running = { ...session, landed: undefined, reverted: undefined, check: { ...session.check, status: 'running' as const } }

    expect(ledger.ledgerEntriesOf({ turns: [], sessions: [running] })).toEqual([])
  })

  it('names the person by key, never by name', () => {
    const named = { ...session, landed: { at: 1, how: 'merged' as const, by: { name: 'Ada Lovelace' } } }
    const [landing] = ledger.ledgerEntriesOf({ turns: [], sessions: [named] })

    // No email configured, so the name is the key — and it is the whole of what
    // travels. `describePerson` is prose and prose does not go on the wire.
    expect(landing!.person).toBe('Ada Lovelace')
  })

  it('produces the same ids over an overlapping window, so nothing is appended twice', () => {
    const turns = [{ id: 'r1', createdAt: 1, startedAt: 2, costUsd: 1, source: 'session' as const, person: 'ada@example.com' }]

    const first = ledger.appendLedgerText('', ledger.ledgerEntriesOf({ turns, sessions: [session] }))
    const second = ledger.appendLedgerText(first.text, ledger.ledgerEntriesOf({ turns, sessions: [session] }))

    expect(second.added).toBe(0)
  })
})

describe('adding up two machines', () => {
  it('totals every file present, and each on its own', () => {
    const team = ledger.teamLedger([
      {
        machine: 'laptop-aa',
        text: [
          ledger.ledgerLine(turn('a', 100, 3, 'ada@example.com')),
          ledger.ledgerLine({ v: 1, id: 'landing:s1', event: 'landing', at: 200, landing: 'merged', person: 'ada@example.com' }),
        ].join('\n'),
      },
      {
        machine: 'desktop-bb',
        text: [
          ledger.ledgerLine(turn('b', 300, 2, 'grace@example.com')),
          // A ritual: real spend, nobody named.
          ledger.ledgerLine({ v: 1, id: 'turn:c', event: 'turn', at: 400, costUsd: 5, scheduleId: 'sch1' }),
          ledger.ledgerLine({ v: 1, id: 'revert:s2', event: 'revert', at: 500 }),
        ].join('\n'),
      },
    ])

    expect(team.totals).toMatchObject({ turns: 3, costUsd: 10, landings: 1, reverts: 1 })
    expect(team.machines.map(m => m.machine)).toEqual(['desktop-bb', 'laptop-aa'])
    expect(team.machines[0]).toMatchObject({ machine: 'desktop-bb', entries: 3, lastAt: 500 })
    expect(team.machines[1]).toMatchObject({ machine: 'laptop-aa', entries: 2, lastAt: 200 })
  })

  it('groups named people and leaves the unnamed spend out of that table', () => {
    const team = ledger.teamLedger([
      { machine: 'a', text: ledger.ledgerLine(turn('a', 1, 3, 'ada@example.com')) },
      { machine: 'b', text: ledger.ledgerLine({ v: 1, id: 'turn:b', event: 'turn', at: 2, costUsd: 5, scheduleId: 's' }) },
    ])

    expect(team.people).toEqual([{ person: 'ada@example.com', totals: expect.objectContaining({ costUsd: 3 }) }])
    expect(team.unattributedCostUsd).toBe(5)
    // The people column adds up to less than the total, always, and says so.
    expect(team.totals.costUsd).toBe(8)
  })

  it('reports a corrupt line per machine rather than hiding it in a total', () => {
    const team = ledger.teamLedger([{ machine: 'a', text: `{ broken\n${ledger.ledgerLine(turn('a', 1, 1))}` }])

    expect(team.machines[0]).toMatchObject({ corrupt: 1, entries: 1 })
    expect(team.totals.costUsd).toBe(1)
  })

  it('says how fresh each machine is instead of averaging over a gap', () => {
    const team = ledger.teamLedger([
      { machine: 'fresh', text: ledger.ledgerLine(turn('a', 9_000)) },
      { machine: 'stale', text: ledger.ledgerLine(turn('b', 1_000)) },
      { machine: 'empty', text: '' },
    ])

    expect(team.machines.map(m => [m.machine, m.lastAt])).toEqual([
      ['fresh', 9_000], ['stale', 1_000], ['empty', undefined],
    ])
  })

  it('honours a window without dropping the machine from the list', () => {
    const team = ledger.teamLedger(
      [{ machine: 'a', text: [ledger.ledgerLine(turn('old', 100, 4)), ledger.ledgerLine(turn('new', 900, 1))].join('\n') }],
      500,
    )

    expect(team.totals).toMatchObject({ turns: 1, costUsd: 1 })
    expect(team.machines[0]).toMatchObject({ machine: 'a', entries: 1 })
  })
})

describe('the file this instance owns', () => {
  it('slugs a hostname rather than trusting it as a path', () => {
    expect(ledger.machineSlug('Ada’s MacBook Pro (work)')).toBe('ada-s-macbook-pro-work')
    expect(ledger.machineSlug('../../etc/passwd')).toBe('etc-passwd')
    expect(ledger.machineSlug('!!!')).toBe('machine')
  })

  it('keeps the same id once it has one', async () => {
    const first = await ledger.machineId()
    const second = await ledger.machineId()

    expect(second).toBe(first)
  })

  it('appends to disk and reads back as one machine', async () => {
    await ledger.appendLocalLedger([turn('disk-a', 10, 1, 'ada@example.com')])
    const again = await ledger.appendLocalLedger([turn('disk-a', 10, 1, 'ada@example.com')])

    expect(again).toEqual({ added: 0, skipped: 1 })

    const files = await ledger.readLedgerFiles()
    expect(files).toHaveLength(1)
    expect(ledger.teamLedger(files).totals).toMatchObject({ turns: 1, costUsd: 1 })
  })

  it('reads a colleague file dropped in beside it', async () => {
    const machine = await ledger.machineId()
    await writeFile(
      join(ledger.ledgerDir(), 'colleague-zz.jsonl'),
      `${ledger.ledgerLine(turn('theirs', 20, 4, 'grace@example.com'))}\n`,
      'utf8',
    )

    const files = await ledger.readLedgerFiles()
    const team = ledger.teamLedger(files)

    expect(files.map(f => f.machine).sort()).toEqual(['colleague-zz', ledger.machineSlug(machine)].sort())
    expect(team.people.map(p => p.person).sort()).toEqual(['ada@example.com', 'grace@example.com'])
  })

  it('leaves anything that is not a ledger file alone', async () => {
    await writeFile(join(ledger.ledgerDir(), 'notes.txt'), 'not a ledger', 'utf8')

    expect((await ledger.readLedgerFiles()).every(f => !f.machine.includes('notes'))).toBe(true)
    // The id file itself is not a ledger file either.
    expect(await readFile(join(ledger.ledgerDir(), 'machine'), 'utf8')).toBeTruthy()
  })
})
