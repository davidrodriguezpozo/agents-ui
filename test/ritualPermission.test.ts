import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * What an unattended ritual runs as when it never said.
 *
 * This exists because the *session* default became Auto. A session lives in a
 * throwaway worktree with somebody watching it; a ritual fires at 08:45 at
 * nobody, and "never stops to ask" is a different proposition there. The two
 * share `permissionModeFor`, so the only thing keeping them apart is that a
 * schedule always arrives carrying an explicit permission — normalised on the way
 * out of the store, for rituals written before the setting existed.
 *
 * That used to be a sentence in a comment, backed by a test asserting the shared
 * fallback was cautious. The fallback is not cautious any more, so the guarantee
 * is asserted where it actually lives: read a schedules.json with no permission
 * in it, and see what comes back.
 */

let dir: string
let schedules: typeof import('../server/utils/schedules')
let trust: typeof import('../server/utils/trust')

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-ritual-perm-'))
  process.env.CLAUDE_DIR = dir
  schedules = await import('../server/utils/schedules')
  trust = await import('../server/utils/trust')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
})

/** A ritual on disk exactly as one written before trust levels looks. */
async function writeLegacyRitual() {
  await mkdir(join(dir, 'agents-ui'), { recursive: true })
  await writeFile(
    join(dir, 'agents-ui', 'schedules.json'),
    JSON.stringify({
      version: 1,
      schedules: [{
        id: 'legacy-one',
        title: 'Morning brief',
        input: '/hd:goodmorning',
        projectDir: '/repo',
        recurrence: { hour: 8, minute: 45, days: [1, 2, 3, 4, 5] },
        enabled: true,
        createdAt: 1,
      }],
    }),
  )
}

describe('a ritual that never chose a permission', () => {
  it('reads back as editing files, not as the session default', async () => {
    await writeLegacyRitual()

    const [ritual] = await schedules.readSchedules()

    expect(ritual?.permission).toBe('edits')
    expect(trust.permissionModeFor(ritual?.permission)).toBe('acceptEdits')
  })

  it('never hands the scheduler an absent permission to fall back on', async () => {
    // The actual failure being prevented: if the store ever stopped filling this
    // in, every legacy ritual would silently start running at Auto — unattended,
    // on a schedule, with nobody to notice for a morning.
    await writeLegacyRitual()

    const [ritual] = await schedules.readSchedules()

    expect(ritual?.permission).not.toBeUndefined()
    expect(trust.permissionModeFor(ritual?.permission))
      .not.toBe(trust.permissionModeFor(undefined))
  })
})
