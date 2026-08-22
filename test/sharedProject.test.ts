import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  parseShared,
  readSharedProject,
  ritualProblems,
  scoped,
  SHARED_FILE,
  updateSharedProject,
} from '../server/utils/sharedProject'

/**
 * The file a colleague wrote.
 *
 * Everything else this app reads was written by itself, on this disk, by this
 * version. This one arrives in a `git pull`, possibly from a newer version,
 * possibly with a typo, and possibly naming a directory that only exists on the
 * machine it was written on. So the cases that matter are the bad ones: each has
 * to produce a sentence somebody can act on rather than a definition that
 * silently does not exist here.
 */

let repo: string

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'agents-ui-shared-'))
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

async function write(body: unknown) {
  await mkdir(join(repo, '.claude'), { recursive: true })
  await writeFile(join(repo, SHARED_FILE), typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
}

const ritual = {
  key: 'nightly-brief',
  title: 'Nightly brief',
  input: '/hd:goodmorning',
  recurrence: { hour: 8, minute: 0, days: [1, 2, 3, 4, 5] },
}

describe('reading the shared half', () => {
  it('treats a project that shares nothing as the normal case', async () => {
    const read = await readSharedProject(repo)

    expect(read).toMatchObject({ exists: false, config: {}, problems: [] })
  })

  it('reads a check command, a sandbox rule and a ritual', async () => {
    await write({
      version: 1,
      checks: { command: 'make check' },
      sandbox: { enabled: true, allowedDomains: ['registry.npmjs.org'] },
      rituals: [ritual],
    })

    const read = await readSharedProject(repo)

    expect(read.problems).toEqual([])
    expect(read.config.checks).toEqual({ command: 'make check' })
    expect(read.config.sandbox).toEqual({ enabled: true, allowedDomains: ['registry.npmjs.org'] })
    expect(read.config.rituals).toHaveLength(1)
    expect(read.config.rituals![0]!.key).toBe('nightly-brief')
  })

  it('says so when the file is not JSON, rather than ignoring it quietly', async () => {
    await write('{ half a file')

    const read = await readSharedProject(repo)

    expect(read.exists).toBe(true)
    expect(read.config).toEqual({})
    expect(read.problems).toHaveLength(1)
    expect(read.problems[0]!.message).toContain('not valid JSON')
  })

  it('keeps the entries around an invalid one', async () => {
    await write({ rituals: [ritual, { key: 'broken' }, { ...ritual, key: 'second' }] })

    const read = await readSharedProject(repo)

    expect(read.config.rituals!.map(r => r.key)).toEqual(['nightly-brief', 'second'])
    expect(read.problems.map(p => p.at)).toContain('rituals[1].title')
  })

  it('refuses a key that could not be the same in two checkouts', async () => {
    const read = parseShared({ rituals: [{ ...ritual, key: 'Nightly Brief!' }] }, '/x/.claude/agents-studio.json')

    expect(read.config.rituals).toBeUndefined()
    expect(read.problems[0]!.message).toContain('lower case')
  })

  it('uses the first of two rituals that share a key, and says it did', async () => {
    const read = parseShared(
      { rituals: [ritual, { ...ritual, title: 'The other one' }] },
      '/x/.claude/agents-studio.json',
    )

    expect(read.config.rituals).toHaveLength(1)
    expect(read.config.rituals![0]!.title).toBe('Nightly brief')
    expect(read.problems[0]!.message).toContain('share the key')
  })

  it('rejects a recurrence that is not a time of day', async () => {
    const read = parseShared(
      { rituals: [{ ...ritual, recurrence: { hour: 25, minute: 0, days: [] } }] },
      '/x/.claude/agents-studio.json',
    )

    expect(read.config.rituals).toBeUndefined()
    expect(read.problems[0]!.at).toBe('rituals[0].recurrence.hour')
  })

  it('reports a file from a newer version and still reads what it can', async () => {
    await write({ version: 99, checks: { command: 'make check' } })

    const read = await readSharedProject(repo)

    expect(read.config.checks).toEqual({ command: 'make check' })
    expect(read.problems[0]!.at).toBe('version')
    expect(read.problems[0]!.message).toContain('newer version')
  })

  it('ignores a field it cannot use without losing the rest', async () => {
    await write({ checks: { command: 7 }, sandbox: { enabled: 'yes', allowedDomains: ['a.example'] } })

    const read = await readSharedProject(repo)

    expect(read.config.checks).toBeUndefined()
    expect(read.config.sandbox).toEqual({ allowedDomains: ['a.example'] })
    expect(read.problems.map(p => p.at).sort()).toEqual(['checks.command', 'sandbox.enabled'])
  })

  it('refuses a required path that points outside the repository', async () => {
    const read = parseShared(
      { rituals: [{ ...ritual, requires: ['../../etc/passwd', 'scripts/nightly.sh'] }] },
      join(repo, SHARED_FILE),
    )

    expect(read.config.rituals![0]!.requires).toEqual(['scripts/nightly.sh'])
    expect(read.problems.some(p => p.message.includes('outside the repository'))).toBe(true)
  })
})

describe('a shared ritual this checkout cannot run', () => {
  it('is listed, and says what it is missing', async () => {
    await write({ rituals: [{ ...ritual, requires: ['scripts/nightly.sh'] }] })

    const read = await readSharedProject(repo)

    // Listed rather than dropped: it is a valid ritual that cannot work here,
    // and the fix is on this machine rather than in the file.
    expect(read.config.rituals).toHaveLength(1)
    expect(read.problems[0]!.message).toContain('not in this checkout')
    expect(read.problems[0]!.message).toContain('will not be run here')
  })

  it('says nothing once the path is there', async () => {
    await mkdir(join(repo, 'scripts'), { recursive: true })
    await writeFile(join(repo, 'scripts/nightly.sh'), '#!/bin/sh\n', 'utf8')
    await write({ rituals: [{ ...ritual, requires: ['scripts/nightly.sh'] }] })

    expect((await readSharedProject(repo)).problems).toEqual([])
  })

  it('is a fact about the checkout, so it is asked per machine', () => {
    expect(ritualProblems({ ...ritual, requires: ['nope'] }, repo)).toHaveLength(1)
    expect(ritualProblems(ritual, repo)).toEqual([])
  })
})

describe('writing the shared half', () => {
  it('creates the file, formatted to be read as a diff', async () => {
    await updateSharedProject(repo, (config) => { config.checks = { command: 'make check' } })

    const text = await readFile(join(repo, SHARED_FILE), 'utf8')

    expect(text).toBe(`{\n  "version": 1,\n  "checks": {\n    "command": "make check"\n  }\n}\n`)
  })

  it('keeps fields a newer version wrote', async () => {
    await write({ version: 1, checks: { command: 'old' }, somethingNewer: { kept: true } })

    await updateSharedProject(repo, (config) => { config.checks = { command: 'new' } })
    const text = JSON.parse(await readFile(join(repo, SHARED_FILE), 'utf8'))

    // Dropping it would make an upgrade look like data loss in somebody's diff.
    expect(text.somethingNewer).toEqual({ kept: true })
    expect(text.checks).toEqual({ command: 'new' })
  })

  it('reads back what it wrote', async () => {
    const read = await updateSharedProject(repo, (config) => {
      config.rituals = [ritual]
    })

    expect(read.config.rituals).toHaveLength(1)
    expect(read.exists).toBe(true)
  })

  it('leaves nothing behind for a half that was cleared', async () => {
    await updateSharedProject(repo, (config) => { config.checks = { command: 'make check' } })
    await updateSharedProject(repo, (config) => { delete config.checks })

    expect(JSON.parse(await readFile(join(repo, SHARED_FILE), 'utf8')).checks).toBeUndefined()
  })
})

describe('precedence', () => {
  it('lets this machine override the repository', () => {
    expect(scoped('mine', 'ours', 'default', '/repo/file')).toEqual({ value: 'mine', scope: 'machine' })
  })

  it('falls back to the repository, and says which file said so', () => {
    expect(scoped(undefined, 'ours', 'default', '/repo/file')).toEqual({
      value: 'ours', scope: 'repository', from: '/repo/file',
    })
  })

  it('falls back to the built-in default when neither has an answer', () => {
    expect(scoped(undefined, undefined, 'default')).toEqual({ value: 'default', scope: 'default' })
  })

  it('treats a deliberate empty value as an answer, not as an absence', () => {
    // The check command is the case: "" is how a project says it has no checks,
    // and it has to beat a shared command rather than fall through to it.
    expect(scoped('', 'make check', '')).toEqual({ value: '', scope: 'machine' })
  })

  it('goes back to the team answer when the override is removed', () => {
    expect(scoped(undefined, 'ours', 'default', '/repo/file').value).toBe('ours')
  })
})
