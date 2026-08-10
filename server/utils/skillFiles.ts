import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { MAX_EDITABLE_BYTES, looksBinary, resolveInWorkspace } from './workspaceFiles'
import type { SkillFile } from '~/types'

/**
 * The files a skill is made of, beyond its instructions.
 *
 * A skill is a directory — `skills/<name>/SKILL.md` — and the format's whole
 * idea is that SKILL.md stays short and defers to what sits beside it:
 * `references/` for detail read on demand, `scripts/` for things run rather
 * than read, `assets/` for templates. The app already resolved the directory to
 * find SKILL.md (see `findSkill`) and then only ever read that one file, so
 * every skill built the way the format intends showed up here with its second
 * half invisible and unauthorable.
 *
 * **The scoping is borrowed, deliberately.** `resolveInWorkspace` already
 * refuses paths that climb out, absolute paths, and symlinks that lead
 * somewhere else — including the case where the file does not exist yet, which
 * is exactly when a write is about to create it. That logic took a real bug to
 * get right; a second copy of it here would be a second chance to get it wrong.
 */

/** The instructions file. Never editable through the supporting-file API. */
export const SKILL_FILE = 'SKILL.md'

/** Named in refusals from the path guard. */
const ROOT_LABEL = 'skill directory'

/**
 * Not listed. A skill directory should hold what the author wrote; anything
 * below is either generated or a checkout artefact from a GitHub import.
 */
const SKIP_NAMES = new Set(['node_modules', '.git', '.DS_Store', '__pycache__'])

/**
 * A skill is shallow by nature. These caps exist so a directory that turns out
 * not to be one — someone's home folder symlinked in, a vendored tree — cannot
 * turn a page load into a filesystem walk.
 */
const MAX_DEPTH = 6
const MAX_ENTRIES = 500

/**
 * Extensions we will not offer to open. Reading one as UTF-8 and saving it back
 * would corrupt it, and `looksBinary` only catches that after the read.
 */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tiff',
  '.pdf', '.zip', '.gz', '.tar', '.tgz', '.bz2', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.mov', '.avi',
  '.so', '.dylib', '.dll', '.exe', '.bin', '.wasm', '.pyc', '.class',
])

/**
 * Everything in the skill directory except SKILL.md, depth-first.
 *
 * Recursive, unlike the workspace listing next door: a worktree walked in one
 * go is mostly `node_modules`, whereas a skill's supporting files are a handful
 * and the whole point is seeing that `references/api.md` exists without having
 * to go looking for it.
 *
 * Directories are listed alongside their contents so an empty `scripts/` is
 * still visible — an empty directory the author made on purpose is a fact about
 * the skill, and silently hiding it makes the tree lie.
 */
export async function listSkillFiles(skillDir: string): Promise<SkillFile[]> {
  const out: SkillFile[] = []
  await walk(skillDir, skillDir, 0, out)

  return out.sort((a, b) => a.path.localeCompare(b.path))
}

async function walk(root: string, dir: string, depth: number, out: SkillFile[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // An unreadable subdirectory is not a reason to fail the whole page.
    return
  }

  for (const entry of entries) {
    if (out.length >= MAX_ENTRIES) return
    if (SKIP_NAMES.has(entry.name)) continue

    const full = join(dir, entry.name)
    const path = relative(root, full)

    // Only at the top level: a `SKILL.md` inside `references/` is an ordinary
    // supporting file and hiding it would be wrong.
    if (path === SKILL_FILE) continue

    // Not followed. A symlink out of the skill directory listed as if it were
    // inside is how a scoped file tree stops being scoped.
    if (entry.isSymbolicLink()) continue

    if (entry.isDirectory()) {
      out.push({ name: entry.name, path, kind: 'directory' })
      await walk(root, full, depth + 1, out)
      continue
    }

    if (!entry.isFile()) continue

    const size = await stat(full).then(s => s.size).catch(() => undefined)
    out.push({
      name: entry.name,
      path,
      kind: 'file',
      size,
      binary: isBinaryPath(entry.name) || (size !== undefined && size > MAX_EDITABLE_BYTES),
    })
  }
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(extname(path).toLowerCase())
}

export interface SkillFileContents {
  path: string
  content: string
  size: number
}

/** One supporting file's text. */
export async function readSkillFile(skillDir: string, relPath: string): Promise<SkillFileContents> {
  refuseSkillMd(relPath, 'read')

  const full = await resolveInWorkspace(skillDir, relPath, ROOT_LABEL)
  const info = await stat(full).catch(() => null)

  if (!info) throw httpError(404, `${relPath} is not there.`)
  if (info.isDirectory()) throw httpError(400, `${relPath} is a directory, not a file.`)
  if (info.size > MAX_EDITABLE_BYTES) {
    throw httpError(413, `${relPath} is ${Math.round(info.size / 1024)}KB, which is past what this will open.`)
  }

  // By extension first, because it is the cheap check, and then on the bytes —
  // an extensionless script is still text, and a mislabelled `.md` still isn't.
  if (isBinaryPath(relPath)) throw httpError(415, `${relPath} is not a text file.`)

  const buffer = await readFile(full)
  if (looksBinary(buffer)) throw httpError(415, `${relPath} is not a text file.`)

  return { path: relPath, content: buffer.toString('utf-8'), size: info.size }
}

/**
 * Write a supporting file, creating the directories it needs.
 *
 * A skill's layout is `references/`, `scripts/`, `assets/` — so adding the
 * first reference means creating that directory too, and making somebody do it
 * as a separate step would be a worse version of `mkdir -p`.
 */
export async function writeSkillFile(
  skillDir: string,
  relPath: string,
  /**
   * A Buffer when the file is not text. Importing a skill folder brings its
   * `assets/` along, and writing a PNG through a UTF-8 encode corrupts it.
   */
  content: string | Buffer,
): Promise<void> {
  refuseSkillMd(relPath, 'write')

  const full = await resolveInWorkspace(skillDir, relPath, ROOT_LABEL)

  const bytes = typeof content === 'string' ? Buffer.byteLength(content, 'utf-8') : content.length
  if (bytes > MAX_EDITABLE_BYTES) {
    throw httpError(413, `${relPath} is larger than this will save.`)
  }

  const existing = await stat(full).catch(() => null)
  if (existing?.isDirectory()) {
    throw httpError(400, `${relPath} is a directory, not a file.`)
  }

  await mkdir(join(full, '..'), { recursive: true })

  if (typeof content === 'string') await writeFile(full, content, 'utf-8')
  else await writeFile(full, content)
}

/** Remove a supporting file, or a directory and everything under it. */
export async function deleteSkillFile(skillDir: string, relPath: string): Promise<void> {
  refuseSkillMd(relPath, 'delete')

  const full = await resolveInWorkspace(skillDir, relPath, ROOT_LABEL)

  // Refusing the directory itself matters: `rm -r` on the resolved root would
  // delete the skill through an endpoint that only claims to delete a file.
  if (full === await realRoot(skillDir)) {
    throw httpError(400, 'That is the skill itself — delete the skill instead.')
  }

  const info = await stat(full).catch(() => null)
  if (!info) throw httpError(404, `${relPath} is not there.`)

  await rm(full, { recursive: true, force: true })
}

async function realRoot(skillDir: string): Promise<string> {
  return resolveInWorkspace(skillDir, '', ROOT_LABEL)
}

export interface ImportPath {
  path: string
}

/**
 * Folder paths, as a browser gives them, turned into paths inside the skill.
 *
 * A directory picker reports `webkitRelativePath`, which always begins with the
 * folder the person chose — `my-skill/SKILL.md`, `my-skill/references/api.md`.
 * That leading segment names the thing being imported rather than being part of
 * it, so it comes off.
 *
 * It only comes off when *every* file shares it. A selection of loose files has
 * no common root to remove, and taking the first segment off those would turn
 * `SKILL.md` into nothing at all.
 */
export function normalizeImportPaths<T extends ImportPath>(files: T[] | undefined): T[] {
  if (!files?.length) return []

  const cleaned = files
    .map(f => ({ ...f, path: f.path.replace(/\\/g, '/').replace(/^\/+/, '') }))
    .filter(f => f.path && !f.path.split('/').some(segment => SKIP_NAMES.has(segment)))

  if (!cleaned.length) return []

  const firstSegment = (path: string) => path.split('/')[0]!
  const root = firstSegment(cleaned[0]!.path)
  const shared = cleaned.every(f => f.path.includes('/') && firstSegment(f.path) === root)

  return shared
    ? cleaned.map(f => ({ ...f, path: f.path.slice(root.length + 1) }))
    : cleaned
}

/**
 * Refuse to add to, or delete from, a directory this app does not own.
 *
 * The same rule the skill delete endpoint already applies, for the same reason:
 * a plugin's files come back on its next update and a GitHub import's come back
 * on its next pull, so a write there is work that quietly disappears later.
 * Reading them is fine — that is what the editor shows.
 */
export function requireWritableSkill(found: {
  slug: string
  source: 'local' | 'plugin' | 'github'
  pluginName?: string
}): void {
  if (found.source === 'local') return

  const origin = found.source === 'plugin'
    ? `the ${found.pluginName ?? 'plugin'} plugin`
    : 'a GitHub import'

  throw httpError(400, `"${found.slug}" comes from ${origin} — edit a copy instead of changing its files.`)
}

/**
 * SKILL.md is off-limits here even though it is plainly inside the directory.
 *
 * It has its own editor, and that editor is the only thing that merges
 * frontmatter rather than replacing it. A raw write through the file API would
 * be a second way to save the instructions — one that knows nothing about
 * frontmatter and would happily strip it.
 */
function refuseSkillMd(relPath: string, verb: string): void {
  if (relPath.trim() === SKILL_FILE) {
    throw httpError(400, `Use the instructions editor to ${verb} ${SKILL_FILE}.`)
  }
}

/** h3's `createError` inside the server, a plain error in tests. */
function httpError(statusCode: number, message: string): Error {
  if (typeof createError === 'function') return createError({ statusCode, message })
  return Object.assign(new Error(message), { statusCode })
}
