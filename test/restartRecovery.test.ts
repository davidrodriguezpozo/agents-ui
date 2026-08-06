import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { planResume, RESUME_WINDOW_MS, resumeAt } from '../server/utils/restartRecovery'

const NOW = 1_700_000_000_000
const MINUTE = 60_000

function ritual(over: Partial<{ id: string; enabled: boolean; nextRunAt: number }> = {}) {
  return { id: 'r1', enabled: true, nextRunAt: NOW + 24 * 60 * MINUTE, ...over }
}

describe('resumeAt', () => {
  it('puts the clock back to the occurrence that was lost', () => {
    // The whole point: a ritual fires, the process dies, and its clock is
    // already pointing at tomorrow. Nothing else would ever run this morning.
    expect(resumeAt(ritual(), NOW - 20 * MINUTE, NOW)).toBe(NOW - 20 * MINUTE)
  })

  it('leaves an occurrence too old to be worth having', () => {
    expect(resumeAt(ritual(), NOW - RESUME_WINDOW_MS - MINUTE, NOW)).toBeNull()
  })

  it('stays inside the window the scheduler will still catch up over', () => {
    // A rewound clock is read by a tick a few seconds later. Sitting exactly on
    // the scheduler's two-hour boundary would put it just outside by then, and
    // the recovery would quietly do nothing.
    expect(RESUME_WINDOW_MS).toBeLessThan(2 * 60 * MINUTE)
  })

  it('does not touch a ritual that is already due sooner', () => {
    // Every five minutes: the next one is closer than the one that was lost,
    // so there is nothing to recover and moving the clock only duplicates work.
    const soon = ritual({ nextRunAt: NOW - 30 * MINUTE })
    expect(resumeAt(soon, NOW - 20 * MINUTE, NOW)).toBeNull()
  })

  it('never moves a clock forward', () => {
    const at = resumeAt(ritual(), NOW - 20 * MINUTE, NOW)
    expect(at).not.toBeNull()
    expect(at!).toBeLessThan(ritual().nextRunAt)
  })

  it('leaves a ritual that has since been turned off', () => {
    // Quite possibly turned off *because* it kept dying. Starting it again on
    // the way back up would undo that.
    expect(resumeAt(ritual({ enabled: false }), NOW - 20 * MINUTE, NOW)).toBeNull()
  })
})

describe('planResume', () => {
  it('recovers the earliest occurrence when a ritual lost several', () => {
    const plan = planResume(
      [ritual()],
      [
        { scheduleId: 'r1', occurredAt: NOW - 10 * MINUTE },
        { scheduleId: 'r1', occurredAt: NOW - 40 * MINUTE },
      ],
      NOW,
    )
    expect(plan).toEqual([{ id: 'r1', nextRunAt: NOW - 40 * MINUTE }])
  })

  it('ignores interrupted runs whose ritual has been deleted', () => {
    expect(planResume([ritual()], [{ scheduleId: 'gone', occurredAt: NOW - MINUTE }], NOW)).toEqual([])
  })

  it('leaves rituals nothing interrupted alone', () => {
    const plan = planResume(
      [ritual({ id: 'r1' }), ritual({ id: 'r2' })],
      [{ scheduleId: 'r2', occurredAt: NOW - MINUTE }],
      NOW,
    )
    expect(plan).toEqual([{ id: 'r2', nextRunAt: NOW - MINUTE }])
  })

  it('does nothing when the restart interrupted nothing', () => {
    expect(planResume([ritual()], [], NOW)).toEqual([])
  })
})

/**
 * The half that touches disk. The decision above is pure and easy to be sure
 * of; this is the part that has to actually reach `schedules.json`, and a plan
 * that is computed and then not written is the failure mode that looks exactly
 * like success in the log.
 */
describe('resumeInterruptedRituals', () => {
  let dir: string
  let recovery: typeof import('../server/utils/restartRecovery')

  const file = () => join(dir, 'agents-ui', 'schedules.json')

  // The real on-disk envelope, not a bare array — writing the wrong shape here
  // would decode to nothing and make every assertion below pass for the wrong
  // reason.
  async function writeSchedules(schedules: unknown[]) {
    await mkdir(join(dir, 'agents-ui'), { recursive: true })
    await writeFile(file(), JSON.stringify({ version: 1, schedules }), 'utf-8')
  }

  const onDisk = async () => JSON.parse(await readFile(file(), 'utf-8')).schedules

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agents-ui-resume-'))
    process.env.CLAUDE_DIR = dir
    recovery = await import('../server/utils/restartRecovery')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
    delete process.env.CLAUDE_DIR
  })

  const daily = (over = {}) => ({
    id: 'r1',
    title: 'Morning brief',
    enabled: true,
    recurrence: { kind: 'daily', hour: 8, minute: 0 },
    input: 'brief me',
    nextRunAt: NOW + 24 * 60 * MINUTE,
    ...over,
  })

  it('writes the rewound clock, and names what it recovered', async () => {
    await writeSchedules([daily()])

    const resumed = await recovery.resumeInterruptedRituals(
      [{ scheduleId: 'r1', createdAt: NOW - 20 * MINUTE }],
      NOW,
    )

    expect(resumed).toEqual(['Morning brief'])
    expect((await onDisk())[0].nextRunAt).toBe(NOW - 20 * MINUTE)
  })

  it('leaves the file alone when nothing recoverable was interrupted', async () => {
    await writeSchedules([daily()])

    // A session turn, not a ritual: no schedule to put back.
    const resumed = await recovery.resumeInterruptedRituals([{ createdAt: NOW - MINUTE }], NOW)

    expect(resumed).toEqual([])
    expect((await onDisk())[0].nextRunAt).toBe(NOW + 24 * 60 * MINUTE)
  })

  it('does not rewind a ritual that was turned off while it was down', async () => {
    await writeSchedules([daily({ enabled: false })])

    const resumed = await recovery.resumeInterruptedRituals(
      [{ scheduleId: 'r1', createdAt: NOW - 20 * MINUTE }],
      NOW,
    )

    expect(resumed).toEqual([])
    expect((await onDisk())[0].nextRunAt).toBe(NOW + 24 * 60 * MINUTE)
  })
})
