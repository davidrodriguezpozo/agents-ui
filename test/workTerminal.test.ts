import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'

/**
 * Which shell `/api/terminal` means.
 *
 * The session terminal is handed a session id and reads the worktree off it.
 * There is no session on the Work view, so the shell is identified by the
 * project — which arrives two different ways, and that is most of what is worth
 * pinning down here. `$fetch` sends the `x-project-dir` header; `EventSource`
 * cannot send headers at all, so the stream has to work off a query parameter,
 * and a regression in either one is a terminal that opens somewhere else.
 *
 * The other half is what happens to a path nobody registered. `getProjectDir`
 * proves a directory is absolute and exists — not that it is yours — and this
 * function's whole job is to start a shell in whatever it is handed.
 */

let dir: string
let repoA: string
let repoB: string
let stranger: string
let projects: typeof import('../server/utils/projects')
let workTerminal: typeof import('../server/utils/workTerminal')

/** The Nitro auto-imports `scope.ts` and `workTerminal.ts` reach for. */
function installGlobals() {
  const g = globalThis as any
  g.getHeader = (event: any, name: string) => event?.headers?.[name]
  g.getQuery = (event: any) => event?.query ?? {}
  g.createError = (opts: { statusCode?: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts)
}

/** A stand-in for the parts of an H3 event that `getProjectDir` reads. */
function request(opts: { header?: string; query?: string } = {}): H3Event {
  return {
    headers: opts.header ? { 'x-project-dir': opts.header } : {},
    query: opts.query ? { projectDir: opts.query } : {},
  } as unknown as H3Event
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-work-terminal-'))
  repoA = join(dir, 'repo-a')
  repoB = join(dir, 'repo-b')
  stranger = join(dir, 'not-a-project')
  await mkdir(repoA, { recursive: true })
  await mkdir(repoB, { recursive: true })
  await mkdir(stranger, { recursive: true })

  installGlobals()
  process.env.CLAUDE_DIR = dir
  projects = await import('../server/utils/projects')
  workTerminal = await import('../server/utils/workTerminal')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui', 'projects.json'), { force: true })
  await rm(join(dir, 'agents-ui', 'projects.json.bak'), { force: true })
})

describe('resolveWorkTerminal', () => {
  it('takes the project from the header $fetch stamps on every request', async () => {
    await projects.addProject(repoA)
    await projects.setActiveProject(repoB)

    const target = await workTerminal.resolveWorkTerminal(request({ header: repoA }))

    expect(target.cwd).toBe(repoA)
  })

  /**
   * The branch the stream depends on. `new EventSource(url)` has no way to set
   * a header, so if this ever stopped working the Work view's terminal would
   * open in whichever project happened to be active rather than the one on
   * screen — and only for the output half, which is the confusing way round.
   */
  it('takes it from the query parameter, which is all EventSource can send', async () => {
    await projects.addProject(repoA)
    await projects.setActiveProject(repoB)

    const target = await workTerminal.resolveWorkTerminal(request({ query: repoA }))

    expect(target.cwd).toBe(repoA)
  })

  it('falls back to the active project when the request names none', async () => {
    await projects.setActiveProject(repoB)

    const target = await workTerminal.resolveWorkTerminal(request())

    expect(target.cwd).toBe(repoB)
  })

  it('refuses a directory that exists but is not a project', async () => {
    await projects.setActiveProject(repoA)

    await expect(workTerminal.resolveWorkTerminal(request({ query: stranger })))
      .rejects.toThrow(/Not a project/)
  })

  it('refuses when nothing is selected and nothing is active', async () => {
    await expect(workTerminal.resolveWorkTerminal(request()))
      .rejects.toThrow(/No project is selected/)
  })

  /**
   * One map holds every shell in the process, sessions included. A session id
   * that happened to equal a path would otherwise attach the Work view to
   * somebody's session shell.
   */
  it('namespaces the id so it cannot collide with a session id', async () => {
    await projects.setActiveProject(repoA)

    const target = await workTerminal.resolveWorkTerminal(request())

    expect(target.id).toBe(`work:${repoA}`)
    expect(target.id.startsWith('work:')).toBe(true)
  })

  it('gives one project one shell, however the request spelled it', async () => {
    await projects.addProject(repoA)

    const viaHeader = await workTerminal.resolveWorkTerminal(request({ header: repoA }))
    const viaQuery = await workTerminal.resolveWorkTerminal(request({ query: repoA }))

    expect(viaHeader.id).toBe(viaQuery.id)
  })
})
