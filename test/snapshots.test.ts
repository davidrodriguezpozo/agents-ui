import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

let dir: string
let snapshots: typeof import('../server/utils/snapshots')
let schedules: typeof import('../server/utils/schedules')
let sessions: typeof import('../server/utils/sessions')

const ritual = (title: string) => ({
  title,
  input: `/${title}`,
  recurrence: { hour: 8, minute: 0, days: [1, 2, 3, 4, 5] },
})

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-snap-'))
  process.env.CLAUDE_DIR = dir
  snapshots = await import('../server/utils/snapshots')
  schedules = await import('../server/utils/schedules')
  sessions = await import('../server/utils/sessions')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
  await rm(join(dir, 'agents-ui-backups'), { recursive: true, force: true })
})

describe('where backups live', () => {
  it('sits beside the app directory, not inside it', () => {
    // A backup stored within what it is backing up is not a backup — this is
    // the single property the whole feature rests on.
    expect(snapshots.snapshotsDir()).not.toContain(`${join(dir, 'agents-ui')}/`)
    expect(snapshots.snapshotsDir()).toBe(join(dir, 'agents-ui-backups'))
  })
})

describe('taking snapshots', () => {
  it('records what exists at the time', async () => {
    await schedules.upsertSchedule(ritual('briefing'))
    const result = await snapshots.createSnapshot('manual')

    expect(result.created).toBe(true)
    const list = await snapshots.listSnapshots()
    expect(list).toHaveLength(1)
    expect(list[0]!.schedules).toBe(1)
  })

  it('skips an automatic snapshot when nothing has changed', async () => {
    await schedules.upsertSchedule(ritual('briefing'))
    await snapshots.createSnapshot('auto')

    const second = await snapshots.createSnapshot('auto')
    expect(second.created).toBe(false)
    expect(await snapshots.listSnapshots()).toHaveLength(1)
  })

  it('takes a manual snapshot even when nothing has changed', async () => {
    await schedules.upsertSchedule(ritual('briefing'))
    await snapshots.createSnapshot('auto')

    expect((await snapshots.createSnapshot('manual')).created).toBe(true)
  })

  it('takes nothing at all when the live state is damaged', async () => {
    // Snapshotting a corrupt state would rotate a good backup out of the
    // window, turning a recoverable problem into a permanent one.
    await schedules.upsertSchedule(ritual('briefing'))
    await snapshots.createSnapshot('manual')

    const { writeFile } = await import('node:fs/promises')
    const file = join(dir, 'agents-ui', 'schedules.json')
    await writeFile(file, 'corrupt', 'utf-8')
    await rm(`${file}.bak`, { force: true })

    await expect(snapshots.createSnapshot('auto')).rejects.toThrow(/unreadable/)
    expect(await snapshots.listSnapshots()).toHaveLength(1)
  })
})

describe('restoring', () => {
  it('brings back rituals after the whole app directory is deleted', async () => {
    // The exact accident this guards against.
    await schedules.upsertSchedule(ritual('briefing'))
    await schedules.upsertSchedule(ritual('standup'))
    const snapshot = await snapshots.createSnapshot('manual')

    await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
    expect(await schedules.readSchedules()).toEqual([])

    const result = await snapshots.restoreSnapshot(snapshot.name!)
    expect(result.restored.schedules).toBe(2)
    expect((await schedules.readSchedules()).map(s => s.title).sort())
      .toEqual(['briefing', 'standup'])
  })

  it('recomputes when each ritual is next due', async () => {
    // A snapshot carries the nextRunAt it had when taken. Restoring that
    // verbatim would either fire the ritual immediately or leave it overdue.
    const saved = await schedules.upsertSchedule(ritual('briefing'))
    const snapshot = await snapshots.createSnapshot('manual')

    await schedules.writeSchedules([{ ...saved, nextRunAt: 1 }])
    await snapshots.restoreSnapshot(snapshot.name!)

    expect((await schedules.readSchedules())[0]!.nextRunAt).toBeGreaterThan(Date.now())
  })

  it('backs up the current state first, so a wrong restore is undoable', async () => {
    await schedules.upsertSchedule(ritual('old'))
    const first = await snapshots.createSnapshot('manual')

    await schedules.upsertSchedule(ritual('new'))
    const result = await snapshots.restoreSnapshot(first.name!)

    expect(result.safetySnapshot).toBeTruthy()
    // Undo it: the safety copy still has both rituals.
    await snapshots.restoreSnapshot(result.safetySnapshot!)
    expect((await schedules.readSchedules()).map(s => s.title).sort()).toEqual(['new', 'old'])
  })

  it('restores sessions alongside rituals', async () => {
    await sessions.saveSession({
      id: 'abc', title: 'A session', repoDir: '/repo', worktreePath: '/wt/abc',
      branch: 'agents-ui/a-abc', baseBranch: 'main', baseSha: 'sha', status: 'idle',
      runIds: [], createdAt: 1, updatedAt: 1,
    })
    const snapshot = await snapshots.createSnapshot('manual')

    await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
    await snapshots.restoreSnapshot(snapshot.name!)

    expect((await sessions.readSessions()).map(s => s.id)).toEqual(['abc'])
  })

  it('leaves no temporary files behind', async () => {
    await schedules.upsertSchedule(ritual('briefing'))
    await snapshots.createSnapshot('manual')

    const { readdir } = await import('node:fs/promises')
    const files = await readdir(snapshots.snapshotsDir())
    expect(files.filter(f => f.endsWith('.tmp'))).toEqual([])
    expect(existsSync(snapshots.snapshotsDir())).toBe(true)
  })
})
