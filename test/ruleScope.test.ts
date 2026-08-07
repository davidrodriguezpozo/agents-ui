import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * A permission granted from a blocked run has to be filed somewhere that
 * outlives the run. For a session that is the repository — its own working
 * directory is a worktree, and a rule written there is deleted along with it.
 */

let dir: string
let scope: typeof import('../server/utils/ruleScope')

const sessionsFile = () => join(dir, 'agents-ui', 'sessions.json')

async function writeSessions(sessions: unknown[]) {
  await mkdir(join(dir, 'agents-ui'), { recursive: true })
  await writeFile(sessionsFile(), JSON.stringify({ version: 1, sessions }), 'utf-8')
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-rulescope-'))
  process.env.CLAUDE_DIR = dir
  scope = await import('../server/utils/ruleScope')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

describe('rulesDirFor', () => {
  it('files a session run against its repository, not its worktree', async () => {
    await writeSessions([{
      id: 's1',
      title: 'a session',
      repoDir: '/repo',
      worktreePath: '/repo/.worktrees/s1',
      status: 'idle',
      runIds: [],
    }])

    const at = await scope.rulesDirFor({ sessionId: 's1', projectDir: '/repo/.worktrees/s1' })
    expect(at).toBe('/repo')
  })

  it('uses the run directory when there is no session', async () => {
    // A ritual or a workflow step runs in the project itself, so there is
    // nothing to translate.
    expect(await scope.rulesDirFor({ projectDir: '/repo' })).toBe('/repo')
  })

  it('falls back to the run directory when the session has been deleted', async () => {
    await writeSessions([])
    expect(await scope.rulesDirFor({ sessionId: 'gone', projectDir: '/repo' })).toBe('/repo')
  })

  it('has nowhere to file a run with no directory at all', async () => {
    expect(await scope.rulesDirFor({})).toBeUndefined()
  })
})
