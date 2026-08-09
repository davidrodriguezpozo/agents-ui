import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Reading and writing files inside a session's workspace.
 *
 * The commonest reason to leave this app is that the agent got something nearly
 * right and you want to change one line. That means finding the worktree on
 * disk and opening an editor, and the loop this product is built around — edit,
 * re-check, land — has a hole in the middle where the editing should be.
 *
 * **The scoping is the entire job.** Everything else here is `readFile` and
 * `readdir`. A path that escapes the workspace turns a page you have open into
 * arbitrary read and write anywhere the server can reach, and this server runs
 * as you with no authentication in front of it. So nothing below trusts a path
 * from a request further than it can throw it:
 *
 *   - Resolved against the workspace, never concatenated onto it.
 *   - Compared after `realpath`, so a symlink inside the workspace pointing out
 *     of it is caught. Checking the composed path would miss that entirely,
 *     which is the trick that makes a "sandboxed" file browser not one.
 *   - A prefix match on the *string* is not enough: `/work/session-2` starts
 *     with `/work/session`. Compared segment-wise instead.
 */

/** Beyond this it is not a file somebody is about to edit by hand. */
export const MAX_EDITABLE_BYTES = 2 * 1024 * 1024

/**
 * Never listed. Large, generated, or nobody's idea of a source file.
 *
 * Matched on name whatever the entry is, not only on directories: inside a
 * worktree `.git` is a *file* holding a `gitdir:` pointer rather than a
 * directory, so a directories-only skip shows it in every session.
 */
const SKIP_NAMES = new Set([
  'node_modules', '.git', '.nuxt', '.output', 'dist', 'build', 'target',
  '.venv', 'venv', '__pycache__', '.next', '.svelte-kit', 'vendor', '.worktrees',
])

/**
 * Whether `candidate` is the workspace itself or genuinely inside it.
 *
 * Both arguments must already be real paths. Segment-wise rather than a string
 * prefix, so a sibling directory whose name merely starts the same way is not
 * mistaken for a child.
 */
export function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true

  const rel = relative(root, candidate)
  if (!rel || isAbsolute(rel)) return false

  // `..` can only appear as the first segment of a relative path, and its
  // presence means the candidate climbed out.
  return !rel.split(sep).includes('..')
}

/**
 * Turn a path from a request into a real path inside the workspace, or refuse.
 *
 * `relPath` is relative to the workspace. Absolute paths, `..`, and symlinks
 * that lead out are all refused rather than normalised into something
 * plausible — a request that asked for the wrong thing should hear so.
 */
export async function resolveInWorkspace(workspace: string, relPath: string): Promise<string> {
  const root = await realpath(workspace).catch(() => resolve(workspace))
  const target = resolve(root, relPath)

  // Checked before touching the disk, so an obvious escape never becomes a
  // filesystem call at all.
  if (!isInside(root, target)) throw outsideWorkspace()

  /**
   * Then again with the symlinks resolved — and this walks *up* rather than
   * checking the target alone.
   *
   * An earlier version only re-checked a path that already existed, on the
   * reasoning that one which does not is simply a new file. That is exactly
   * backwards: `realpath` fails for a file that is not there yet, so the check
   * was skipped precisely when a write was about to create something. With a
   * symlinked directory in the workspace — `link -> /Users/you`, checked in or
   * made by the agent — `link/.ssh/authorized_keys` passed the string test,
   * failed `realpath` because it did not exist, and was returned unresolved for
   * `writeFile` to follow. That is arbitrary file creation anywhere this
   * process can write, which is the one thing this file exists to prevent.
   *
   * So the nearest ancestor that *does* exist is resolved and checked, and the
   * rest of the path is rebuilt onto it. Existing and not-yet-existing paths go
   * down the same road, which is the only way the second cannot be forgotten.
   */
  const trailing: string[] = []
  let cursor = target

  for (;;) {
    const real = await realpath(cursor).catch(() => null)

    if (real) {
      if (!isInside(root, real)) throw outsideWorkspace()
      return trailing.length ? join(real, ...trailing.reverse()) : real
    }

    const parent = dirname(cursor)
    // Walked to the filesystem root without finding anything real: there is no
    // ancestor to vouch for this path, so it is refused rather than guessed at.
    if (parent === cursor) throw outsideWorkspace()

    trailing.push(basename(cursor))
    cursor = parent
  }
}

export interface WorkspaceEntry {
  name: string
  /** Relative to the workspace, which is the only form a request may use. */
  path: string
  kind: 'file' | 'directory'
  size?: number
}

/**
 * One directory's contents, directories first and then alphabetical.
 *
 * Not recursive. A worktree of any size walked in one go is a large response
 * that is mostly `node_modules`, and the tree people actually open is one level
 * at a time.
 */
export async function listDirectory(workspace: string, relPath = ''): Promise<WorkspaceEntry[]> {
  const dir = await resolveInWorkspace(workspace, relPath)
  const root = await realpath(workspace).catch(() => resolve(workspace))

  const entries = await readdir(dir, { withFileTypes: true })
  const out: WorkspaceEntry[] = []

  for (const entry of entries) {
    // A dotfile is worth showing — `.github`, `.editorconfig` — but the git
    // pointer is not, and neither is anything generated.
    if (SKIP_NAMES.has(entry.name)) continue

    const full = join(dir, entry.name)
    const kind = entry.isDirectory() ? 'directory' as const : 'file' as const

    let size: number | undefined
    if (kind === 'file') {
      size = await stat(full).then(s => s.size).catch(() => undefined)
    }

    out.push({ name: entry.name, path: relative(root, full), kind, size })
  }

  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export interface WorkspaceFile {
  path: string
  content: string
  size: number
}

/**
 * A file's text.
 *
 * Refuses anything too large to be edited by hand, and anything that is not
 * text — showing a PNG as mojibake and then offering to save it would corrupt
 * the file on the way back out.
 */
export async function readWorkspaceFile(workspace: string, relPath: string): Promise<WorkspaceFile> {
  const full = await resolveInWorkspace(workspace, relPath)
  const info = await stat(full)

  if (info.isDirectory()) throw createHttpError(400, 'That is a directory, not a file.')
  if (info.size > MAX_EDITABLE_BYTES) {
    throw createHttpError(413, `That file is ${Math.round(info.size / 1024)}KB, which is past what this will open.`)
  }

  const buffer = await readFile(full)
  if (looksBinary(buffer)) throw createHttpError(415, 'That looks like a binary file.')

  return { path: relPath, content: buffer.toString('utf-8'), size: info.size }
}

export async function writeWorkspaceFile(
  workspace: string,
  relPath: string,
  content: string,
): Promise<void> {
  const full = await resolveInWorkspace(workspace, relPath)

  // Refuse to write over a directory, and refuse a body big enough that
  // something has gone wrong rather than somebody having typed it.
  const info = await stat(full).catch(() => null)
  if (info?.isDirectory()) throw createHttpError(400, 'That is a directory, not a file.')
  if (Buffer.byteLength(content, 'utf-8') > MAX_EDITABLE_BYTES) {
    throw createHttpError(413, 'That is larger than this will save.')
  }

  await writeFile(full, content, 'utf-8')
}

/**
 * A NUL byte in the first few KB. Crude, and the same heuristic git uses —
 * good enough to keep an image out of a text editor.
 */
export function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0)
}

/**
 * Asking for a path outside the workspace is a bad request, not a server
 * fault. A plain `Error` here surfaces as a 500 "Server Error", which reads
 * like the app broke rather than like the path was refused — and buries the
 * one sentence that explains it.
 */
function outsideWorkspace(): Error {
  return createHttpError(403, 'That path is outside the session workspace.')
}

/** h3's `createError` inside the server, a plain error in tests. */
function createHttpError(statusCode: number, message: string): Error {
  if (typeof createError === 'function') return createError({ statusCode, message })
  return Object.assign(new Error(message), { statusCode })
}
