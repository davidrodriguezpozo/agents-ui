import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * A ritual that belongs to the repository rather than to this laptop.
 *
 * The whole risk of this feature is in one place: a `git pull` must be able to
 * change what a row *says* and must never be able to change what this machine
 * *does* without somebody here agreeing. So what is tested is the seam — the
 * definition follows the file, the state and the trust do not, and a ritual that
 * disappears from the file takes its row with it while leaving every local
 * ritual alone.
 */

let claudeDir: string
let repo: string
let schedules: typeof import('../server/utils/schedules')

const SHARED = join('.claude', 'agents-studio.json')

const nightly = {
  key: 'nightly-brief',
  title: 'Nightly brief',
  input: '/hd:goodmorning',
  recurrence: { hour: 8, minute: 0, days: [1, 2, 3, 4, 5] },
}

async function share(...rituals: unknown[]) {
  await mkdir(join(repo, '.claude'), { recursive: true })
  await writeFile(join(repo, SHARED), JSON.stringify({ version: 1, rituals }), 'utf8')
}

beforeEach(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-shared-rituals-'))
  process.env.CLAUDE_DIR = claudeDir
  repo = await mkdtemp(join(tmpdir(), 'agents-ui-shared-repo-'))

  const claude = await import('../server/utils/claudeDir')
  claude.setClaudeDir(claudeDir)

  schedules = await import('../server/utils/schedules')
  await schedules.writeSchedules([])
})

afterEach(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(repo, { recursive: true, force: true })
})

describe('a shared ritual arriving by pull', () => {
  it('appears as a row, off, saying where it came from', async () => {
    await share(nightly)

    const result = await schedules.syncSharedRituals(repo)
    const [row] = await schedules.readSchedules()

    expect(result.added).toEqual(['nightly-brief'])
    expect(row).toMatchObject({
      title: 'Nightly brief',
      origin: 'repository',
      sharedKey: 'nightly-brief',
      projectDir: repo,
      // A pull that starts running something at 08:00 would be a side effect of
      // a pull, so it arrives off and says why.
      enabled: false,
      // The file cannot hand out trust on this machine.
      permission: 'readonly',
    })
    expect(row!.pausedReason).toContain('Turn it on')
  })

  it('does not make a second row when it is synced again', async () => {
    await share(nightly)
    await schedules.syncSharedRituals(repo)
    const again = await schedules.syncSharedRituals(repo)

    expect(again.added).toEqual([])
    expect(await schedules.readSchedules()).toHaveLength(1)
  })

  it('follows the file when a colleague changes the definition', async () => {
    await share(nightly)
    await schedules.syncSharedRituals(repo)

    await share({ ...nightly, title: 'Morning brief', recurrence: { hour: 9, minute: 30, days: [] } })
    const result = await schedules.syncSharedRituals(repo)
    const [row] = await schedules.readSchedules()

    expect(result.updated).toEqual(['nightly-brief'])
    expect(row).toMatchObject({ title: 'Morning brief', recurrence: { hour: 9, minute: 30, days: [] } })
  })

  it('keeps this machine state through a change to the definition', async () => {
    await share(nightly)
    await schedules.syncSharedRituals(repo)

    const [before] = await schedules.readSchedules()
    await schedules.writeSchedules([{ ...before!, enabled: true, lastRunAt: 1_700_000_000_000, lastRunId: 'r1', permission: 'edits' }])

    await share({ ...nightly, title: 'Renamed' })
    await schedules.syncSharedRituals(repo)
    const [after] = await schedules.readSchedules()

    expect(after).toMatchObject({
      title: 'Renamed',
      // None of this is the file's business.
      enabled: true,
      lastRunAt: 1_700_000_000_000,
      lastRunId: 'r1',
      permission: 'edits',
    })
  })

  it('takes the row away when the definition leaves the file', async () => {
    await share(nightly)
    await schedules.syncSharedRituals(repo)

    await share()
    const result = await schedules.syncSharedRituals(repo)

    expect(result.removed).toEqual(['nightly-brief'])
    expect(await schedules.readSchedules()).toEqual([])
  })

  it('never touches a ritual this machine made', async () => {
    const mine = await schedules.upsertSchedule({
      title: 'Mine', input: '/mine', projectDir: repo, recurrence: { hour: 7, minute: 0, days: [] },
    })

    await share(nightly)
    await schedules.syncSharedRituals(repo)
    await share()
    await schedules.syncSharedRituals(repo)

    const rows = await schedules.readSchedules()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(mine.id)
  })

  it('leaves a project that shares nothing completely alone', async () => {
    const result = await schedules.syncSharedRituals(repo)

    expect(result).toMatchObject({ added: [], updated: [], removed: [] })
    expect(await schedules.readSchedules()).toEqual([])
  })

  it('hands back what the file got wrong instead of failing', async () => {
    await share(nightly, { key: 'no-title' })

    const result = await schedules.syncSharedRituals(repo)

    expect(result.added).toEqual(['nightly-brief'])
    expect(result.problems.map(p => p.at)).toContain('rituals[1].title')
  })

  it('lists a ritual this checkout cannot run, and says so', async () => {
    await share({ ...nightly, requires: ['scripts/nightly.sh'] })

    const result = await schedules.syncSharedRituals(repo)

    expect(result.added).toEqual(['nightly-brief'])
    expect(result.problems[0]!.message).toContain('not in this checkout')
  })
})

describe('sharing one of this machine own rituals', () => {
  it('writes the definition into the repository and marks the row', async () => {
    const mine = await schedules.upsertSchedule({
      title: 'Nightly brief', input: '/hd:goodmorning', projectDir: repo,
      recurrence: { hour: 8, minute: 0, days: [1] },
    })

    const result = await schedules.shareRitual(mine.id)
    const file = JSON.parse(await readFile(join(repo, SHARED), 'utf8'))
    const [row] = await schedules.readSchedules()

    expect(result).toMatchObject({ key: 'nightly-brief' })
    expect(file.rituals).toEqual([{
      key: 'nightly-brief',
      title: 'Nightly brief',
      input: '/hd:goodmorning',
      recurrence: { hour: 8, minute: 0, days: [1] },
    }])
    // The same row, now shared — not a second one, which would fire twice.
    expect(row).toMatchObject({ id: mine.id, origin: 'repository', sharedKey: 'nightly-brief' })
    expect(await schedules.readSchedules()).toHaveLength(1)
  })

  it('shares nothing that belongs to this machine', async () => {
    const mine = await schedules.upsertSchedule({
      title: 'Nightly brief', input: '/x', projectDir: repo, permission: 'full',
      recurrence: { hour: 8, minute: 0, days: [] },
    })
    await schedules.shareRitual(mine.id)

    const [shared] = JSON.parse(await readFile(join(repo, SHARED), 'utf8')).rituals

    // Trust, run history and the switch are all absent by construction.
    expect(Object.keys(shared).sort()).toEqual(['input', 'key', 'recurrence', 'title'])
  })

  it('refuses a ritual with no repository to share it through', async () => {
    const loose = await schedules.upsertSchedule({
      title: 'Loose', input: '/x', recurrence: { hour: 8, minute: 0, days: [] },
    })

    expect(await schedules.shareRitual(loose.id)).toBeNull()
  })

  it('keeps the row when it stops being shared', async () => {
    const mine = await schedules.upsertSchedule({
      title: 'Nightly brief', input: '/x', projectDir: repo, recurrence: { hour: 8, minute: 0, days: [] },
    })
    await schedules.shareRitual(mine.id)

    expect(await schedules.unshareRitual(mine.id)).toBe(true)

    const file = JSON.parse(await readFile(join(repo, SHARED), 'utf8'))
    const [row] = await schedules.readSchedules()

    // "Stop sharing" must not read as "delete", so the definition comes home
    // rather than leaving with the file.
    expect(file.rituals).toBeUndefined()
    expect(row).toMatchObject({ id: mine.id, origin: 'user' })
    expect(row!.sharedKey).toBeUndefined()

    // And the next sync does not take it away, because it is nobody's shared
    // ritual any more.
    await schedules.syncSharedRituals(repo)
    expect(await schedules.readSchedules()).toHaveLength(1)
  })
})

describe('the key a shared ritual is known by', () => {
  it('reads as something a person wrote', () => {
    expect(schedules.sharedRitualKey('Nightly brief')).toBe('nightly-brief')
    expect(schedules.sharedRitualKey('Triage: what came in overnight!')).toBe('triage-what-came-in-overnight')
  })

  it('suffixes rather than collide, because two of one key is refused on read', () => {
    const taken = [{ sharedKey: 'nightly-brief' }, { sharedKey: 'nightly-brief-2' }]

    expect(schedules.sharedRitualKey('Nightly brief', taken)).toBe('nightly-brief-3')
  })

  it('always produces something usable', () => {
    expect(schedules.sharedRitualKey('!!!')).toBe('ritual')
  })
})
