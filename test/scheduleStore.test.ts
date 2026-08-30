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

/**
 * Which repository a ritual runs in used to be unambiguous, because there was
 * only one to be in. With several, an edit made from the wrong one could move
 * a ritual without saying so — a morning briefing quietly reporting on
 * somebody else's repository is the kind of failure nobody goes looking for.
 */
describe('the project a ritual is pinned to', () => {
  it('takes the project you are in when the ritual is new', () => {
    expect(schedules.projectDirForSave({}, '/repo/a')).toBe('/repo/a')
  })

  it('takes nothing on an edit, so the ritual keeps where it runs', () => {
    expect(schedules.projectDirForSave({ id: 'r1' }, '/repo/b')).toBeUndefined()
  })

  it('still honours a project named outright, on a new ritual or an edit', () => {
    expect(schedules.projectDirForSave({ projectDir: '/repo/c' }, '/repo/a')).toBe('/repo/c')
    expect(schedules.projectDirForSave({ id: 'r1', projectDir: '/repo/c' }, '/repo/a')).toBe('/repo/c')
  })

  it('leaves a new ritual unpinned when no project is selected', () => {
    expect(schedules.projectDirForSave({}, null)).toBeUndefined()
  })

  it('tells "none, on purpose" apart from having said nothing', () => {
    // Without this a ritual could be pinned but never unpinned, because both
    // answers would arrive as the same absent value.
    expect(schedules.projectDirForSave({ id: 'r1', projectDir: null }, '/repo/a')).toBeNull()
    expect(schedules.projectDirForSave({ id: 'r1' }, '/repo/a')).toBeUndefined()
  })

  it('clears the project when asked to, and only then', async () => {
    const created = await schedules.upsertSchedule({ ...ritual('briefing'), projectDir: '/repo/a' })

    const kept = await schedules.upsertSchedule({ ...ritual('briefing'), id: created.id })
    expect(kept.projectDir).toBe('/repo/a')

    const cleared = await schedules.upsertSchedule({
      ...ritual('briefing'),
      id: created.id,
      projectDir: null,
    })
    expect(cleared.projectDir).toBeUndefined()
  })

  it('keeps the original project through an edit, end to end', async () => {
    const created = await schedules.upsertSchedule({
      ...ritual('briefing'),
      projectDir: schedules.projectDirForSave({}, '/repo/a'),
    })

    // The same ritual, edited while a different project is selected.
    const edited = await schedules.upsertSchedule({
      ...ritual('briefing'),
      id: created.id,
      recurrence: { hour: 9, minute: 30, days: [1] },
      projectDir: schedules.projectDirForSave({ id: created.id }, '/repo/b'),
    })

    expect(edited.projectDir).toBe('/repo/a')
    expect(edited.recurrence.hour).toBe(9)
  })
})

describe('turning a ritual into a chain and back', () => {
  const steps = [
    { title: 'Triage', input: 'Look at what came in.' },
    { title: 'Fix', input: 'Mend what triage found.' },
  ]

  it('stores the steps as given', async () => {
    const saved = await schedules.upsertSchedule({ ...ritual('nightly'), steps })

    expect(saved.steps?.map(s => s.title)).toEqual(['Triage', 'Fix'])
  })

  it('keeps them through an edit that does not mention them', async () => {
    const created = await schedules.upsertSchedule({ ...ritual('nightly'), steps })

    const edited = await schedules.upsertSchedule({
      ...ritual('nightly'),
      id: created.id,
      recurrence: { hour: 9, minute: 0, days: [1] },
    })

    expect(edited.steps).toHaveLength(2)
  })

  it('clears them on null, putting the ritual back to one instruction', async () => {
    const created = await schedules.upsertSchedule({ ...ritual('nightly'), steps })

    const edited = await schedules.upsertSchedule({
      ...ritual('nightly'),
      id: created.id,
      steps: null,
    })

    expect(edited.steps).toBeUndefined()
  })

  it('clears them when the list sent no longer makes a chain', async () => {
    // A chain trimmed to one step is not a chain. Falling back to what was
    // stored would leave the old steps in place and make the saved record
    // disagree with what was just sent.
    const created = await schedules.upsertSchedule({ ...ritual('nightly'), steps })

    const edited = await schedules.upsertSchedule({
      ...ritual('nightly'),
      id: created.id,
      steps: [{ title: 'Only', input: 'Just the one.' }],
    })

    expect(edited.steps).toBeUndefined()
  })
})

/**
 * A trigger whose question changed has a cursor belonging to a question nobody
 * is asking any more, so it is dropped and the ritual starts from now. The
 * awkward case is the one that only *looks* changed: a `check_failed` ritual
 * saved before `scope` existed, re-opened and saved again, now spells out the
 * scope its branch always implied.
 */
describe('a trigger scope and the cursor', () => {
  const triggered = (trigger: any) => ({ ...ritual('red-ci'), trigger })

  it('keeps the cursor when an old trigger only gains the scope it already meant', async () => {
    const created = await schedules.upsertSchedule(triggered({ kind: 'check_failed', branch: 'main' }))
    await schedules.setTriggerCursor(created.id, 19_400_000_001)

    const edited = await schedules.upsertSchedule({
      ...triggered({ kind: 'check_failed', branch: 'main', scope: 'branch' }),
      id: created.id,
    })

    expect(edited.triggerCursor).toBe(19_400_000_001)
  })

  it('drops the cursor when the scope becomes your pull requests', async () => {
    // A different question, over a different set of runs. Re-baselining fires
    // nothing and starts from now, which is what "changed" has always meant.
    const created = await schedules.upsertSchedule(triggered({ kind: 'check_failed', branch: 'main' }))
    await schedules.setTriggerCursor(created.id, 19_400_000_001)

    const edited = await schedules.upsertSchedule({
      ...triggered({ kind: 'check_failed', scope: 'mine' }),
      id: created.id,
    })

    expect(edited.triggerCursor).toBeUndefined()
  })
})
