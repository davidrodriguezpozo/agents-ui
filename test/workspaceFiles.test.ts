import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * This server runs as you, with no authentication in front of it, and now takes
 * a file path from a request and writes to it. The scoping is the entire
 * feature; everything else is `readFile`.
 *
 * So the tests that matter are the escapes. Each one below is a way a file
 * browser that looks sandboxed turns out not to be.
 */

let root: string
let workspace: string
let outside: string
let files: typeof import('../server/utils/workspaceFiles')

beforeAll(async () => {
  files = await import('../server/utils/workspaceFiles')
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agents-ui-ws-'))
  workspace = join(root, 'session')
  outside = join(root, 'secrets')

  await mkdir(join(workspace, 'src'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(workspace, 'README.md'), '# hello\n')
  await writeFile(join(workspace, 'src', 'app.ts'), 'export const a = 1\n')
  await writeFile(join(outside, 'id_rsa'), 'PRIVATE KEY\n')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {})
})

describe('refusing to leave the workspace', () => {
  it('refuses a path that climbs out', async () => {
    await expect(files.resolveInWorkspace(workspace, '../secrets/id_rsa'))
      .rejects.toThrow(/outside/i)
  })

  it('refuses one that climbs out and back down again', async () => {
    await expect(files.resolveInWorkspace(workspace, 'src/../../secrets/id_rsa'))
      .rejects.toThrow(/outside/i)
  })

  it('refuses an absolute path', async () => {
    // `resolve` would otherwise take it wholesale and ignore the workspace.
    await expect(files.resolveInWorkspace(workspace, '/etc/passwd'))
      .rejects.toThrow(/outside/i)
  })

  it('refuses a symlink inside the workspace that points out of it', async () => {
    // The one a check on the composed path misses entirely, which is what makes
    // a sandboxed-looking browser not one.
    await symlink(outside, join(workspace, 'escape'))

    await expect(files.resolveInWorkspace(workspace, 'escape/id_rsa'))
      .rejects.toThrow(/outside/i)
  })

  it('refuses reading through that symlink too, not only resolving it', async () => {
    await symlink(join(outside, 'id_rsa'), join(workspace, 'key'))

    await expect(files.readWorkspaceFile(workspace, 'key')).rejects.toThrow(/outside/i)
  })

  it('refuses writing through it, which is the one that does damage', async () => {
    await symlink(join(outside, 'id_rsa'), join(workspace, 'key'))

    await expect(files.writeWorkspaceFile(workspace, 'key', 'overwritten'))
      .rejects.toThrow(/outside/i)

    // And the file it pointed at is untouched.
    const still = await files.readWorkspaceFile(outside, 'id_rsa')
    expect(still.content).toBe('PRIVATE KEY\n')
  })
})

describe('a sibling whose name merely starts the same way', () => {
  it('is not mistaken for a child', () => {
    // A string prefix check says /work/session-2 is inside /work/session.
    expect(files.isInside('/work/session', '/work/session-2')).toBe(false)
    expect(files.isInside('/work/session', '/work/session-2/file.ts')).toBe(false)
  })

  it('still counts the workspace itself and things genuinely in it', () => {
    expect(files.isInside('/work/session', '/work/session')).toBe(true)
    expect(files.isInside('/work/session', '/work/session/src/app.ts')).toBe(true)
  })
})

describe('what it does when the path is fine', () => {
  it('reads a file', async () => {
    await expect(files.readWorkspaceFile(workspace, 'README.md'))
      .resolves.toMatchObject({ content: '# hello\n' })
  })

  it('writes one, and reads back what was written', async () => {
    await files.writeWorkspaceFile(workspace, 'src/app.ts', 'export const a = 2\n')

    await expect(files.readWorkspaceFile(workspace, 'src/app.ts'))
      .resolves.toMatchObject({ content: 'export const a = 2\n' })
  })

  it('creates a file that was not there', async () => {
    // A path that does not exist yet is a new file, not an escape.
    await files.writeWorkspaceFile(workspace, 'src/new.ts', 'ok\n')

    await expect(files.readWorkspaceFile(workspace, 'src/new.ts'))
      .resolves.toMatchObject({ content: 'ok\n' })
  })

  it('lists a directory, directories first', async () => {
    const entries = await files.listDirectory(workspace)

    expect(entries.map(e => e.name)).toEqual(['src', 'README.md'])
    expect(entries[0]).toMatchObject({ kind: 'directory', path: 'src' })
  })

  it('hides the directories nobody opens by hand', async () => {
    await mkdir(join(workspace, 'node_modules'), { recursive: true })
    await mkdir(join(workspace, '.git'), { recursive: true })

    const names = (await files.listDirectory(workspace)).map(e => e.name)
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.git')
  })

  it('hides .git when it is a file, which is what it is in a worktree', async () => {
    // A worktree's `.git` holds a `gitdir:` pointer rather than being a
    // directory, so skipping only directories showed it in every session.
    await writeFile(join(workspace, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n')

    expect((await files.listDirectory(workspace)).map(e => e.name)).not.toContain('.git')
  })

  it('still shows the dotfiles worth editing', async () => {
    await writeFile(join(workspace, '.editorconfig'), 'root = true\n')

    expect((await files.listDirectory(workspace)).map(e => e.name)).toContain('.editorconfig')
  })

  it('refuses an escape as a bad request rather than a server fault', async () => {
    // A 500 reads as "the app broke" and buries the sentence that explains it.
    await expect(files.resolveInWorkspace(workspace, '../secrets/id_rsa'))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('what it will not open', () => {
  it('refuses a binary file rather than showing mojibake', async () => {
    // Offering to save what it showed would corrupt the file on the way out.
    await writeFile(join(workspace, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]))

    await expect(files.readWorkspaceFile(workspace, 'logo.png')).rejects.toThrow(/binary/i)
  })

  it('refuses one too large to be edited by hand', async () => {
    await writeFile(join(workspace, 'big.txt'), 'x'.repeat(files.MAX_EDITABLE_BYTES + 1))

    await expect(files.readWorkspaceFile(workspace, 'big.txt')).rejects.toThrow(/past what/i)
  })

  it('refuses to treat a directory as a file, in either direction', async () => {
    await expect(files.readWorkspaceFile(workspace, 'src')).rejects.toThrow(/directory/i)
    await expect(files.writeWorkspaceFile(workspace, 'src', 'x')).rejects.toThrow(/directory/i)
  })

  it('spots a NUL byte anywhere in the first chunk', () => {
    expect(files.looksBinary(Buffer.from('plain text'))).toBe(false)
    expect(files.looksBinary(Buffer.concat([Buffer.from('text'), Buffer.from([0])]))).toBe(true)
  })
})
