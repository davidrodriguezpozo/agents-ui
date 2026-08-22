import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  describeCollisions,
  findCollisions,
  type CollisionCandidate,
} from '../server/utils/collisions'
import type { FileSymbols, SymbolMap } from '../server/utils/symbols'

/**
 * The name a merge takes away that somebody else is still calling.
 *
 * Two halves, tested two ways. The decision — which removals count and which
 * sessions are said to depend on them — is tested against symbol maps written
 * by hand, because a temp repository there is only scenery for a set
 * intersection.
 *
 * The other half is that the real thing produces those maps at all, and that is
 * tested against real worktrees on a real repository. The shapes that matter
 * belong to git rather than to us: a rename read out of a diff, a caller in a
 * file the renaming session never opened, and a session whose work has landed
 * and must therefore stop being counted. A fixture would encode whichever of
 * those we got wrong.
 */

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

function map(files: (Partial<FileSymbols> & { path: string })[]): SymbolMap {
  return {
    files: files.map(file => ({ language: 'ts', defined: [], removed: [], used: [], ...file })),
    skipped: [],
  }
}

function caller(id: string, map: SymbolMap): CollisionCandidate {
  return { session: { id, title: id }, map }
}

describe('findCollisions', () => {
  it('names the sessions calling a name this merge takes away', () => {
    const collisions = findCollisions(
      map([{ path: 'server/agent.ts', defined: ['pickAgent'], removed: ['resolveAgent'] }]),
      [
        caller('badge', map([{ path: 'app/Badge.vue', language: 'vue', used: ['resolveAgent'] }])),
        caller('rail', map([{ path: 'app/rail.ts', used: ['resolveAgent'] }])),
      ],
    )

    expect(collisions).toHaveLength(1)
    expect(collisions[0]!.name).toBe('resolveAgent')
    expect(collisions[0]!.path).toBe('server/agent.ts')
    expect(collisions[0]!.total).toBe(2)
    expect(collisions[0]!.sessions.map(s => s.id)).toEqual(['badge', 'rail'])
    expect(collisions[0]!.note).toBe(
      'gone from `server/agent.ts`, and 2 other sessions call it — "badge", "rail".',
    )
  })

  it('says nothing when the merge takes nothing away', () => {
    // The ordinary merge. Adding an export cannot break anybody's call site.
    expect(findCollisions(
      map([{ path: 'server/agent.ts', defined: ['resolveAgent', 'pickAgent'] }]),
      [caller('badge', map([{ path: 'app/rail.ts', used: ['resolveAgent'] }]))],
    )).toEqual([])
  })

  it('says nothing about a name no other session mentions', () => {
    // A name changed in a file nobody else imports from. This is the case that
    // decides whether the warning is worth reading at all: it is by far the
    // most common one, and it has to be silent.
    expect(findCollisions(
      map([{ path: 'server/agent.ts', removed: ['privateHelper'] }]),
      [caller('badge', map([{ path: 'app/rail.ts', used: ['somethingElse'] }]))],
    )).toEqual([])
  })

  it('treats a name moved between files as still there', () => {
    // Removed from one file, defined in another. The repository still has it
    // after this merge, so nothing that calls it is any worse off — and moving
    // a function is common enough that reporting it would be most of the noise.
    expect(findCollisions(
      map([
        { path: 'server/agent.ts', removed: ['resolveAgent'] },
        { path: 'server/agents/resolve.ts', defined: ['resolveAgent'] },
      ]),
      [caller('badge', map([{ path: 'app/rail.ts', used: ['resolveAgent'] }]))],
    )).toEqual([])
  })

  it('leaves a session alone when the name is one it declares itself', () => {
    // No module resolution here, so two unrelated `handler`s are one name. A
    // session that declares it in its own diff is using its own.
    expect(findCollisions(
      map([{ path: 'server/queue.ts', removed: ['handler'] }]),
      [caller('badge', map([{
        path: 'app/rail.ts',
        defined: ['handler'],
        used: ['handler'],
      }]))],
    )).toEqual([])
  })

  it('never reports a name of one or two characters', () => {
    expect(findCollisions(
      map([{ path: 'server/agent.ts', removed: ['id', 'fn', 'run'] }]),
      [caller('badge', map([{ path: 'app/rail.ts', used: ['id', 'fn', 'run'] }]))],
    ).map(c => c.name)).toEqual(['run'])
  })

  it('says nothing when there is nobody else in flight', () => {
    expect(findCollisions(
      map([{ path: 'server/agent.ts', removed: ['resolveAgent'] }]),
      [],
    )).toEqual([])
  })

  it('puts the most-depended-on name first and names only the first few', () => {
    const collisions = findCollisions(
      map([{ path: 'server/agent.ts', removed: ['oneCaller', 'manyCallers'] }]),
      [
        caller('a', map([{ path: 'a.ts', used: ['manyCallers'] }])),
        caller('b', map([{ path: 'b.ts', used: ['manyCallers'] }])),
        caller('c', map([{ path: 'c.ts', used: ['manyCallers'] }])),
        caller('d', map([{ path: 'd.ts', used: ['manyCallers', 'oneCaller'] }])),
      ],
    )

    expect(collisions.map(c => c.name)).toEqual(['manyCallers', 'oneCaller'])
    expect(collisions[0]!.total).toBe(4)
    expect(collisions[0]!.sessions.map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(collisions[0]!.note).toContain('and 1 more')
    expect(collisions[1]!.note).toBe('gone from `server/agent.ts`, and "d" calls it.')
  })
})

describe('describeCollisions', () => {
  it('counts, and says whose problem it is not', () => {
    const one = [{ name: 'a', path: 'p', sessions: [], total: 1, note: '' }]
    expect(describeCollisions(one)).toBe(
      'This merge takes away a name another session is still calling',
    )
    expect(describeCollisions([...one, ...one])).toBe(
      'This merge takes away 2 names other sessions are still calling',
    )
  })
})

/* -------------------------------------------------------------------------
 * The real thing, on real worktrees
 * ---------------------------------------------------------------------- */

let claudeDir: string
let repoDir: string
let collisions: typeof import('../server/utils/collisions')
let merge: typeof import('../server/utils/merge')
let sessions: typeof import('../server/utils/sessions')
let symbols: typeof import('../server/utils/symbols')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-collisions-cfg-'))
  process.env.CLAUDE_DIR = claudeDir

  repoDir = await mkdtemp(join(tmpdir(), 'agents-ui-collisions-repo-'))
  git(repoDir, 'init', '-q', '-b', 'main')
  git(repoDir, 'config', 'user.email', 'test@example.com')
  git(repoDir, 'config', 'user.name', 'Test')

  await mkdir(join(repoDir, 'server'), { recursive: true })
  await writeFile(join(repoDir, 'server', 'agent.ts'), [
    'export function resolveAgent(slug: string): string {',
    '  return slug',
    '}',
    '',
  ].join('\n'))
  await writeFile(join(repoDir, 'server', 'run.ts'), [
    'import { resolveAgent } from \'./agent\'',
    '',
    'export function run(slug: string): string {',
    '  return resolveAgent(slug)',
    '}',
    '',
  ].join('\n'))
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-q', '-m', 'initial')

  // What startSession does before making a worktree. Without it the worktrees
  // are untracked content and every merge is blocked on a dirty repository.
  await writeFile(join(repoDir, '.git', 'info', 'exclude'), '.worktrees/\n')

  collisions = await import('../server/utils/collisions')
  merge = await import('../server/utils/merge')
  sessions = await import('../server/utils/sessions')
  symbols = await import('../server/utils/symbols')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(repoDir, { recursive: true, force: true })
})

/** A session on its own branch and worktree, as startSession makes one. */
async function session(name: string, write: (worktreePath: string) => Promise<void>) {
  const worktreePath = join(repoDir, '.worktrees', name)
  git(repoDir, 'worktree', 'add', '-q', '-b', name, worktreePath, 'main')
  await write(worktreePath)
  git(worktreePath, 'add', '-A')
  git(worktreePath, 'commit', '-q', '-m', `work from ${name}`)

  return sessions.saveSession({
    id: name,
    title: name,
    repoDir,
    worktreePath,
    branch: name,
    baseBranch: 'main',
    baseSha: git(repoDir, 'rev-parse', 'main'),
    status: 'idle',
    runIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}

/** A file that calls `resolveAgent`, in a file the renaming session never opens. */
function callsIt(name: string) {
  return async (worktreePath: string) => {
    await writeFile(join(worktreePath, 'server', `${name}.ts`), [
      'import { resolveAgent } from \'./agent\'',
      '',
      `export function ${name}Badge(slug: string): string {`,
      '  return resolveAgent(slug).toUpperCase()',
      '}',
      '',
    ].join('\n'))
  }
}

describe('collisionsFor, on real worktrees', () => {
  it('finds the rename against the sessions that call it, and not the landed one', async () => {
    const renames = await session('renames-it', async (worktreePath) => {
      // The rename, and its own call site updated — which is what a session
      // doing this properly looks like, and must not read as a collision.
      await writeFile(join(worktreePath, 'server', 'agent.ts'), [
        'export function pickAgent(slug: string): string {',
        '  return slug',
        '}',
        '',
      ].join('\n'))
      await writeFile(join(worktreePath, 'server', 'run.ts'), [
        'import { pickAgent } from \'./agent\'',
        '',
        'export function run(slug: string): string {',
        '  return pickAgent(slug)',
        '}',
        '',
      ].join('\n'))
    })

    await session('calls-it', callsIt('calls'))
    const landed = await session('already-in', callsIt('already'))
    await sessions.patchSession(landed.id, {
      landed: { at: Date.now(), how: 'merged', into: 'main' },
    })

    symbols.forgetSymbolMaps()
    const found = await collisions.collisionsFor(renames, await sessions.readSessions())

    expect(found).toHaveLength(1)
    expect(found[0]!.name).toBe('resolveAgent')
    expect(found[0]!.path).toBe('server/agent.ts')
    // `already-in` calls it too, and is in. Counting it is the noise that gets
    // the whole warning ignored.
    expect(found[0]!.sessions.map(s => s.id)).toEqual(['calls-it'])
    expect(found[0]!.total).toBe(1)
  })

  it('says nothing about a session that takes nothing away', async () => {
    const adds = await session('adds-only', async (worktreePath) => {
      await writeFile(join(worktreePath, 'server', 'extra.ts'), [
        'export function extra(): number {',
        '  return 1',
        '}',
        '',
      ].join('\n'))
    })

    symbols.forgetSymbolMaps()
    expect(await collisions.collisionsFor(adds, await sessions.readSessions())).toEqual([])
  })

  it('says nothing about a review workspace, which will never merge', async () => {
    const renames = (await sessions.findSession('renames-it'))!

    symbols.forgetSymbolMaps()
    expect(await collisions.collisionsFor(
      { ...renames, detached: true },
      await sessions.readSessions(),
    )).toEqual([])
  })
})

/**
 * The by-hand acceptance, as far as this side of the boundary goes.
 *
 * The brief asks for two sessions where one renames something the other calls,
 * and for the dialog to say so. Everything up to the words is here: the preview
 * the dialog renders carries the note and the name. What no unattended session
 * can do is look at the rendered dialog, so that half is still somebody's to
 * press — `app/pages/sessions/[id].vue`, the block below the checks panel.
 */
describe('previewMerge', () => {
  it('carries the collision to the dialog, and still allows the merge', async () => {
    const renames = (await sessions.findSession('renames-it'))!

    symbols.forgetSymbolMaps()
    const preview = await merge.previewMerge(renames)

    expect(preview.collisionNote).toBe(
      'This merge takes away a name another session is still calling',
    )
    expect(preview.collisions?.[0]?.name).toBe('resolveAgent')
    expect(preview.collisions?.[0]?.note).toContain('"calls-it" calls it')

    // The point of the whole thing: git has no objection, so nothing is blocked.
    expect(preview.conflicts).toEqual([])
    expect(preview.canMerge).toBe(true)
  })
})
