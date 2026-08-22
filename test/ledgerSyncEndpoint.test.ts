import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The one endpoint here that runs git in a directory a browser named.
 *
 * That is the whole reason it is tested. Everything else about syncing is
 * covered where it lives, but "which directory" arrives in a request body, and
 * the only thing standing between that and running git wherever it says is the
 * check against the projects this app already knows. A regression there would
 * not fail any other test and would not look like a bug from the page.
 */

const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.createError = (init: any) => Object.assign(new Error(init.data?.message ?? init.message), init)

let claudeDir: string
let repo: string
let projects: typeof import('../server/utils/projects')
let sync: (event: unknown) => Promise<any>

beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-ledger-endpoint-'))
  process.env.CLAUDE_DIR = claudeDir

  repo = await mkdtemp(join(tmpdir(), 'agents-ui-ledger-endpoint-repo-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })

  projects = await import('../server/utils/projects')
  await projects.addProject(repo)

  sync = (await import('../server/api/ledger/sync.post')).default as unknown as (event: unknown) => Promise<any>
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(repo, { recursive: true, force: true })
})

/** The one field this endpoint reads off the request. */
function asking(repoDir?: string) {
  globals.readBody = async () => (repoDir === undefined ? {} : { repoDir })
  return {}
}

describe('syncing through a repository the caller names', () => {
  it('refuses a path that is not one of your projects', async () => {
    await expect(sync(asking('/etc'))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('refuses to be called with no repository at all', async () => {
    await expect(sync(asking())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('does not add the path it was handed', async () => {
    await sync(asking('/etc')).catch(() => {})

    expect((await projects.readProjects()).map(p => p.path)).not.toContain('/etc')
  })

  it('answers with what happened rather than failing when there is nowhere to push', async () => {
    // A registered project with no remote: ordinary, and the answer is a
    // sentence the page can render, not a 500.
    const result = await sync(asking(repo))

    // Nothing recorded on this machine yet, so the push stops before it ever
    // asks about a remote — the cheaper question first. The pull has no such
    // shortcut and reports the missing remote.
    expect(result.push).toMatchObject({ pushed: false, skip: 'nothing-to-push' })
    expect(result.pull).toMatchObject({ skip: 'no-remote', machines: [] })
    expect(result.repoDir).toBe(repo)
    expect(result.totals).toBeTruthy()
  })
})
