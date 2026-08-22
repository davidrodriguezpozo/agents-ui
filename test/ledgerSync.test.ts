import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Two instances, one repository, and no server between them.
 *
 * This is the brief's by-hand acceptance — two checkouts on one machine
 * pointed at different `CLAUDE_DIR`s producing one total — done for real
 * rather than described: a bare repository stands in for the remote, two
 * clones stand in for two colleagues, and the assertions are the things that
 * would be silently wrong if the transport were subtly broken. That the second
 * push does not need a force. That it does not take the first one's file away
 * with it. That pulling does not overwrite the file this instance is still
 * appending to. And that none of it touches the working tree the repository's
 * owner is using, which is the failure that would be noticed last and hurt
 * most.
 */

let remote: string
let repoA: string
let repoB: string
let storeA: string
let storeB: string
let claudeDir: typeof import('../server/utils/claudeDir')
let ledger: typeof import('../server/utils/sharedLedger')
let sync: typeof import('../server/utils/ledgerSync')

const BRANCH = 'agents-studio/ledger'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function turn(id: string, at: number, costUsd: number, person?: string) {
  return {
    v: 1, id: `turn:${id}`, event: 'turn' as const, at, costUsd,
    ...(person ? { person } : {}),
  }
}

/** Point every module at one instance's store. */
function asInstance(store: string) {
  claudeDir.setClaudeDir(store)
}

beforeAll(async () => {
  remote = await mkdtemp(join(tmpdir(), 'agents-ui-ledger-remote-'))
  git(remote, 'init', '--bare', '-q', '-b', 'main')

  const seed = await mkdtemp(join(tmpdir(), 'agents-ui-ledger-seed-'))
  git(seed, 'init', '-q', '-b', 'main')
  git(seed, 'config', 'user.email', 'seed@example.com')
  git(seed, 'config', 'user.name', 'Seed')
  git(seed, 'commit', '-q', '--allow-empty', '-m', 'first')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', '-q', 'origin', 'main')
  await rm(seed, { recursive: true, force: true })

  const clones = await Promise.all([
    mkdtemp(join(tmpdir(), 'agents-ui-ledger-a-')),
    mkdtemp(join(tmpdir(), 'agents-ui-ledger-b-')),
  ])
  repoA = join(clones[0], 'repo')
  repoB = join(clones[1], 'repo')

  for (const [parent, path] of [[clones[0], repoA], [clones[1], repoB]] as const) {
    git(parent, 'clone', '-q', remote, path)
    git(path, 'config', 'user.email', 'dev@example.com')
    git(path, 'config', 'user.name', 'Dev')
  }

  storeA = await mkdtemp(join(tmpdir(), 'agents-ui-ledger-store-a-'))
  storeB = await mkdtemp(join(tmpdir(), 'agents-ui-ledger-store-b-'))
  process.env.CLAUDE_DIR = storeA

  claudeDir = await import('../server/utils/claudeDir')
  ledger = await import('../server/utils/sharedLedger')
  sync = await import('../server/utils/ledgerSync')
})

afterAll(async () => {
  for (const dir of [remote, repoA, repoB, storeA, storeB]) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('pushing what this instance wrote', () => {
  it('says there is nothing to push before anything is written', async () => {
    asInstance(storeA)

    expect(await sync.pushLedger({ repoDir: repoA })).toMatchObject({ pushed: false, skip: 'nothing-to-push' })
  })

  it('makes the branch on the first push', async () => {
    asInstance(storeA)
    await ledger.appendLocalLedger([turn('a1', 1_000, 3, 'ada@example.com')])

    const result = await sync.pushLedger({ repoDir: repoA })

    expect(result.pushed).toBe(true)
    expect(git(repoA, 'ls-remote', '--heads', 'origin', BRANCH)).toContain(BRANCH)
  })

  it('leaves the working tree and the checked-out branch exactly as they were', async () => {
    asInstance(storeA)
    const head = git(repoA, 'rev-parse', 'HEAD')
    const branch = git(repoA, 'rev-parse', '--abbrev-ref', 'HEAD')

    await ledger.appendLocalLedger([turn('a2', 2_000, 1, 'ada@example.com')])
    await sync.pushLedger({ repoDir: repoA })

    // The repository's owner may well be mid-session in here. Nothing above is
    // allowed to check anything out, stash anything, or move HEAD.
    expect(git(repoA, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(repoA, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(branch)
    expect(git(repoA, 'status', '--porcelain')).toBe('')
  })

  it('does nothing the second time, rather than committing the date', async () => {
    asInstance(storeA)

    expect(await sync.pushLedger({ repoDir: repoA })).toMatchObject({ pushed: false, skip: 'up-to-date' })
  })

  it('lands a second machine beside the first, without a force', async () => {
    asInstance(storeB)
    await ledger.appendLocalLedger([turn('b1', 3_000, 2, 'grace@example.com')])

    const result = await sync.pushLedger({ repoDir: repoB })
    expect(result.pushed).toBe(true)

    // The concatenation: both files present on the branch, neither rewritten.
    git(repoB, 'fetch', '-q', 'origin', BRANCH)
    const listed = git(repoB, 'ls-tree', '-r', '--name-only', 'FETCH_HEAD', '--', 'ledger/')

    expect(listed.split('\n').filter(Boolean)).toHaveLength(2)
  })

  it('reports a repository with no remote instead of failing', async () => {
    asInstance(storeA)
    const lonely = await mkdtemp(join(tmpdir(), 'agents-ui-ledger-lonely-'))
    git(lonely, 'init', '-q', '-b', 'main')

    expect(await sync.pushLedger({ repoDir: lonely })).toMatchObject({ skip: 'no-remote' })

    await rm(lonely, { recursive: true, force: true })
  })
})

describe('pulling what everybody else wrote', () => {
  it('brings the other machine in and leaves this one alone', async () => {
    asInstance(storeA)
    // Written after A last pushed, so the copy on the branch is behind this
    // file. A pull that overwrote it would drop this line.
    await ledger.appendLocalLedger([turn('a3', 4_000, 5, 'ada@example.com')])

    const result = await sync.pullLedger({ repoDir: repoA })

    expect(result.machines).toHaveLength(1)
    const ours = await ledger.readLedgerFiles()
    const mine = ours.find(f => f.text.includes('turn:a3'))
    expect(mine).toBeTruthy()
  })

  it('adds up to one total across both machines', async () => {
    asInstance(storeA)

    const team = ledger.teamLedger(await ledger.readLedgerFiles())

    // Three turns from A, one from B, and both people named.
    expect(team.machines).toHaveLength(2)
    expect(team.totals).toMatchObject({ turns: 4, costUsd: 11 })
    expect(team.people.map(p => p.person).sort()).toEqual(['ada@example.com', 'grace@example.com'])
  })

  it('says so when nobody has pushed the branch yet', async () => {
    asInstance(storeA)
    const fresh = await mkdtemp(join(tmpdir(), 'agents-ui-ledger-fresh-'))
    const bare = join(fresh, 'bare')
    const clone = join(fresh, 'clone')
    git(fresh, 'init', '--bare', '-q', '-b', 'main', bare)
    git(fresh, 'clone', '-q', bare, clone)

    expect(await sync.pullLedger({ repoDir: clone })).toMatchObject({ skip: 'no-branch', machines: [] })

    await rm(fresh, { recursive: true, force: true })
  })

  it('runs both halves in one call', async () => {
    asInstance(storeB)
    await ledger.appendLocalLedger([turn('b2', 5_000, 1, 'grace@example.com')])

    const { push, pull } = await sync.syncLedger({ repoDir: repoB })

    expect(push.pushed).toBe(true)
    // A's file, which B had never seen.
    expect(pull.machines).toHaveLength(1)

    // Four, not five: A's third turn was appended after A last pushed, so it
    // is still only on A's disk. What a colleague sees is what was pushed, and
    // an instance that has not synced yet is behind rather than lost.
    expect(ledger.teamLedger(await ledger.readLedgerFiles()).totals.turns).toBe(4)
  })
})
