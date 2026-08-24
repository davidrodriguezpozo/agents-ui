import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Steering, on a provider that has no way to be steered.
 *
 * Getting a sentence into a turn that is already running needs a stdin that
 * stays open — see `liveSteer`. A headless `cursor-agent` closes its after the
 * prompt, so there is nothing to write to. The composer reads `canSteer` and
 * offers Queue only; this is the half that has to hold when something asks
 * anyway.
 */

let dir: string
let sendSteered: typeof import('../../server/utils/sessionTurn')['sendSteered']
let steerRefusal: typeof import('../../server/utils/sessionTurn')['steerRefusal']

beforeAll(async () => {
  // Never the real ~/.claude — it holds live sessions and the worktrees other
  // work is happening in.
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-steer-'))
  process.env.CLAUDE_DIR = dir
  ;({ sendSteered, steerRefusal } = await import('../../server/utils/sessionTurn'))
})

afterAll(async () => {
  delete process.env.CLAUDE_DIR
  await rm(dir, { recursive: true, force: true })
})

/** A session whose workspace exists, so the refusal under test is the only one. */
function sessionOn(provider?: string) {
  return {
    id: 'sess-1',
    title: 'A session',
    repoDir: dir,
    // Any directory that is on disk: `turnRefusal` checks the workspace first,
    // and a missing one would refuse for the wrong reason.
    worktreePath: dir,
    branch: 'work',
    baseBranch: 'main',
    baseSha: 'abc',
    status: 'idle' as const,
    provider,
    runIds: [],
    createdAt: 0,
    updatedAt: 0,
  } as any
}

describe('sendSteered on a provider that cannot steer', () => {
  it('refuses, and says which provider and what to do instead', async () => {
    await expect(sendSteered(sessionOn('cursor'), 'no, not that file'))
      .rejects.toMatchObject({
        statusCode: 409,
        data: {
          error: 'steer_unavailable',
          message: expect.stringContaining('Cursor cannot be interrupted mid-turn'),
        },
      })
  })

  /**
   * Refused rather than quietly queued. The composer already offers Queue only,
   * so a request arriving here means something is out of step — and a silent
   * fallback would hide that while appearing to work, which is how a button ends
   * up doing something other than what it says.
   */
  it('does not queue it instead, which would hide the mismatch', async () => {
    await expect(sendSteered(sessionOn('cursor'), 'hello'))
      .rejects.toMatchObject({ data: { error: 'steer_unavailable' } })
  })

  it('names the reason plainly enough to be shown to a person', async () => {
    const error = await sendSteered(sessionOn('cursor'), 'hello').catch(e => e)
    expect(error.data.message).toContain('Queue the message instead')
  })
})

/**
 * Asked of `steerRefusal` rather than of `sendSteered`, deliberately. A session
 * that *can* steer goes on to the ordinary path, and the ordinary path starts a
 * real turn — a test asserting "this was not refused" by spawning an agent is a
 * test that costs money and fails on a bad network.
 */
describe('a provider that can steer', () => {
  /**
   * The case that matters most: every session written before the field existed
   * has no provider, and steering has always worked on them.
   */
  it('is not refused when the session records no provider', () => {
    expect(steerRefusal(sessionOn(undefined))).toBeNull()
  })

  it('is not refused on Claude Code', () => {
    expect(steerRefusal(sessionOn('claude'))).toBeNull()
  })

  /** An unrecognised provider reads as Claude Code, so it steers. */
  it('is not refused on a provider this build no longer has', () => {
    expect(steerRefusal(sessionOn('codex'))).toBeNull()
  })

  it('is refused on Cursor, which has no stdin to write to', () => {
    expect(steerRefusal(sessionOn('cursor'))).toMatchObject({ error: 'steer_unavailable' })
  })
})
