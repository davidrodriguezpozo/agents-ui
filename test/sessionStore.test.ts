import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Session } from '../server/utils/sessions'

/**
 * The session index is a single shared file, and losing it strands real work.
 * These cover the two ways that happens: concurrent writes dropping each
 * other's changes, and a damaged file being reported as "no sessions" — which
 * makes every live worktree look abandoned.
 */

let dir: string
let store: typeof import('../server/utils/sessions')
let sessionsFile: string

function stub(id: string): Session {
  return {
    id,
    title: `Session ${id}`,
    repoDir: '/repo',
    worktreePath: `/wt/${id}`,
    branch: `agents-ui/s-${id}`,
    baseBranch: 'main',
    baseSha: 'abc',
    status: 'idle',
    runIds: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-store-'))
  process.env.CLAUDE_DIR = dir
  store = await import('../server/utils/sessions')
  sessionsFile = join(dir, 'agents-ui', 'sessions.json')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
})

describe('concurrent writes', () => {
  it('keeps every session when many are saved at once', async () => {
    // Read-modify-write without a lock loses all but the last: each save writes
    // back a snapshot taken before the others landed.
    const ids = Array.from({ length: 25 }, (_, i) => `s${i}`)
    await Promise.all(ids.map(id => store.saveSession(stub(id))))

    const saved = await store.readSessions()
    expect(saved.map(s => s.id).sort()).toEqual([...ids].sort())
  })

  it('does not drop a patch made while another session is being saved', async () => {
    await store.saveSession(stub('a'))
    await store.saveSession(stub('b'))

    await Promise.all([
      store.patchSession('a', { title: 'Renamed A' }),
      store.patchSession('b', { title: 'Renamed B' }),
    ])

    const saved = await store.readSessions()
    expect(saved.find(s => s.id === 'a')?.title).toBe('Renamed A')
    expect(saved.find(s => s.id === 'b')?.title).toBe('Renamed B')
  })

  it('patches against current state rather than the caller\'s stale copy', async () => {
    await store.saveSession(stub('a'))

    await Promise.all([
      store.patchSession('a', { title: 'First' }),
      store.patchSession('a', { status: 'running' }),
    ])

    const saved = await store.findSession('a')
    // Whichever ordering won, neither field may be reverted to its old value.
    expect(saved?.status).toBe('running')
    expect(saved?.title).toBe('First')
  })
})

describe('releasing a stopped turn', () => {
  it('frees a running session so the composer comes back', async () => {
    await store.saveSession({ ...stub('a'), status: 'running' })

    await store.releaseRunningSession('a')

    expect((await store.findSession('a'))?.status).toBe('idle')
  })

  it('leaves a closed session closed', async () => {
    // A cancellation landing after the session was archived must not revive it.
    await store.saveSession({ ...stub('a'), status: 'archived' })

    await store.releaseRunningSession('a')

    expect((await store.findSession('a'))?.status).toBe('archived')
  })

  it('does nothing for a session that is already idle', async () => {
    await store.saveSession(stub('a'))

    await expect(store.releaseRunningSession('a')).resolves.toMatchObject({ status: 'idle' })
  })

  it('shrugs off a run whose session is gone', async () => {
    await expect(store.releaseRunningSession('missing')).resolves.toBeNull()
  })
})

describe('damaged index', () => {
  it('reports no sessions when the file has never existed', async () => {
    await expect(store.readSessions()).resolves.toEqual([])
  })

  it('falls back to the backup rather than losing everything', async () => {
    await store.saveSession(stub('a'))
    // A second write is what creates the backup of the first.
    await store.saveSession(stub('b'))
    await writeFile(sessionsFile, '{ this is not json', 'utf-8')

    const saved = await store.readSessions()
    expect(saved.map(s => s.id)).toEqual(['a'])
  })

  it('fails loudly when nothing is readable, instead of claiming zero sessions', async () => {
    // An empty list would mark every live worktree as orphaned and offer to
    // delete it, so silence here is worse than an error.
    await mkdir(join(dir, 'agents-ui'), { recursive: true })
    await writeFile(sessionsFile, 'corrupt', 'utf-8')

    await expect(store.readSessions()).rejects.toThrow(/unreadable/)
  })

  it('writes atomically, leaving no partial file behind', async () => {
    await store.saveSession(stub('a'))
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(join(dir, 'agents-ui'))
    expect(files.filter(f => f.endsWith('.tmp'))).toEqual([])
  })
})
