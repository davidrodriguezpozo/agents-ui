import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { permissionModeFor } from '../server/utils/trust'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Trust, chosen before the session starts.
 *
 * It used to be settable only on a session that already existed, which meant
 * the *first* turn — usually the longest one, and the one that does most of the
 * work — always ran at "Edit files" no matter what was intended. You could pick
 * Auto afterwards and it would apply to turn two. Rituals never had this
 * problem: they choose upfront.
 *
 * The turn reads `session.trust` off the stored record, so what this pins is
 * that the record carries the choice before any turn is taken.
 */

let claudeDir: string
let repo: string
let startSession: typeof import('../server/utils/startSession')
let sessions: typeof import('../server/utils/sessions')

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-trust-cfg-'))
  process.env.CLAUDE_DIR = claudeDir

  repo = await mkdtemp(join(tmpdir(), 'agents-ui-trust-repo-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo })
  await writeFile(join(repo, 'README.md'), '# repo\n')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'first'], { cwd: repo })

  startSession = await import('../server/utils/startSession')
  sessions = await import('../server/utils/sessions')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(repo, { recursive: true, force: true })
})

describe('starting a session with a trust level', () => {
  it('records it, so the first turn runs at what was asked for', async () => {
    const started = await startSession.startSession({ repoDir: repo, title: 'auto one', trust: 'full' })

    expect(started.trust).toBe('full')
    // Not just on the object handed back — on what a turn will read.
    const stored = await sessions.findSession(started.id)
    expect(stored?.trust).toBe('full')
    expect(permissionModeFor(stored?.trust)).toBe('bypassPermissions')
  })

  it('carries a cautious choice just as faithfully', async () => {
    const started = await startSession.startSession({ repoDir: repo, title: 'plan one', trust: 'readonly' })

    expect(permissionModeFor(started.trust)).toBe('plan')
  })

  it('still defaults to editing files when nothing was chosen', async () => {
    // Every session created before this existed, and every caller that does not
    // care. Silence must not read as "anything it needs".
    const started = await startSession.startSession({ repoDir: repo, title: 'default one' })

    expect(started.trust).toBeUndefined()
    expect(permissionModeFor(started.trust)).toBe('acceptEdits')
  })
})
