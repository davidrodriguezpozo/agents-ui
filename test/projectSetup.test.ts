import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Making a session's workspace runnable.
 *
 * A worktree is a bare checkout — tracked files and nothing else. Without this
 * step the project's checks run against a workspace that cannot run anything,
 * which is why fifteen real sessions had no verdict between them.
 */

let claudeDir: string
let setup: typeof import('../server/utils/projectSetup')

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-setup-cfg-'))
  process.env.CLAUDE_DIR = claudeDir
  setup = await import('../server/utils/projectSetup')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
})

beforeEach(() => setup.forgetPrepared())

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agents-ui-setup-repo-'))
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), contents)
  }
  return dir
}

describe('detectSetupCommand', () => {
  it('picks the package manager from the lockfile, not from what is installed', async () => {
    const bun = await project({ 'package.json': '{}', 'bun.lockb': '' })
    expect(setup.detectSetupCommand(bun)?.command).toBe('bun install')

    const pnpm = await project({ 'package.json': '{}', 'pnpm-lock.yaml': '' })
    expect(setup.detectSetupCommand(pnpm)?.command).toBe('pnpm install')
  })

  it('uses `npm ci` only when there is a lockfile for it to use', async () => {
    // `npm ci` fails outright without one, which would look like a broken
    // workspace rather than a wrong guess.
    const withLock = await project({ 'package.json': '{}', 'package-lock.json': '{}' })
    expect(setup.detectSetupCommand(withLock)?.command).toBe('npm ci')

    const without = await project({ 'package.json': '{}' })
    expect(setup.detectSetupCommand(without)?.command).toBe('npm install')
  })

  it('knows non-JavaScript projects need fetching too', async () => {
    expect(setup.detectSetupCommand(await project({ 'Cargo.toml': '' }))?.command).toBe('cargo fetch')
    expect(setup.detectSetupCommand(await project({ 'go.mod': '' }))?.command).toBe('go mod download')
  })

  it('says nothing about a repository it cannot recognise', async () => {
    expect(setup.detectSetupCommand(await project({ 'README.md': 'hi' }))).toBeNull()
  })
})

describe('setupCommandFor', () => {
  it('prefers what the project was told over what can be guessed', async () => {
    const dir = await project({ 'package.json': '{}', 'bun.lockb': '' })
    await setup.setSetupCommand(dir, 'make bootstrap')

    expect(await setup.setupCommandFor(dir)).toMatchObject({
      command: 'make bootstrap', source: 'configured',
    })
  })

  it('treats an empty command as "this needs nothing", not as unset', async () => {
    const dir = await project({ 'package.json': '{}', 'bun.lockb': '' })
    await setup.setSetupCommand(dir, '')

    // Otherwise a project whose checkouts are ready as they are would be
    // asked to install on every single check, forever.
    expect(await setup.setupCommandFor(dir)).toBeNull()
  })

  it('goes back to guessing once the choice is cleared', async () => {
    const dir = await project({ 'package.json': '{}', 'bun.lockb': '' })
    await setup.setSetupCommand(dir, 'make bootstrap')
    await setup.clearSetupCommand(dir)

    expect(await setup.setupCommandFor(dir)).toMatchObject({ source: 'detected' })
  })
})

describe('prepareWorkspace', () => {
  it('runs the command in the workspace, not in the repository', async () => {
    // The whole point: the repository is already set up; the worktree is not.
    const dir = await project({ 'package.json': '{}' })
    await setup.setSetupCommand(dir, 'touch prepared.txt')

    const workspace = join(dir, 'workspace')
    await mkdir(workspace)

    expect(await setup.prepareWorkspace(dir, workspace)).toMatchObject({ status: 'ready' })
    expect(existsSync(join(workspace, 'prepared.txt'))).toBe(true)
    expect(existsSync(join(dir, 'prepared.txt'))).toBe(false)
  })

  it('does it once, however many checks ask', async () => {
    const dir = await project({ 'package.json': '{}' })
    await setup.setSetupCommand(dir, 'sh -c "echo x >> count.txt"')

    const workspace = join(dir, 'once')
    await mkdir(workspace)

    await Promise.all([
      setup.prepareWorkspace(dir, workspace),
      setup.prepareWorkspace(dir, workspace),
      setup.prepareWorkspace(dir, workspace),
    ])
    await setup.prepareWorkspace(dir, workspace)

    const { readFileSync } = await import('node:fs')
    expect(readFileSync(join(workspace, 'count.txt'), 'utf-8').trim().split('\n')).toHaveLength(1)
  })

  it('skips a project that says it needs nothing', async () => {
    const dir = await project({ 'README.md': 'hi' })
    const workspace = join(dir, 'nothing')
    await mkdir(workspace)

    expect(await setup.prepareWorkspace(dir, workspace)).toMatchObject({ status: 'skipped' })
  })

  it('reports a failure instead of letting it look like broken code', async () => {
    const dir = await project({ 'package.json': '{}' })
    await setup.setSetupCommand(dir, 'exit 1')

    const workspace = join(dir, 'broken')
    await mkdir(workspace)

    const outcome = await setup.prepareWorkspace(dir, workspace)
    expect(outcome.status).toBe('failed')
    expect(outcome.message).toContain('exit 1')
  })

  it('will try a failed setup again, since a blip should not be permanent', async () => {
    const dir = await project({ 'package.json': '{}' })
    await setup.setSetupCommand(dir, 'exit 1')

    const workspace = join(dir, 'retry')
    await mkdir(workspace)

    expect((await setup.prepareWorkspace(dir, workspace)).status).toBe('failed')

    await setup.setSetupCommand(dir, 'true')
    expect((await setup.prepareWorkspace(dir, workspace)).status).toBe('ready')
  })

  it('says so plainly when the workspace is not there', async () => {
    const dir = await project({ 'package.json': '{}' })
    await setup.setSetupCommand(dir, 'true')

    expect(await setup.prepareWorkspace(dir, join(dir, 'never-made'))).toMatchObject({
      status: 'failed',
    })
  })
})
