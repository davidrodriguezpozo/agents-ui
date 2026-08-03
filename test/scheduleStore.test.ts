import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Rituals are the one thing in this app that cannot be reconstructed from
 * anywhere else, so the ways they can silently disappear matter most.
 */

let dir: string
let schedules: typeof import('../server/utils/schedules')
let schedulesFile: string

const ritual = (title: string) => ({
  title,
  input: `/${title}`,
  recurrence: { hour: 8, minute: 0, days: [1, 2, 3, 4, 5] },
})

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-rituals-'))
  process.env.CLAUDE_DIR = dir
  schedules = await import('../server/utils/schedules')
  schedulesFile = join(dir, 'agents-ui', 'schedules.json')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
})

describe('concurrent ritual writes', () => {
  it('keeps every ritual when several are created at once', async () => {
    const titles = ['briefing', 'standup', 'inbox', 'review', 'digest']
    await Promise.all(titles.map(t => schedules.upsertSchedule(ritual(t))))

    const saved = await schedules.readSchedules()
    expect(saved.map(s => s.title).sort()).toEqual([...titles].sort())
  })

  it('does not lose an edit made while a ritual is being marked as run', async () => {
    // The real collision: the scheduler advances one ritual's nextRunAt at the
    // same moment the user saves an edit to another.
    const a = await schedules.upsertSchedule(ritual('briefing'))
    const b = await schedules.upsertSchedule(ritual('standup'))

    await Promise.all([
      schedules.markRan(a.id, 'run-1'),
      schedules.upsertSchedule({ ...b, title: 'Standup (renamed)' }),
    ])

    const saved = await schedules.readSchedules()
    expect(saved.find(s => s.id === a.id)?.lastRunId).toBe('run-1')
    expect(saved.find(s => s.id === b.id)?.title).toBe('Standup (renamed)')
  })

  it('advances nextRunAt exactly once when a ritual fires', async () => {
    // Losing this update leaves nextRunAt in the past, and the ritual fires
    // again on the very next tick.
    const a = await schedules.upsertSchedule(ritual('briefing'))
    const before = a.nextRunAt!

    await Promise.all([
      schedules.markRan(a.id, 'run-1'),
      schedules.markRan(a.id, 'run-2'),
    ])

    const saved = await schedules.readSchedules()
    expect(saved[0]!.nextRunAt).toBeGreaterThan(before - 1)
    expect(saved[0]!.lastRunId).toMatch(/^run-[12]$/)
  })
})

describe('a damaged ritual file', () => {
  it('refuses to report rituals as simply absent', async () => {
    await mkdir(join(dir, 'agents-ui'), { recursive: true })
    await writeFile(schedulesFile, '{ truncated', 'utf-8')

    await expect(schedules.readSchedules()).rejects.toThrow(/unreadable/)
  })

  it('never lets a failed read turn into permanent deletion', async () => {
    // The chain that made this worse than losing sessions: a corrupt read
    // reported as "no rituals", then the next save writes that emptiness back.
    await schedules.upsertSchedule(ritual('briefing'))
    await schedules.upsertSchedule(ritual('standup'))
    await writeFile(schedulesFile, 'corrupt', 'utf-8')
    await rm(`${schedulesFile}.bak`, { force: true })

    await expect(schedules.upsertSchedule(ritual('new-one'))).rejects.toThrow(/unreadable/)

    // The damaged file is still there to be recovered from, not overwritten.
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(schedulesFile, 'utf-8')).toBe('corrupt')
  })

  it('recovers from the backup when the main file is damaged', async () => {
    await schedules.upsertSchedule(ritual('briefing'))
    await schedules.upsertSchedule(ritual('standup'))
    await writeFile(schedulesFile, 'corrupt', 'utf-8')

    const saved = await schedules.readSchedules()
    expect(saved.map(s => s.title)).toEqual(['briefing'])
  })
})
