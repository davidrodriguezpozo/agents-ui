import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_EDITOR,
  EDITOR_CHOICES,
  editorName,
  editorUrl,
  encodePathForUrl,
  isAbsolutePath,
  launchCommand,
  openInEditor,
  sanitiseEditor,
} from '../server/utils/editors'

/**
 * The URL is the whole feature. A handler given something it cannot parse opens
 * nothing and reports nothing, so every way a real path can break one of these
 * is worth a line here — a space in a directory name most of all, because
 * `~/Library/Application Support` and `My Project` are ordinary and `%20` is
 * not something a person types.
 */
describe('editorUrl', () => {
  it('builds the scheme each editor registers', () => {
    expect(editorUrl('vscode', '/Users/me/repo')).toBe('vscode://file/Users/me/repo')
    expect(editorUrl('cursor', '/Users/me/repo')).toBe('cursor://file/Users/me/repo')
    expect(editorUrl('zed', '/Users/me/repo')).toBe('zed://file/Users/me/repo')
  })

  it('reveals a folder through the operating system’s own file scheme', () => {
    // Three slashes: `file://` plus the path's own leading one.
    expect(editorUrl('finder', '/Users/me/repo')).toBe('file:///Users/me/repo')
  })

  it('percent-encodes a path containing a space', () => {
    expect(editorUrl('vscode', '/Users/me/My Project/.worktrees/fix a bug'))
      .toBe('vscode://file/Users/me/My%20Project/.worktrees/fix%20a%20bug')
    expect(editorUrl('finder', '/Users/me/My Project'))
      .toBe('file:///Users/me/My%20Project')
  })

  it('encodes the characters that would otherwise cut the URL short', () => {
    // `encodeURI` leaves both of these alone, which is why it is not used: the
    // hash would start a fragment and the editor would open the parent.
    expect(editorUrl('vscode', '/repos/issue#42')).toBe('vscode://file/repos/issue%2342')
    expect(editorUrl('vscode', '/repos/what?')).toBe('vscode://file/repos/what%3F')
    expect(editorUrl('vscode', '/repos/100%25')).toBe('vscode://file/repos/100%2525')
  })

  it('keeps non-ASCII names readable to the handler', () => {
    expect(editorUrl('zed', '/Users/me/café')).toBe('zed://file/Users/me/caf%C3%A9')
  })

  it('takes a Windows path as one path, with a slash before the drive', () => {
    expect(editorUrl('vscode', 'C:\\Users\\me\\My Repo'))
      .toBe('vscode://file/C:/Users/me/My%20Repo')
    expect(editorUrl('finder', 'C:\\Users\\me')).toBe('file:///C:/Users/me')
  })

  it('refuses a relative path rather than opening the wrong directory', () => {
    expect(() => editorUrl('vscode', '.worktrees/fix')).toThrow(/full path/)
    expect(() => editorUrl('vscode', '../repo')).toThrow(/full path/)
    expect(() => editorUrl('vscode', '~/repo')).toThrow(/full path/)
  })

  it('refuses an empty path', () => {
    expect(() => editorUrl('vscode', '')).toThrow(/No path/)
    expect(() => editorUrl('vscode', '   ')).toThrow(/No path/)
  })

  it('ignores surrounding whitespace', () => {
    expect(editorUrl('vscode', '  /Users/me/repo  ')).toBe('vscode://file/Users/me/repo')
  })
})

describe('isAbsolutePath', () => {
  it('accepts POSIX absolute and Windows drive paths', () => {
    expect(isAbsolutePath('/')).toBe(true)
    expect(isAbsolutePath('/Users/me')).toBe(true)
    expect(isAbsolutePath('C:\\Users')).toBe(true)
    expect(isAbsolutePath('c:/Users')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isAbsolutePath('repo')).toBe(false)
    expect(isAbsolutePath('./repo')).toBe(false)
    expect(isAbsolutePath('~/repo')).toBe(false)
    expect(isAbsolutePath('')).toBe(false)
  })
})

describe('encodePathForUrl', () => {
  it('leaves the separators alone', () => {
    expect(encodePathForUrl('/a/b/c')).toBe('/a/b/c')
  })

  it('does not encode the characters a path may hold literally', () => {
    expect(encodePathForUrl('/a-b/c_d.e~f')).toBe('/a-b/c_d.e~f')
  })

  it('keeps a drive letter a drive letter', () => {
    // `C%3A/` is not a drive to anything that reads one of these.
    expect(encodePathForUrl('C:\\a b')).toBe('C:/a%20b')
    expect(encodePathForUrl('c:/')).toBe('c:/')
  })
})

describe('sanitiseEditor', () => {
  it('passes through the four it knows', () => {
    for (const choice of EDITOR_CHOICES) expect(sanitiseEditor(choice)).toBe(choice)
  })

  it('falls back to the default for anything else', () => {
    // A hand-edited preferences file naming an editor with no scheme must not
    // leave the button launching nothing.
    expect(sanitiseEditor('sublime')).toBe(DEFAULT_EDITOR)
    expect(sanitiseEditor(undefined)).toBe(DEFAULT_EDITOR)
    expect(sanitiseEditor(null)).toBe(DEFAULT_EDITOR)
    expect(sanitiseEditor(7)).toBe(DEFAULT_EDITOR)
  })

  it('defaults to VS Code', () => {
    expect(DEFAULT_EDITOR).toBe('vscode')
  })
})

describe('editorName', () => {
  it('names the editors the way they name themselves', () => {
    expect(editorName('vscode')).toBe('VS Code')
    expect(editorName('cursor')).toBe('Cursor')
    expect(editorName('zed')).toBe('Zed')
  })

  it('names the file manager after the platform it is on', () => {
    // "Finder" is macOS's word for it, and telling a Linux user their worktree
    // opened in Finder would leave them wondering what did.
    const expected = process.platform === 'darwin'
      ? 'Finder'
      : process.platform === 'win32' ? 'File Explorer' : 'your file manager'
    expect(editorName('finder')).toBe(expected)
  })
})

describe('launchCommand', () => {
  it('uses whatever this platform opens a URL with', () => {
    const { command, args } = launchCommand('vscode://file/x')
    if (process.platform === 'darwin') {
      expect(command).toBe('open')
      expect(args).toEqual(['vscode://file/x'])
    } else if (process.platform === 'win32') {
      // The empty title matters: without it `start` reads the URL as the title.
      expect(command).toBe('cmd')
      expect(args).toEqual(['/c', 'start', '', 'vscode://file/x'])
    } else {
      expect(command).toBe('xdg-open')
      expect(args).toEqual(['vscode://file/x'])
    }
  })
})

/**
 * A worktree is removed when its session closes, and by hand more often than
 * that. Launching anyway gives a button that appears to do nothing, so the
 * check is here rather than left to the URL handler's own silence.
 */
describe('openInEditor', () => {
  const root = mkdtempSync(join(tmpdir(), 'editors-test-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('launches the URL for a directory that is there', async () => {
    const dir = join(root, 'a workspace')
    await mkdir(dir)

    const launched: { command: string; args: string[] }[] = []
    const result = await openInEditor('vscode', dir, (command, args) => {
      launched.push({ command, args })
    })

    expect(result.url).toBe(`vscode://file${dir.split('/').map(encodeURIComponent).join('/')}`)
    expect(result.url).toContain('a%20workspace')
    expect(result.name).toBe('VS Code')
    expect(launched).toHaveLength(1)
    expect(launched[0]!.args.at(-1)).toBe(result.url)
  })

  it('says the workspace is gone rather than launching nothing', async () => {
    const missing = join(root, 'closed-session')
    let launches = 0

    await expect(openInEditor('vscode', missing, () => { launches++ }))
      .rejects.toThrow(/no workspace at .*closed-session/)
    expect(launches).toBe(0)
  })

  it('refuses a path that is a file rather than a workspace', async () => {
    const file = join(root, 'notes.md')
    writeFileSync(file, 'not a worktree')

    await expect(openInEditor('finder', file, () => {})).rejects.toThrow(/no workspace at/)
  })

  it('refuses a relative path before it touches the disk', async () => {
    await expect(openInEditor('zed', 'relative/path', () => {})).rejects.toThrow(/full path/)
  })
})
