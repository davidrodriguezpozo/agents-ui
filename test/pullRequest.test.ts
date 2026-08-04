import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commitsBetween, defaultRemote, suggestBody, suggestTitle } from '../server/utils/pullRequest'

const exec = promisify(execFile)

/**
 * Opening a pull request is the only thing this app does that other people
 * can see, so what it would write is worth pinning down — and reading the
 * commits is done against a real repository rather than a mocked one, because
 * the format string is the part that breaks.
 */

describe('what it would call the pull request', () => {
  it('uses the commit subject when there is only one', () => {
    // One commit describes the whole change; the session title is a paraphrase.
    expect(suggestTitle('Fix the totals', [{ sha: 'a', subject: 'fix: round tax to whole cents' }]))
      .toBe('fix: round tax to whole cents')
  })

  it('falls back to the session title when there are several', () => {
    // The first subject describes a step, not the change.
    const commits = [
      { sha: 'a', subject: 'wip' },
      { sha: 'b', subject: 'fix the actual thing' },
    ]

    expect(suggestTitle('Fix the totals', commits)).toBe('Fix the totals')
  })

  it('falls back to the title when there are no commits at all', () => {
    expect(suggestTitle('Fix the totals', [])).toBe('Fix the totals')
  })
})

describe('what it would write in the body', () => {
  const commits = [{ sha: 'a', subject: 'first' }, { sha: 'b', subject: 'second' }]

  it('lists the commits when there is more than one', () => {
    const body = suggestBody(commits, [])

    expect(body).toContain('- first')
    expect(body).toContain('- second')
  })

  it('does not list a single commit, which the title already says', () => {
    expect(suggestBody([commits[0]!], [])).not.toContain('## Commits')
  })

  it('lists the files, and says how many it left out', () => {
    const files = Array.from({ length: 25 }, (_, i) => `src/file-${i}.ts`)
    const body = suggestBody(commits, files)

    expect(body).toContain('src/file-0.ts')
    expect(body).toContain('and 5 more')
  })

  it('says an agent wrote it', () => {
    // Not to discount the work — because it changes what a reviewer looks for.
    expect(suggestBody(commits, [])).toMatch(/Claude Code session/)
  })
})

describe('reading commits from a real repository', () => {
  let repo: string

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'agents-ui-pr-'))
    const git = (args: string[]) => exec('git', args, { cwd: repo })

    await git(['init', '-q', '-b', 'main'])
    await git(['config', 'user.email', 'test@example.com'])
    await git(['config', 'user.name', 'Test'])
    await writeFile(join(repo, 'a.txt'), 'one', 'utf-8')
    await git(['add', '-A'])
    await git(['commit', '-q', '-m', 'base'])
    await git(['checkout', '-q', '-b', 'work'])
    await writeFile(join(repo, 'b.txt'), 'two', 'utf-8')
    await git(['add', '-A'])
    // A subject with the kind of punctuation that breaks naive parsing.
    await git(['commit', '-q', '-m', 'feat: handle "quotes", commas and | pipes'])
  })

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true })
  })

  it('reads the commits a branch adds, subject intact', async () => {
    const commits = await commitsBetween(repo, 'main', 'work')

    expect(commits).toHaveLength(1)
    expect(commits[0]!.subject).toBe('feat: handle "quotes", commas and | pipes')
    expect(commits[0]!.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('reports nothing when the branch adds nothing', async () => {
    await expect(commitsBetween(repo, 'main', 'main')).resolves.toEqual([])
  })

  it('reports no remote rather than guessing one', async () => {
    await expect(defaultRemote(repo)).resolves.toBeNull()
  })

  it('prefers origin once there is more than one remote', async () => {
    await exec('git', ['remote', 'add', 'upstream', 'https://example.com/u.git'], { cwd: repo })
    await exec('git', ['remote', 'add', 'origin', 'https://example.com/o.git'], { cwd: repo })

    await expect(defaultRemote(repo)).resolves.toBe('origin')
  })
})
