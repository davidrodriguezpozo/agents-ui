import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const run = promisify(execFile)

/**
 * Rewind, against real git.
 *
 * This destroys work on purpose, so reading it is not enough — everything below
 * builds an actual repository with an actual worktree and checks what is on
 * disk afterwards.
 *
 * The case that matters most is the last one: a rewind must not be able to
 * reach past the commit the session branched from. Below that is the rest of
 * the repository's history, which the session does not own and which no button
 * on a web page should be able to destroy.
 */

let home: string
let repo: string
let worktree: string
let baseSha: string
let rewind: typeof import('../server/utils/rewind')

const git = (cwd: string, args: string[]) => run('git', args, { cwd })

async function commitAll(cwd: string, message: string) {
  await git(cwd, ['add', '-A'])
  await git(cwd, ['commit', '-q', '-m', message])
}

beforeEach(async () => {
  rewind = await import('../server/utils/rewind')

  home = await mkdtemp(join(tmpdir(), 'agents-ui-rewind-'))
  repo = join(home, 'repo')
  await mkdir(repo, { recursive: true })

  await git(repo, ['init', '-q', '-b', 'main'])
  await git(repo, ['config', 'user.email', 't@t'])
  await git(repo, ['config', 'user.name', 't'])
  await writeFile(join(repo, 'kept.txt'), 'from before the session\n')
  await writeFile(join(repo, '.gitignore'), 'ignored/\n')
  await commitAll(repo, 'base commit')

  baseSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim()

  worktree = join(repo, '.worktrees', 's1')
  await git(repo, ['worktree', 'add', '-q', '-b', 's1', worktree, 'main'])
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true }).catch(() => {})
})

const session = () => ({ worktreePath: worktree, baseSha })

describe('saying what a rewind would cost', () => {
  it('names the files rather than counting them', async () => {
    await writeFile(join(worktree, 'kept.txt'), 'changed by the agent\n')
    await writeFile(join(worktree, 'new.txt'), 'brand new\n')

    const preview = await rewind.previewRewind(session())

    expect(preview.changed).toEqual(['kept.txt'])
    expect(preview.untracked).toEqual(['new.txt'])
    expect(preview.canDiscard).toBe(true)
  })

  it('lists this session\'s commits and none from before it', async () => {
    await writeFile(join(worktree, 'a.txt'), 'a\n')
    await commitAll(worktree, 'first turn')
    await writeFile(join(worktree, 'b.txt'), 'b\n')
    await commitAll(worktree, 'second turn')

    const preview = await rewind.previewRewind(session())

    expect(preview.commits.map(c => c.subject)).toEqual(['second turn', 'first turn'])
    expect(preview.canUndoCommit).toBe(true)
  })

  it('offers nothing on an untouched workspace', async () => {
    const preview = await rewind.previewRewind(session())

    expect(preview.canDiscard).toBe(false)
    expect(preview.canUndoCommit).toBe(false)
  })

  it('says so when the workspace is gone rather than throwing', async () => {
    const preview = await rewind.previewRewind({ worktreePath: join(home, 'nope'), baseSha })
    expect(preview.unavailable).toBeTruthy()
  })
})

describe('throwing away uncommitted work', () => {
  it('puts tracked files back and deletes new ones', async () => {
    await writeFile(join(worktree, 'kept.txt'), 'changed by the agent\n')
    await writeFile(join(worktree, 'new.txt'), 'brand new\n')

    const result = await rewind.rewind(session(), 'uncommitted')

    expect(result.done).toBe(true)
    await expect(readFile(join(worktree, 'kept.txt'), 'utf-8'))
      .resolves.toBe('from before the session\n')
    expect(existsSync(join(worktree, 'new.txt'))).toBe(false)
  })

  it('leaves ignored files alone, so a setup run is not thrown away with it', async () => {
    // `node_modules` is the real case: gitignored, expensive, and nothing to do
    // with the change being discarded.
    await mkdir(join(worktree, 'ignored'), { recursive: true })
    await writeFile(join(worktree, 'ignored', 'dep.txt'), 'expensive\n')
    await writeFile(join(worktree, 'kept.txt'), 'changed\n')

    await rewind.rewind(session(), 'uncommitted')

    expect(existsSync(join(worktree, 'ignored', 'dep.txt'))).toBe(true)
  })

  it('keeps committed work, which is not what was asked for', async () => {
    await writeFile(join(worktree, 'a.txt'), 'a\n')
    await commitAll(worktree, 'first turn')
    await writeFile(join(worktree, 'a.txt'), 'a changed\n')

    await rewind.rewind(session(), 'uncommitted')

    // Back to the commit, not past it.
    await expect(readFile(join(worktree, 'a.txt'), 'utf-8')).resolves.toBe('a\n')
  })

  it('names a directory as a directory, since git counts it as one entry', async () => {
    // "3 files" is a lie when one of the three holds a few thousand, which is
    // what an un-ignored build directory looks like from here.
    await mkdir(join(worktree, 'generated'), { recursive: true })
    await writeFile(join(worktree, 'generated', 'a.txt'), 'a\n')
    await writeFile(join(worktree, 'generated', 'b.txt'), 'b\n')
    await writeFile(join(worktree, 'kept.txt'), 'changed\n')

    const result = await rewind.rewind(session(), 'uncommitted')

    expect(result.message).toContain('1 file')
    expect(result.message).toContain('generated/')
    expect(existsSync(join(worktree, 'generated'))).toBe(false)
  })

  it('refuses when there is nothing to throw away', async () => {
    const result = await rewind.rewind(session(), 'uncommitted')

    expect(result.done).toBe(false)
    expect(result.message).toMatch(/nothing uncommitted/i)
  })
})

describe('undoing a turn', () => {
  it('takes the last commit off and leaves the one before', async () => {
    await writeFile(join(worktree, 'a.txt'), 'a\n')
    await commitAll(worktree, 'first turn')
    await writeFile(join(worktree, 'b.txt'), 'b\n')
    await commitAll(worktree, 'second turn')

    const result = await rewind.rewind(session(), 'commit')

    expect(result.done).toBe(true)
    expect(result.message).toContain('second turn')
    expect(existsSync(join(worktree, 'b.txt'))).toBe(false)
    expect(existsSync(join(worktree, 'a.txt'))).toBe(true)
  })

  it('can undo the session\'s only commit, back to the base', async () => {
    await writeFile(join(worktree, 'a.txt'), 'a\n')
    await commitAll(worktree, 'only turn')

    const result = await rewind.rewind(session(), 'commit')

    expect(result.done).toBe(true)
    expect(existsSync(join(worktree, 'a.txt'))).toBe(false)
    const head = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim()
    expect(head).toBe(baseSha)
  })

  /**
   * The one that matters. At the base there is nothing of this session's left,
   * and the next commit down belongs to the repository's own history.
   */
  it('refuses to go back past where the session branched', async () => {
    const result = await rewind.rewind(session(), 'commit')

    expect(result.done).toBe(false)
    expect(result.message).toMatch(/branched|nothing of this session/i)

    // And the base commit is still there, with the file that came before.
    const head = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim()
    expect(head).toBe(baseSha)
    await expect(readFile(join(worktree, 'kept.txt'), 'utf-8'))
      .resolves.toBe('from before the session\n')
  })

  it('still refuses after every one of its own commits has been undone', async () => {
    await writeFile(join(worktree, 'a.txt'), 'a\n')
    await commitAll(worktree, 'only turn')

    await rewind.rewind(session(), 'commit')
    const second = await rewind.rewind(session(), 'commit')

    expect(second.done).toBe(false)
    expect((await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(baseSha)
  })
})
