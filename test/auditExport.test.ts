import { describe, expect, it } from 'vitest'
import {
  AUDIT_EXCLUSIONS,
  AUDIT_FORMAT,
  auditFilename,
  auditLines,
  filesTouched,
  sourceOf,
  toJsonl,
  type AuditInput,
  type AuditMergeLine,
  type AuditRun,
  type AuditRunLine,
  type AuditSession,
} from '../server/utils/auditExport'

/**
 * The file a sceptical reader gets.
 *
 * Which makes the interesting tests the ones about honesty rather than about
 * shape: a run with no cost recorded must not report as free, a run from before
 * identity existed must not report as anonymous-but-known, a merge taken over a
 * red check must be findable by grepping one word, and everything deliberately
 * left out must be named in the file rather than simply missing.
 */

const NOW = 1_700_000_000_000
const DAY = 86_400_000

function input(over: Partial<AuditInput> = {}): AuditInput {
  return {
    since: NOW - 7 * DAY,
    until: NOW,
    now: NOW,
    runs: [],
    sessions: [],
    transcriptsAt: '/home/me/.claude/projects',
    ...over,
  }
}

function run(over: Partial<AuditRun> = {}): AuditRun {
  return {
    id: 'r1',
    kind: 'command',
    createdAt: NOW - DAY,
    startedAt: NOW - DAY + 1000,
    endedAt: NOW - DAY + 6000,
    status: 'completed',
    by: { name: 'Ada', email: 'Ada@Example.com' },
    stats: { costUsd: 1.25, model: 'claude-opus-5' },
    ...over,
  }
}

function landed(over: Partial<NonNullable<AuditSession['landed']>> = {}): AuditSession {
  return {
    id: 's1',
    repoDir: '/w/webapp',
    check: { status: 'passing' },
    landed: { at: NOW - DAY, how: 'merged', into: 'main', sha: 'abc123', by: { email: 'ada@example.com' }, ...over },
  }
}

const runs = (lines: ReturnType<typeof auditLines>) => lines.filter(l => l.type === 'run') as AuditRunLine[]
const merges = (lines: ReturnType<typeof auditLines>) => lines.filter(l => l.type === 'merge') as AuditMergeLine[]

describe('the header', () => {
  it('is the first line, and says which format this is', () => {
    const [first] = auditLines(input())

    expect(first).toMatchObject({ type: 'header', format: AUDIT_FORMAT })
  })

  it('names everything deliberately left out, with a reason each', () => {
    const [header] = auditLines(input())

    expect(header?.type === 'header' && header.excluded).toEqual(AUDIT_EXCLUSIONS)
    expect(AUDIT_EXCLUSIONS.map(e => e.field)).toContain('run.input')
    expect(AUDIT_EXCLUSIONS.every(e => e.why.length > 20)).toBe(true)
  })

  it('says where the transcripts are rather than embedding them', () => {
    const [header] = auditLines(input())

    expect(header?.type === 'header' && header.transcripts).toEqual({
      embedded: false,
      where: '/home/me/.claude/projects',
    })
  })

  it('counts its own gaps, so a reader does not have to notice them', () => {
    const lines = auditLines(input({
      runs: [
        run({ id: 'named' }),
        run({ id: 'old', by: undefined, stats: {} }),
      ],
      sessions: [landed({ by: undefined, sha: undefined })],
    }))
    const [header] = lines

    expect(header?.type === 'header' && header.nulls).toMatchObject({
      runsWithoutPerson: 1,
      runsWithoutModel: 1,
      runsWithoutCost: 1,
      mergesWithoutPerson: 1,
      mergesWithoutCommit: 1,
    })
    // A governance file where most rows have no person is the thing a sceptic
    // trusts least, so the file explains what a null means rather than leaving
    // it to be discovered.
    expect(header?.type === 'header' && header.nulls.note).toContain('never held')
  })

  it('counts what is in the file', () => {
    const [header] = auditLines(input({ runs: [run()], sessions: [landed()] }))

    expect(header?.type === 'header' && header.counts).toEqual({ runs: 1, merges: 1 })
  })
})

describe('an empty window', () => {
  it('is a header and nothing else, not an empty file', () => {
    const lines = auditLines(input())

    // A zero-byte file is indistinguishable from a failed export.
    expect(lines).toHaveLength(1)
    expect(toJsonl(lines).trim().split('\n')).toHaveLength(1)
  })

  it('excludes anything outside the window at both ends', () => {
    const lines = auditLines(input({
      runs: [run({ id: 'old', createdAt: NOW - 30 * DAY, startedAt: NOW - 30 * DAY })],
      sessions: [landed({ at: NOW + DAY })],
    }))

    expect(runs(lines)).toEqual([])
    expect(merges(lines)).toEqual([])
  })
})

describe('a run', () => {
  it('carries what it cost, who asked and how long it took', () => {
    const [line] = runs(auditLines(input({ runs: [run()] })))

    expect(line).toMatchObject({
      id: 'r1',
      who: 'ada@example.com',
      model: 'claude-opus-5',
      costUsd: 1.25,
      outcome: 'completed',
      durationMs: 5000,
    })
  })

  it('reports no cost as null, because a run with none recorded was not free', () => {
    const [line] = runs(auditLines(input({ runs: [run({ stats: { model: 'claude-opus-5' } })] })))

    expect(line!.costUsd).toBeNull()
    expect(line!.costUsd).not.toBe(0)
  })

  it('reports nobody as null on a run from before identity existed', () => {
    const [line] = runs(auditLines(input({ runs: [run({ by: undefined })] })))

    expect(line!.who).toBeNull()
  })

  it('tells the repository apart from the workspace it ran in', () => {
    // A session runs in its own worktree. Reporting only that would mean a
    // reader grepping for the repository misses every session run there was.
    const [line] = runs(auditLines(input({
      runs: [run({ projectDir: '/w/webapp/.worktrees/abc123' })],
    })))

    expect(line).toMatchObject({
      repo: '/w/webapp',
      workspace: '/w/webapp/.worktrees/abc123',
    })
  })

  it('names the source it came from', () => {
    expect(sourceOf(run({ scheduleId: 'sch1' }))).toBe('ritual')
    // A command somebody invoked is not an unknown, which is the one word an
    // audit file must not use about a thing that happened.
    expect(sourceOf(run({ kind: 'command' }))).toBe('command')
    expect(sourceOf(run({ sessionId: 's1' }))).toBe('session')
    expect(sourceOf(run({ kind: 'chat' }))).toBe('chat')
    expect(sourceOf(run({ kind: 'agent' }))).toBe('agent')
    expect(sourceOf(run({ invocation: 'workflow:nightly' }))).toBe('workflow')
    // A ritual's run is a ritual even when it also belongs to a session.
    expect(sourceOf(run({ scheduleId: 'sch1', sessionId: 's1' }))).toBe('ritual')
  })

  it('lists what the sandbox refused and what nobody was there to approve', () => {
    const [line] = runs(auditLines(input({
      runs: [run({ refusedHosts: ['b.example', 'a.example', 'a.example'], deniedTools: ['Bash(gh:*)'] })],
    })))

    expect(line!.hostsRefused).toEqual(['a.example', 'b.example'])
    expect(line!.toolsDenied).toEqual(['Bash(gh:*)'])
  })

  it('says when a limit cut it short, so it does not read as a finished job', () => {
    const [line] = runs(auditLines(input({ runs: [run({ stoppedBy: 'budget' })] })))

    expect(line!.stoppedBy).toBe('budget')
  })

  it('is ordered oldest first', () => {
    const lines = runs(auditLines(input({
      runs: [
        run({ id: 'late', createdAt: NOW - DAY, startedAt: NOW - DAY }),
        run({ id: 'early', createdAt: NOW - 3 * DAY, startedAt: NOW - 3 * DAY }),
      ],
    })))

    expect(lines.map(l => l.id)).toEqual(['early', 'late'])
  })
})

describe('the files a run touched', () => {
  it('reads them off the tool calls', () => {
    const files = filesTouched([
      { seq: 1, at: 1, type: 'tool_use', id: 't1', toolName: 'Write', input: { file_path: '/w/a.ts' } },
      { seq: 2, at: 2, type: 'tool_use', id: 't2', toolName: 'Edit', input: { file_path: '/w/b.ts' } },
      { seq: 3, at: 3, type: 'tool_use', id: 't3', toolName: 'Read', input: { file_path: '/w/c.ts' } },
    ])

    // Read is not a write.
    expect(files).toEqual(['/w/a.ts', '/w/b.ts'])
  })

  it('drops an edit whose result came back an error, because it did not happen', () => {
    const files = filesTouched([
      { seq: 1, at: 1, type: 'tool_use', id: 't1', toolName: 'Edit', input: { file_path: '/w/a.ts' } },
      { seq: 2, at: 2, type: 'tool_result', id: 't1', isError: true },
    ])

    expect(files).toEqual([])
  })

  it('counts a file once however often it was written', () => {
    const files = filesTouched([
      { seq: 1, at: 1, type: 'tool_use', id: 't1', toolName: 'Edit', input: { file_path: '/w/a.ts' } },
      { seq: 2, at: 2, type: 'tool_use', id: 't2', toolName: 'Edit', input: { file_path: '/w/a.ts' } },
    ])

    expect(files).toEqual(['/w/a.ts'])
  })

  it('says how many it left out rather than truncating silently', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      seq: i, at: i, type: 'tool_use' as const, id: `t${i}`, toolName: 'Write',
      input: { file_path: `/w/f${String(i).padStart(3, '0')}.ts` },
    }))

    const [line] = runs(auditLines(input({ runs: [run({ events: many })] })))

    expect(line!.files).toHaveLength(50)
    expect(line!.filesOmitted).toBe(10)
  })
})

describe('a merge', () => {
  it('records the route, the verdict and who took it', () => {
    const [line] = merges(auditLines(input({ sessions: [landed()] })))

    expect(line).toMatchObject({
      sessionId: 's1',
      route: 'merged',
      checks: 'passing',
      override: false,
      who: 'ada@example.com',
      sha: 'abc123',
      into: 'main',
    })
  })

  it('is findable by one word when it went in over a failing check', () => {
    const lines = auditLines(input({
      sessions: [{
        ...landed({ overrodeChecks: true }),
        check: { status: 'failing' },
      }],
    }))

    const [line] = merges(lines)
    expect(line).toMatchObject({ override: true, checks: 'failing' })

    // The point of the file: one grep finds every one of them.
    expect(toJsonl(lines).split('\n').filter(l => l.includes('"override":true'))).toHaveLength(1)
  })

  it('says `none` when no verdict was ever recorded, rather than implying one', () => {
    const [line] = merges(auditLines(input({ sessions: [{ ...landed(), check: null }] })))

    expect(line!.checks).toBe('none')
  })

  it('names nobody for a merge that happened on github.com', () => {
    // `elsewhere` is a merge this machine only noticed. Stamping it with whoever
    // was here would be claiming a colleague's merge.
    const [line] = merges(auditLines(input({
      sessions: [landed({ how: 'elsewhere', by: undefined, sha: undefined, into: undefined })],
    })))

    expect(line).toMatchObject({ route: 'elsewhere', who: null, sha: null, into: null })
  })

  it('leaves a session that never landed out entirely', () => {
    const [header, ...rest] = auditLines(input({ sessions: [{ id: 's2', repoDir: '/w/webapp' }] }))

    expect(header?.type).toBe('header')
    expect(rest).toEqual([])
  })
})

describe('the file itself', () => {
  it('is one object per line, newline-terminated', () => {
    const text = toJsonl(auditLines(input({ runs: [run()], sessions: [landed()] })))

    expect(text.endsWith('\n')).toBe(true)
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow()
  })

  it('never wraps a line, so grep can find anything in it', () => {
    const text = toJsonl(auditLines(input({ runs: [run({ refusedHosts: ['a.example'] })] })))

    expect(text.trim().split('\n').filter(l => l.includes('a.example'))).toHaveLength(1)
  })

  it('is named for the window it covers', () => {
    expect(auditFilename(NOW - 7 * DAY, NOW)).toMatch(/^agents-studio-audit-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.jsonl$/)
  })
})
