import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'

/**
 * Leaving for a real editor, in one press.
 *
 * The workspace panes here are deliberately young — a diff, a file tree, a
 * terminal, for finishing rather than living in. That only holds together if
 * the way out is a button, and until this existed it was not: a session told
 * you its worktree path and left you to select it, switch application and
 * paste it into an open dialog. Twenty seconds, several times an hour, for
 * something the operating system already has a URL scheme for.
 *
 * So: build the URL, and hand it to whatever this machine uses to open a URL.
 * That is `open` on macOS, `xdg-open` on Linux, `start` on Windows — the same
 * three the CLI's `openUrl` picks between, and the same reason it is a URL and
 * not an executable name. `code`, `cursor` and `zed` are shell commands that
 * may or may not be on `PATH`; `vscode://`, `cursor://` and `zed://` are
 * registered by the applications themselves at install time, which means this
 * needs no configuration and no detection.
 *
 * Two things are checked before anything is launched, because a handler that
 * receives a URL it cannot use fails silently and the button looks broken:
 *
 *   - The path is absolute. A relative path in a `file` URL resolves against
 *     nothing in particular and would open the wrong directory rather than
 *     none, which is worse.
 *   - The directory still exists. A worktree is removed when its session is
 *     closed, and by hand more often than that; saying so is the difference
 *     between an error and a press that does nothing at all.
 */

/**
 * The four this offers. Three editors and the file manager, which is not an
 * editor but is the honest answer for anyone using something that has no URL
 * scheme — it puts the directory on screen, from where their own editor is
 * whatever they normally do with a folder.
 */
export type EditorChoice = 'vscode' | 'cursor' | 'zed' | 'finder'

/** In the order the menu draws them. */
export const EDITOR_CHOICES: EditorChoice[] = ['vscode', 'cursor', 'zed', 'finder']

/**
 * What each one is called, for the menu and for the sentence afterwards.
 *
 * "Finder" is macOS's name for it and wrong everywhere else, so the label is
 * decided by the platform rather than baked in — a Linux user being told their
 * worktree opened in Finder would reasonably wonder what did.
 */
export function editorName(editor: EditorChoice): string {
  if (editor !== 'finder') return { vscode: 'VS Code', cursor: 'Cursor', zed: 'Zed' }[editor]
  if (process.platform === 'darwin') return 'Finder'
  if (process.platform === 'win32') return 'File Explorer'
  return 'your file manager'
}

/**
 * VS Code, because it is the one most likely to be installed and the one whose
 * absence is most obvious. A wrong default costs a single trip through the menu
 * on the button, which is where the choice lives.
 */
export const DEFAULT_EDITOR: EditorChoice = 'vscode'

/** A stored or hand-edited value, made safe to switch on. */
export function sanitiseEditor(value: unknown): EditorChoice {
  return EDITOR_CHOICES.includes(value as EditorChoice) ? value as EditorChoice : DEFAULT_EDITOR
}

/**
 * Everything before the path, per choice.
 *
 * The three editors take `<scheme>://file/<path>` — `file` there is the URL's
 * authority, and it is how they distinguish opening a path from the other
 * things their scheme does. `file://` has no authority at all, which is why it
 * is spelled out here rather than assembled from a scheme name: `file://file/x`
 * would name a host called "file" and resolve to nothing.
 */
const PREFIXES: Record<EditorChoice, string> = {
  vscode: 'vscode://file',
  cursor: 'cursor://file',
  zed: 'zed://file',
  finder: 'file://',
}

/**
 * POSIX absolute, or a Windows drive letter. Nothing else is a path this can
 * put in a URL and be sure of what it opens.
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)
}

/**
 * Percent-encode a path without eating its separators.
 *
 * `encodeURI` is the obvious reach and the wrong one: it leaves `#` and `?`
 * alone, so a directory called `feature#2` would truncate the URL at the hash
 * and the editor would open the parent. Encoding each segment on its own
 * encodes everything a segment cannot contain literally — spaces, `#`, `?`,
 * `%` — and joins them back with the one character that has to stay.
 *
 * Backslashes are normalised first so a Windows path arrives as one path
 * rather than one segment containing slashes it never meant, and the drive
 * letter is set aside rather than encoded: `C%3A/` is not a drive to anything
 * that reads these, and a colon is legal in a path segment anyway.
 */
export function encodePathForUrl(path: string): string {
  const forward = path.replace(/\\/g, '/')
  const drive = /^([a-zA-Z]:)(\/.*)?$/.exec(forward)
  if (drive) return `${drive[1]}${encodeSegments(drive[2] ?? '')}`

  return encodeSegments(forward)
}

function encodeSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * The URL that opens this directory in that editor.
 *
 * The prefix followed by the encoded path, whose own leading slash is the one
 * that makes `file:///Users/me/x` and `vscode://file/Users/me/x`. A Windows
 * path starts at its drive rather than at a slash, so one is added —
 * `vscode://file/C:/x` is the form the handler expects.
 *
 * Throws rather than returning something unusable. The caller is an endpoint,
 * and a bad path should reach the person as a sentence, not as a link that
 * quietly opens their home directory.
 */
export function editorUrl(editor: EditorChoice, path: string): string {
  const trimmed = path.trim()
  if (!trimmed) throw new Error('No path to open.')
  if (!isAbsolutePath(trimmed)) {
    throw new Error(`Needs the full path to the workspace, not “${trimmed}”.`)
  }

  const encoded = encodePathForUrl(trimmed)
  const rooted = encoded.startsWith('/') ? encoded : `/${encoded}`

  return `${PREFIXES[editor]}${rooted}`
}

/** Hands a URL to the desktop. Replaced in tests; nothing else replaces it. */
export type Launcher = (command: string, args: string[]) => void

/**
 * Which program opens a URL here. The same three cases as the CLI's `openUrl`,
 * including Windows needing `start` to be given an empty title first — without
 * it the URL is read as the window title and nothing opens.
 */
export function launchCommand(url: string): { command: string; args: string[] } {
  if (process.platform === 'darwin') return { command: 'open', args: [url] }
  if (process.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] }
  return { command: 'xdg-open', args: [url] }
}

/**
 * Detached and unreferenced, because waiting for `open` to exit is waiting for
 * an editor window to close. Nothing is read back: the handler either has the
 * scheme or it does not, and it says so on its own screen rather than ours.
 */
function launchDetached(command: string, args: string[]): void {
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

/**
 * Open a worktree, and say where it went.
 *
 * The existence check is a `stat` for a directory rather than a plain one: a
 * path that is now a file is not a worktree, and passing it on would open a
 * text buffer where somebody expected a project.
 */
export async function openInEditor(
  editor: EditorChoice,
  path: string,
  launch: Launcher = launchDetached,
): Promise<{ url: string; name: string }> {
  const url = editorUrl(editor, path)

  try {
    const found = await stat(path)
    if (!found.isDirectory()) throw new Error('not a directory')
  } catch {
    throw new Error(`There is no workspace at ${path} any more. It was removed outside the app.`)
  }

  const { command, args } = launchCommand(url)
  launch(command, args)

  return { url, name: editorName(editor) }
}
