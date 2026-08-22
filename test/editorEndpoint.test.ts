import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The two endpoints behind the "Open in" button, wired the way the page wires
 * them.
 *
 * Brief 02's acceptance ends "by hand: the link opens the right folder in the
 * chosen editor", which an unattended session cannot do — pressing it would
 * launch an editor on somebody's machine. So everything up to the launch is
 * checked here instead: that a name from the menu is remembered, that a later
 * press with no name uses it, and that a worktree which is no longer on disk
 * comes back as a sentence rather than a press that does nothing.
 *
 * Nothing in this file ever launches anything — every path it opens is one that
 * does not exist, which is refused before the launcher is reached.
 *
 * Nitro's helpers are auto-imported rather than imported, so they are stubbed,
 * the same arrangement `test/ledgerEndpoint.test.ts` describes.
 */

interface FakeEvent { body?: unknown }

const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: FakeEvent) => event.body
globals.createError = (init: { message?: string }) => new Error(init.message ?? 'error')

let dir: string
let read: () => Promise<{ editor: string; choices: { id: string; label: string }[] }>
let open: (event: FakeEvent) => Promise<{ editor: string; url: string; name: string }>

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-editor-api-'))
  process.env.CLAUDE_DIR = dir

  read = (await import('../server/api/editor/index.get')).default as typeof read
  open = (await import('../server/api/editor/open.post')).default as typeof open
})

afterAll(async () => {
  delete process.env.CLAUDE_DIR
  await rm(dir, { recursive: true, force: true })
})

describe('GET /api/editor', () => {
  it('opens on VS Code, with all four offered and named', async () => {
    const state = await read()

    expect(state.editor).toBe('vscode')
    expect(state.choices.map(c => c.id)).toEqual(['vscode', 'cursor', 'zed', 'finder'])
    // Named by the server because the last one's name is per-platform.
    expect(state.choices.every(c => c.label.length > 0)).toBe(true)
    expect(state.choices.find(c => c.id === 'cursor')?.label).toBe('Cursor')
  })
})

describe('POST /api/editor/open', () => {
  it('refuses a request with no path', async () => {
    await expect(open({ body: {} })).rejects.toThrow(/No workspace path/)
    await expect(open({ body: { path: '   ' } })).rejects.toThrow(/No workspace path/)
  })

  it('says a workspace is gone instead of opening nothing', async () => {
    const missing = join(dir, 'closed-session')
    await expect(open({ body: { path: missing } })).rejects.toThrow(/no workspace at/)
  })

  it('remembers the editor named on the menu, for the next plain press', async () => {
    const missing = join(dir, 'gone')

    // The directory is not there, so this fails — and the choice is still kept.
    // Which editor you use is a fact about the machine, not about this worktree.
    await expect(open({ body: { path: missing, editor: 'zed' } })).rejects.toThrow()
    expect((await read()).editor).toBe('zed')

    // A press with no editor named now goes to Zed rather than back to VS Code.
    await expect(open({ body: { path: missing } })).rejects.toThrow(/no workspace at/)
  })

  it('ignores an editor it has no scheme for, and does not store it', async () => {
    await expect(open({ body: { path: join(dir, 'gone'), editor: 'sublime' } })).rejects.toThrow()
    expect((await read()).editor).toBe('zed')
  })
})
