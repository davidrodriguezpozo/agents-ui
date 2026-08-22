import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describePerson, overrideNote, personKey, personName } from '../server/utils/identity'
import { describeLanded } from '../server/utils/landed'

const run = promisify(execFile)

;(globalThis as any).createError = (init: any) =>
  Object.assign(new Error(init?.data?.message ?? init?.message ?? 'error'), init)

/**
 * Who did this, and — more of the work — who it must refuse to say did this.
 *
 * Identity here is git's, so the half that cannot be tested by reading is tested
 * against real repositories: one that names somebody, one that names nobody at
 * all, and a merge whose commit has to carry the name of whoever overrode the
 * checks. The last of those is the brief's by-hand acceptance line, driven
 * through the real `mergeSession` rather than described.
 *
 * The failure this is all guarding against is a single one: a record with no
 * person on it reading as the person who happens to be looking. Every merge
 * before this field existed has no name, and so does every ritual, and both must
 * stay nameless rather than inherit whoever ran the query.
 */

let home: string
let repo: string

const git = (cwd: string, args: string[]) => run('git', args, { cwd })

async function newRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `agents-ui-${prefix}-`))
  await git(dir, ['init', '-q', '-b', 'main'])
  return dir
}

/**
 * Run something with git's global and system config pointed at files that do
 * not exist, which git reads as empty.
 *
 * Needed for every assertion about what a repository does *not* resolve. Whoever
 * runs this suite has a name in `~/.gitconfig` — that is the ordinary setup, and
 * it is why `gitIdentity` reads the resolved value rather than the local one —
 * so without this the tests below pass or fail depending on whose laptop it is.
 */
async function withoutInheritedConfig<T>(fn: () => Promise<T>): Promise<T> {
  const before = [process.env.GIT_CONFIG_GLOBAL, process.env.GIT_CONFIG_SYSTEM] as const
  process.env.GIT_CONFIG_GLOBAL = join(home, 'no-such-gitconfig')
  process.env.GIT_CONFIG_SYSTEM = join(home, 'no-such-gitsystem')

  try {
    return await fn()
  } finally {
    for (const [key, value] of [['GIT_CONFIG_GLOBAL', before[0]], ['GIT_CONFIG_SYSTEM', before[1]]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'agents-ui-identity-home-'))
  repo = await newRepo('identity-repo')
  process.env.CLAUDE_DIR = home

  await git(repo, ['config', 'user.name', 'Ada Lovelace'])
  await git(repo, ['config', 'user.email', 'Ada@Example.com'])
  await writeFile(join(repo, 'README.md'), 'start\n', 'utf-8')
  await git(repo, ['add', '-A'])
  await git(repo, ['commit', '-qm', 'first'])

  // Without it the base checkout has an untracked `.worktrees/` in it, reads as
  // dirty, and every merge below is refused — correctly. See `lander.test.ts`.
  await mkdir(join(repo, '.git', 'info'), { recursive: true })
  await writeFile(join(repo, '.git', 'info', 'exclude'), '.worktrees/\n', 'utf-8')

  // The stores cache the directory they were first asked about.
  vi.resetModules()
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true }).catch(() => {})
  await rm(repo, { recursive: true, force: true }).catch(() => {})
  delete process.env.CLAUDE_DIR
})

describe('reading git for a person', () => {
  it('takes the name and the email the repository resolves', async () => {
    const { gitIdentity } = await import('../server/utils/identity')

    expect(await gitIdentity(repo)).toEqual({ name: 'Ada Lovelace', email: 'Ada@Example.com' })
  })

  it('answers nobody for a repository with no identity configured', async () => {
    /*
     * The acceptance case, and the reason `git var GIT_COMMITTER_IDENT` is not
     * used anywhere: it would answer here too, with a name git invents from the
     * login and the hostname. That invented person would then be filed against
     * merges they did not take.
     */
    await withoutInheritedConfig(async () => {
      const bare = await newRepo('identity-bare')
      const { gitIdentity } = await import('../server/utils/identity')

      expect(await gitIdentity(bare)).toBeUndefined()
      await rm(bare, { recursive: true, force: true }).catch(() => {})
    })
  })

  it('answers nobody for a directory that is not a repository', async () => {
    // Same answer as an unconfigured one, and deliberately: there is nobody to
    // name either way, and the alternative is an exception thrown out of a merge.
    const { gitIdentity } = await import('../server/utils/identity')

    expect(await gitIdentity(join(home, 'not-a-repo'))).toBeUndefined()
  })

  it('takes a name without an email, and an email without a name', async () => {
    await withoutInheritedConfig(async () => {
      const { gitIdentity } = await import('../server/utils/identity')

      await git(repo, ['config', '--unset', 'user.email'])
      expect(await gitIdentity(repo)).toEqual({ name: 'Ada Lovelace' })

      await git(repo, ['config', '--unset', 'user.name'])
      await git(repo, ['config', 'user.email', 'ada@example.com'])
      expect(await gitIdentity(repo)).toEqual({ email: 'ada@example.com' })
    })
  })

  it('resolves what the person set globally, not only what this repository says', async () => {
    // The ordinary setup: one `~/.gitconfig` and no per-repository identity. A
    // reading of `--local` alone would call every one of those repositories
    // unattributed, which is most people's.
    const globalConfig = join(home, 'gitconfig')
    await writeFile(globalConfig, '[user]\n\tname = Grace Hopper\n\temail = grace@example.com\n', 'utf-8')

    await withoutInheritedConfig(async () => {
      process.env.GIT_CONFIG_GLOBAL = globalConfig

      const inherited = await newRepo('identity-inherited')
      const { gitIdentity } = await import('../server/utils/identity')

      expect(await gitIdentity(inherited)).toEqual({ name: 'Grace Hopper', email: 'grace@example.com' })
      await rm(inherited, { recursive: true, force: true }).catch(() => {})
    })
  })
})

describe('what makes two records the same person', () => {
  it('keys on the email, however it was capitalised', () => {
    // One person configuring `Ada@Example.com` on one machine and
    // `ada@example.com` on another is two rows in a table of money otherwise.
    expect(personKey({ name: 'Ada Lovelace', email: 'Ada@Example.com' })).toBe('ada@example.com')
    expect(personKey({ name: 'A. Lovelace', email: 'ada@example.com' })).toBe('ada@example.com')
  })

  it('falls back to the name when there is no email', () => {
    expect(personKey({ name: 'Ada Lovelace' })).toBe('Ada Lovelace')
  })

  it('has no key for nobody, which must never become a key', () => {
    // A group keyed on '' or 'unknown' is a row that reads like a person.
    expect(personKey(undefined)).toBeUndefined()
    expect(personKey({})).toBeUndefined()
    expect(personKey({ name: '  ' })).toBeUndefined()
  })
})

describe('naming the person in words', () => {
  it('gives the full form for a record or a commit', () => {
    expect(describePerson({ name: 'Ada Lovelace', email: 'ada@example.com' }))
      .toBe('Ada Lovelace <ada@example.com>')
  })

  it('gives the short form for prose', () => {
    expect(personName({ name: 'Ada Lovelace', email: 'ada@example.com' })).toBe('Ada Lovelace')
    expect(personName({ email: 'ada@example.com' })).toBe('ada@example.com')
  })

  it('says nothing at all when there is nobody', () => {
    expect(describePerson(undefined)).toBeUndefined()
    expect(personName({})).toBeUndefined()
  })
})

describe('the override note left in the merge commit', () => {
  it('names who took it', () => {
    expect(overrideNote({ name: 'Ada Lovelace', email: 'ada@example.com' }))
      .toBe('Override taken by Ada Lovelace <ada@example.com>.')
  })

  it('says why nobody is named rather than leaving a blank', () => {
    // "Override taken by ." reads as a bug in the app. This reads as a fact
    // about the repository, which is what it is.
    const note = overrideNote(undefined)

    expect(note).toMatch(/unnamed user/)
    expect(note).toMatch(/user\.name/)
  })
})

/**
 * The brief's by-hand line — *the merge dialog's override note names the person
 * in the commit message* — driven through the real merge instead.
 *
 * What is left unproven is only the click: that the dialog's **Merge anyway**
 * button posts `override: true`, which `sessions/[id]/merge.post.ts` passes
 * straight through. Everything after that is below.
 */
describe('merging over a failing check', () => {
  /** A session, as the app records one: a branch, a worktree, and a row on disk. */
  async function makeSession(id: string, check: 'failing' | 'passing') {
    const worktreePath = join(repo, '.worktrees', id)
    const baseSha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim()

    await git(repo, ['worktree', 'add', '-q', '-b', id, worktreePath, 'main'])
    await writeFile(join(worktreePath, `${id}.txt`), 'work\n', 'utf-8')
    await git(worktreePath, ['add', '-A'])
    await git(worktreePath, ['commit', '-qm', `work in ${id}`])

    const session = {
      id,
      title: `session ${id}`,
      repoDir: repo,
      worktreePath,
      branch: id,
      baseBranch: 'main',
      baseSha,
      status: 'idle',
      runIds: [],
      createdAt: 1,
      updatedAt: 1,
      check: {
        status: check,
        command: 'make check',
        // Deliberately not the workspace's real fingerprint: a stale verdict is
        // still a failing one, and the note must read the same either way.
        fingerprint: 'whatever',
        exitCode: check === 'failing' ? 1 : 0,
        output: '',
        durationMs: 1,
        at: 1,
      },
    }

    await mkdir(join(home, 'agents-ui'), { recursive: true })
    await writeFile(
      join(home, 'agents-ui', 'sessions.json'),
      JSON.stringify({ version: 1, sessions: [session] }),
      'utf-8',
    )

    return session as any
  }

  const lastMessage = async () => (await git(repo, ['log', '-1', '--format=%B', 'main'])).stdout

  it('names the person who took the override, in the commit', async () => {
    const { mergeSession } = await import('../server/utils/merge')
    const session = await makeSession('over', 'failing')

    const result = await mergeSession(session, { override: true })

    expect(result.overrodeChecks).toBe(true)
    expect(await lastMessage()).toContain('Merged with `make check` failing.')
    expect(await lastMessage()).toContain('Override taken by Ada Lovelace <Ada@Example.com>.')
  })

  it('files the same person against the landing', async () => {
    // The record and the history have to agree about one merge — otherwise the
    // ledger and `git log` answer "who" differently and neither can be trusted.
    const { mergeSession } = await import('../server/utils/merge')
    const { findSession } = await import('../server/utils/sessions')
    const session = await makeSession('filed', 'failing')

    await mergeSession(session, { override: true })

    const landed = (await findSession('filed'))?.landed
    expect(landed?.how).toBe('merged')
    expect(landed?.overrodeChecks).toBe(true)
    expect(landed?.by).toEqual({ name: 'Ada Lovelace', email: 'Ada@Example.com' })
  })

  it('leaves the message alone when nothing was overridden', async () => {
    // An ordinary merge is not a decision anybody has to answer for later, and a
    // commit that names its author twice is noise.
    const { mergeSession } = await import('../server/utils/merge')
    const session = await makeSession('clean', 'passing')

    await mergeSession(session)

    expect(await lastMessage()).not.toContain('Override taken by')
  })
})

describe('saying who landed it', () => {
  const ada = { name: 'Ada Lovelace', email: 'ada@example.com' }

  it('names the person on a merge this machine made', () => {
    expect(describeLanded({ at: 1, how: 'merged', into: 'main', by: ada }))
      .toBe('merged into main by Ada Lovelace')
  })

  it('keeps the override and the person in one sentence', () => {
    expect(describeLanded({ at: 1, how: 'merged', into: 'main', overrodeChecks: true, by: ada }))
      .toBe('merged into main, over a failing check by Ada Lovelace')
  })

  it('never names anybody for a merge somebody made on github.com', () => {
    /*
     * The one that would be actively wrong. `elsewhere` means this app did none
     * of it, so the only identity available is whoever's machine noticed — and
     * filing a colleague's merge under them is exactly the failure this field
     * exists to prevent.
     */
    expect(describeLanded({ at: 1, how: 'elsewhere', pr: 7, by: ada }))
      .toBe('#7 was merged on GitHub — not by this machine')
  })

  it('reads exactly as it always did when there is nobody on the record', () => {
    // Every landing from before this existed. Unattributed is silence, not a
    // guess and not a placeholder.
    expect(describeLanded({ at: 1, how: 'merged', into: 'main' })).toBe('merged into main')
  })
})
