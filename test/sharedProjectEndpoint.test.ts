import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.createError = (init: any) => Object.assign(new Error(init.data?.message ?? init.message), init)
globals.getQuery = () => ({})
// `getProjectDir` falls back to the request's own scope, which is a header here.
globals.getHeader = () => undefined
globals.getCookie = () => undefined

/**
 * Sharing, from the button's end.
 *
 * The endpoint copies *this machine's* answer into the repository rather than
 * taking one from the request, and that is the behaviour worth pinning: a
 * request body that could name the value would make "share what I have" into
 * "write whatever you like into a tracked file". The other half is that sharing
 * a guess is refused — a detected command written into the file would read as a
 * decision somebody made.
 */

let claudeDir: string
let repo: string
let checks: typeof import('../server/utils/checks')
let sandbox: typeof import('../server/utils/sandbox')
let post: (event: unknown) => Promise<any>
let get: (event: unknown) => Promise<any>

const SHARED = join('.claude', 'agents-studio.json')

function asking(body: Record<string, unknown>) {
  globals.readBody = async () => body
  return {}
}

beforeEach(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-share-cfg-'))
  process.env.CLAUDE_DIR = claudeDir
  repo = await mkdtemp(join(tmpdir(), 'agents-ui-share-repo-'))

  const claude = await import('../server/utils/claudeDir')
  claude.setClaudeDir(claudeDir)

  checks = await import('../server/utils/checks')
  sandbox = await import('../server/utils/sandbox')
  post = (await import('../server/api/project/shared.post')).default as unknown as (e: unknown) => Promise<any>
  get = (await import('../server/api/project/shared.get')).default as unknown as (e: unknown) => Promise<any>
})

afterEach(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(repo, { recursive: true, force: true })
})

describe('sharing the check command', () => {
  it('writes what this machine has chosen, and leaves it in force', async () => {
    await checks.setCheckCommand(repo, 'make check')

    const result = await post(asking({ dir: repo, what: 'checks' }))

    expect(result.shared).toBe(true)
    expect(JSON.parse(await readFile(join(repo, SHARED), 'utf8')).checks).toEqual({ command: 'make check' })
    // Unchanged in force: the machine still overrides the repository, which is
    // what makes the button safe to press.
    expect(await checks.checkCommandFor(repo)).toMatchObject({ command: 'make check', source: 'configured' })
  })

  it('refuses to share a guess as though somebody had decided it', async () => {
    await expect(post(asking({ dir: repo, what: 'checks' }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('shares "this project has no checks", which is a real answer', async () => {
    await checks.setCheckCommand(repo, '')

    await post(asking({ dir: repo, what: 'checks' }))

    expect(JSON.parse(await readFile(join(repo, SHARED), 'utf8')).checks).toEqual({ command: '' })
  })

  it('takes it out again without touching anything else in the file', async () => {
    await checks.setCheckCommand(repo, 'make check')
    await sandbox.setProjectSandbox(repo, { enabled: false })
    await post(asking({ dir: repo, what: 'checks' }))
    await post(asking({ dir: repo, what: 'sandbox' }))

    await post(asking({ dir: repo, what: 'checks', stop: true }))
    const file = JSON.parse(await readFile(join(repo, SHARED), 'utf8'))

    expect(file.checks).toBeUndefined()
    expect(file.sandbox).toEqual({ enabled: false, allowedDomains: [] })
  })

  it('is what the repository answers with afterwards', async () => {
    await checks.setCheckCommand(repo, 'make check')
    await post(asking({ dir: repo, what: 'checks' }))
    await checks.clearCheckCommand(repo)

    // With no machine answer, the shared one is in force and says where from.
    const resolved = await checks.checkCommandFor(repo)
    expect(resolved).toMatchObject({ command: 'make check', source: 'repository' })
    expect(resolved!.from).toContain('agents-studio.json')
  })
})

describe('sharing the sandbox', () => {
  it('writes the whole record rather than half of one', async () => {
    await sandbox.setProjectSandbox(repo, { enabled: true, allowedDomains: ['registry.npmjs.org'] })

    await post(asking({ dir: repo, what: 'sandbox' }))

    expect(JSON.parse(await readFile(join(repo, SHARED), 'utf8')).sandbox).toEqual({
      enabled: true,
      allowedDomains: ['registry.npmjs.org'],
    })
  })

  it('refuses when nothing has been chosen here', async () => {
    await expect(post(asking({ dir: repo, what: 'sandbox' }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('applies once the machine has no answer of its own', async () => {
    await sandbox.setProjectSandbox(repo, { enabled: false })
    await post(asking({ dir: repo, what: 'sandbox' }))
    await sandbox.clearProjectSandbox(repo)

    expect(await sandbox.sandboxForProject(repo)).toMatchObject({ enabled: false, source: 'repository' })
  })
})

describe('reading the shared half', () => {
  it('says what is shared and what is wrong with it', async () => {
    await checks.setCheckCommand(repo, 'make check')
    await post(asking({ dir: repo, what: 'checks' }))

    globals.getQuery = () => ({ dir: repo })
    const result = await get({})

    expect(result).toMatchObject({ dir: repo, exists: true, problems: [] })
    expect(result.config.checks).toEqual({ command: 'make check' })
    expect(result.file).toBe(SHARED)
  })

  it('is quiet about a project that shares nothing', async () => {
    globals.getQuery = () => ({ dir: repo })

    expect(await get({})).toMatchObject({ exists: false, config: {}, problems: [] })
  })
})

describe('what it refuses outright', () => {
  it('needs a project', async () => {
    await expect(post(asking({ what: 'checks' }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('needs to be told what to share', async () => {
    await expect(post(asking({ dir: repo }))).rejects.toMatchObject({ statusCode: 400 })
    await expect(post(asking({ dir: repo, what: 'everything' }))).rejects.toMatchObject({ statusCode: 400 })
  })
})
