import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Auto, pressed while a turn is already running.
 *
 * The SDK hears the permission mode once, when the run starts. So the control
 * used to light up and change nothing: the turn carried on asking, and only the
 * next one went quiet. Every Auto session on the machine that found this showed
 * the same shape — prompts on the first run, none on any run after it.
 *
 * The permission callback is consulted per tool call, which makes it the one
 * place that can still answer. What is pinned here is the decision it asks for:
 * the *stored* trust, re-read each time, never a value captured at run start.
 */

let claudeDir: string
let repo: string
let liveTrust: typeof import('../server/utils/liveTrust')
let sessions: typeof import('../server/utils/sessions')
let startSession: typeof import('../server/utils/startSession')

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-livetrust-cfg-'))
  process.env.CLAUDE_DIR = claudeDir

  repo = await mkdtemp(join(tmpdir(), 'agents-ui-livetrust-repo-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo })
  await writeFile(join(repo, 'README.md'), '# repo\n')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'first'], { cwd: repo })

  liveTrust = await import('../server/utils/liveTrust')
  sessions = await import('../server/utils/sessions')
  startSession = await import('../server/utils/startSession')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(repo, { recursive: true, force: true })
})

describe('honouring Auto on the turn already running', () => {
  it('says yes once the session has been set to Auto, not when it started', async () => {
    // Exactly the shape that produced this bug: the session opens at the
    // default, the long first turn is already underway, and Auto is pressed.
    const started = await startSession.startSession({ repoDir: repo, title: 'flipped mid-turn' })
    expect(await liveTrust.nowTrustedFully(started.id)).toBe(false)

    await sessions.patchSession(started.id, { trust: 'full' })

    // Re-read, not remembered — a value captured at run start is the very
    // thing that was wrong.
    expect(await liveTrust.nowTrustedFully(started.id)).toBe(true)
  })

  it('keeps asking at the levels that promised to ask', async () => {
    const edits = await startSession.startSession({ repoDir: repo, title: 'edits', trust: 'edits' })
    const readonly = await startSession.startSession({ repoDir: repo, title: 'plan', trust: 'readonly' })

    expect(await liveTrust.nowTrustedFully(edits.id)).toBe(false)
    expect(await liveTrust.nowTrustedFully(readonly.id)).toBe(false)
  })

  /**
   * Rituals, workflow steps and one-off runs have no session and no trust of
   * their own. Silence must not read as Auto.
   */
  it('grants nothing to a run that belongs to no session', async () => {
    expect(await liveTrust.nowTrustedFully(undefined)).toBe(false)
    expect(await liveTrust.nowTrustedFully('no-such-session')).toBe(false)
  })
})
