import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OUR_DIR, isConfigured } from '../server/utils/claudeDir'

/**
 * What somebody with no Claude Code set-up sees first.
 *
 * The welcome used to appear when `~/.claude` did not exist. That condition can
 * never be true by the time anyone looks: this app writes its own storage into
 * `~/.claude/agents-ui` while it boots, which creates the directory. Found by
 * installing into a container with nothing on it — the whole directory
 * contained `agents-ui` and nothing else, `exists` came back true, and the
 * welcome never fired at the one person it was written for.
 *
 * So the question asked is whether there is a set-up here, not whether there is
 * a directory.
 */

let dir: string
let claudeDir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-cold-'))
  claudeDir = join(dir, '.claude')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await rm(claudeDir, { recursive: true, force: true })
})

describe('a machine with no Claude Code on it', () => {
  it('is not configured when the directory is not there at all', () => {
    expect(isConfigured(claudeDir)).toBe(false)
  })

  it('is still not configured once we have made our own storage', async () => {
    // Exactly what booting does, and the whole reason this is not `existsSync`.
    await mkdir(join(claudeDir, OUR_DIR), { recursive: true })

    expect(isConfigured(claudeDir)).toBe(false)
  })

  it('does not count a stray .DS_Store as a set-up', async () => {
    // Opening the folder in Finder is not configuring Claude Code.
    await mkdir(claudeDir, { recursive: true })
    await writeFile(join(claudeDir, '.DS_Store'), '')

    expect(isConfigured(claudeDir)).toBe(false)
  })
})

describe('a machine that is already set up', () => {
  it('is configured the moment there is a file of theirs', async () => {
    await mkdir(join(claudeDir, OUR_DIR), { recursive: true })
    await writeFile(join(claudeDir, 'settings.json'), '{}')

    expect(isConfigured(claudeDir)).toBe(true)
  })

  it('counts a directory of theirs, not only a file', async () => {
    await mkdir(join(claudeDir, 'skills'), { recursive: true })

    expect(isConfigured(claudeDir)).toBe(true)
  })

  it('does not offer to set up a directory it cannot read', async () => {
    // Unreadable is not the same as empty, and the wrong answer here throws a
    // welcome screen at somebody who has years of configuration behind it.
    await mkdir(claudeDir, { recursive: true })
    await import('node:fs/promises').then(fs => fs.chmod(claudeDir, 0o000))

    const answer = isConfigured(claudeDir)
    await import('node:fs/promises').then(fs => fs.chmod(claudeDir, 0o755))

    expect(answer).toBe(true)
  })
})
