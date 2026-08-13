import { describe, expect, it } from 'vitest'
import { matchesFilter, sourceOf, type FilterableRun } from '../server/utils/runFilter'

function run(patch: Partial<FilterableRun> = {}): FilterableRun {
  return { title: 'Morning briefing', status: 'completed', kind: 'command', ...patch }
}

describe('where a run came from', () => {
  it('reads a ritual, a session and an agent from what started it', () => {
    expect(sourceOf(run({ scheduleId: 's1' }))).toBe('ritual')
    expect(sourceOf(run({ sessionId: 'x1', kind: 'chat' }))).toBe('session')
    expect(sourceOf(run({ kind: 'agent' }))).toBe('agent')
    expect(sourceOf(run())).toBe('command')
  })

  it('calls a scheduled run a ritual even though a session started one too', () => {
    // Both ids can be set in principle; the ritual is the more useful answer.
    expect(sourceOf(run({ scheduleId: 's1', sessionId: 'x1' }))).toBe('ritual')
  })
})

describe('filtering the log', () => {
  it('keeps everything when nothing is asked for', () => {
    expect(matchesFilter(run(), {})).toBe(true)
  })

  it('separates a run that needed you from one that simply worked', () => {
    const blocked = run({ needsAttention: true, deniedTools: ['Bash(gh:*)'] })

    expect(matchesFilter(blocked, { outcome: 'attention' })).toBe(true)
    // The status is "completed", but calling it worked would be a lie: the
    // part that needed a permission did not happen.
    expect(matchesFilter(blocked, { outcome: 'completed' })).toBe(false)
    expect(matchesFilter(run(), { outcome: 'completed' })).toBe(true)
  })

  it('sorts a run the sandbox refused in with the ones that need you', () => {
    // Same reasoning as a denied tool: it reports "completed" while the part
    // that needed the network did not happen.
    const refused = run({ refusedHosts: ['registry.npmjs.org'] })

    expect(matchesFilter(refused, { outcome: 'attention' })).toBe(true)
    expect(matchesFilter(refused, { outcome: 'completed' })).toBe(false)
  })

  it('treats queued work as running, since neither has an outcome yet', () => {
    expect(matchesFilter(run({ status: 'queued' }), { outcome: 'running' })).toBe(true)
    expect(matchesFilter(run({ status: 'running' }), { outcome: 'running' })).toBe(true)
    expect(matchesFilter(run({ status: 'running' }), { outcome: 'failed' })).toBe(false)
  })

  it('matches failed and stopped runs on their own status', () => {
    expect(matchesFilter(run({ status: 'failed' }), { outcome: 'failed' })).toBe(true)
    expect(matchesFilter(run({ status: 'cancelled' }), { outcome: 'cancelled' })).toBe(true)
  })

  it('searches what the run said, not only what it was called', () => {
    const found = run({ output: 'Two migrations pending, neither safe during business hours.' })

    expect(matchesFilter(found, { q: 'migrations' })).toBe(true)
    expect(matchesFilter(found, { q: 'MIGRATIONS' })).toBe(true)
    expect(matchesFilter(found, { q: 'rollback' })).toBe(false)
  })

  it('searches the invocation and the agent behind it', () => {
    expect(matchesFilter(run({ invocation: '/db:migrate-check' }), { q: 'migrate' })).toBe(true)
    expect(matchesFilter(run({ agentSlug: 'sql-reviewer' }), { q: 'sql' })).toBe(true)
  })

  it('ignores a query that is only whitespace', () => {
    expect(matchesFilter(run(), { q: '   ' })).toBe(true)
  })

  it('requires every filter to hold at once', () => {
    const ritual = run({ scheduleId: 's1', status: 'failed', output: 'timed out' })

    expect(matchesFilter(ritual, { source: 'ritual', outcome: 'failed', q: 'timed' })).toBe(true)
    expect(matchesFilter(ritual, { source: 'session', outcome: 'failed', q: 'timed' })).toBe(false)
    expect(matchesFilter(ritual, { source: 'ritual', outcome: 'completed' })).toBe(false)
    expect(matchesFilter(ritual, { source: 'ritual', q: 'nowhere' })).toBe(false)
  })
})

describe('leaving sources out', () => {
  /**
   * Work lists a session as one row however many turns it took, so it discards
   * runs a session owns. On a real machine 49 of the 50 most recent runs were
   * exactly those, so doing it in the page spent the whole cap on rows that were
   * then thrown away — and a ritual run from the day before was invisible behind
   * fifty turns of one session. This has to happen before the limit.
   */
  it('drops the excluded sources', () => {
    expect(matchesFilter(run({ sessionId: 'x1', kind: 'chat' }), { exclude: ['session'] })).toBe(false)
    expect(matchesFilter(run({ scheduleId: 's1' }), { exclude: ['session'] })).toBe(true)
    expect(matchesFilter(run(), { exclude: ['session'] })).toBe(true)
  })

  it('excludes several at once', () => {
    const filter = { exclude: ['session', 'agent'] as ('session' | 'agent')[] }
    expect(matchesFilter(run({ sessionId: 'x' , kind: 'chat' }), filter)).toBe(false)
    expect(matchesFilter(run({ kind: 'agent' }), filter)).toBe(false)
    expect(matchesFilter(run({ scheduleId: 's' }), filter)).toBe(true)
    expect(matchesFilter(run(), filter)).toBe(true)
  })

  it('keeps everything when nothing is excluded', () => {
    expect(matchesFilter(run({ sessionId: 'x', kind: 'chat' }), {})).toBe(true)
    expect(matchesFilter(run({ sessionId: 'x', kind: 'chat' }), { exclude: [] })).toBe(true)
  })

  it('still applies the other filters alongside it', () => {
    const filter = { exclude: ['session'] as ('session')[], outcome: 'failed' as const }
    expect(matchesFilter(run({ scheduleId: 's', status: 'failed' }), filter)).toBe(true)
    expect(matchesFilter(run({ scheduleId: 's', status: 'completed' }), filter)).toBe(false)
  })
})
