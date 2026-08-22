import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * The step between what this machine did and what it is willing to say.
 *
 * Two decisions live here and both would be invisible if they were wrong. The
 * window has to apply to sessions as well as to the run log, or the very first
 * collect writes a line for every landing this machine has ever made. And the
 * whole thing has to be repeatable, because it runs on the way to rendering a
 * page: a second collect over an overlapping window must add nothing rather
 * than double the totals.
 */

let claudeDir: string
let sessions: typeof import('../server/utils/sessions')
let collect: typeof import('../server/utils/ledgerCollect')
let ledger: typeof import('../server/utils/sharedLedger')

const NOW = 1_700_000_000_000
const DAY = 86_400_000

function session(id: string, at: number) {
  return {
    id,
    title: 'a title that must never reach another machine',
    repoDir: '/tmp/repo',
    worktreePath: `/tmp/repo/.worktrees/${id}`,
    branch: id,
    baseBranch: 'main',
    baseSha: 'abc123',
    createdAt: at,
    landed: { at, how: 'merged' as const, by: { name: 'Ada', email: 'ada@example.com' } },
  }
}

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-collect-'))
  process.env.CLAUDE_DIR = claudeDir

  sessions = await import('../server/utils/sessions')
  collect = await import('../server/utils/ledgerCollect')
  ledger = await import('../server/utils/sharedLedger')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
})

describe('collecting what this machine did', () => {
  it('writes the recent outcomes and leaves the ancient ones alone', async () => {
    await sessions.writeSessions([
      session('recent', NOW - 2 * DAY) as never,
      // Older than the window: real, and not what a shared ledger is for.
      session('ancient', NOW - 400 * DAY) as never,
    ])

    const collected = await collect.collectLocalLedger(NOW)
    expect(collected.added).toBe(1)

    const files = await ledger.readLedgerFiles()
    const text = files.map(file => file.text).join('')

    expect(text).toContain('landing:recent')
    expect(text).not.toContain('landing:ancient')
  })

  it('carries the person and not the prose', async () => {
    const [file] = await ledger.readLedgerFiles()

    expect(file!.text).toContain('ada@example.com')
    // The one thing that must never cross a machine boundary.
    expect(file!.text).not.toContain('must never reach')
  })

  it('adds nothing the second time, which is how often a page load calls it', async () => {
    const again = await collect.collectLocalLedger(NOW)

    expect(again).toMatchObject({ added: 0, skipped: 1 })
  })

  it('counts a landing once however often it is collected', async () => {
    await collect.collectLocalLedger(NOW)
    await collect.collectLocalLedger(NOW + 60_000)

    const team = ledger.teamLedger(await ledger.readLedgerFiles())
    expect(team.totals.landings).toBe(1)
  })

  it('says nothing was added rather than throwing when a store cannot be read', async () => {
    // A store that is not there any more. Whether the read comes back empty or
    // throws, what a page on its way to rendering gets is a number, not an
    // exception.
    const { setClaudeDir } = await import('../server/utils/claudeDir')
    const gone = await mkdtemp(join(tmpdir(), 'agents-ui-collect-gone-'))
    setClaudeDir(gone)
    await rm(gone, { recursive: true, force: true })

    await expect(collect.collectLocalLedger(NOW)).resolves.toEqual({ added: 0, skipped: 0 })

    setClaudeDir(claudeDir)
  })
})
