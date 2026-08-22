import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { inFlight, mapLimit } from './pool'

/**
 * Which names a session's diff defines, drops, and depends on.
 *
 * `findOverlaps` already says two sessions are changing the same file, which is
 * the cheap half of the question and the less interesting one. The half that
 * actually costs an afternoon is the one git cannot see at all: session A
 * renames `worktreeStatus`, session B adds four call sites to it, both merge
 * without a textual conflict, and `main` stops compiling. Nothing in the file
 * list catches that, because the two sessions never touched the same file.
 *
 * So: the names. Per file, per session, taken from the diff rather than from
 * the code around it — a name is in this map because *this session's changed
 * lines* mention it, not because it happens to exist in the repository.
 *
 * ## Shallow on purpose
 *
 * This is regexes over the changed lines of a unified diff. There is no parser
 * and there will not be one — a parser dependency for a badge on a list is the
 * wrong trade, and `package.json` has no runtime dependencies by design. The
 * cost of that choice is a list of things it gets wrong, and the list is here
 * rather than implied:
 *
 *   - **Only TypeScript and Vue.** `.ts`, `.tsx`, `.mts`, `.cts`, `.vue`.
 *     Everything else in the diff is named in `skipped` and read no further. A
 *     language this does not understand returns nothing rather than a guess,
 *     because a guessed symbol produces a collision warning nobody can act on.
 *   - **Destructured exports are missed.** `export const { a, b } = thing`
 *     records nothing; `export const a = …` records `a`.
 *   - **Arrow consts that are not exported are missed.** `const helper = () =>`
 *     is a name, but including every local arrow buried the exported API in
 *     noise. `export const helper = () =>` is recorded.
 *   - **Type positions are missed.** `function f(x: Session)` does not record
 *     `Session` unless the import of `Session` is also in the diff. `extends`
 *     and `implements` are recorded, since those are the ones that break.
 *   - **A multi-line `import { … }` is read a member at a time.** With zero
 *     context lines only the changed member is in the diff, so a line that is
 *     nothing but an identifier is treated as a use. That is right for an
 *     import member and harmlessly right for the object shorthand and lone call
 *     arguments it also catches.
 *   - **A name mentioned in a block comment that opens mid-line slips through.**
 *     Lines whose first non-space is `//`, `/*` or `*` are skipped; a comment
 *     trailing real code is not.
 *   - **Uses come from added lines only.** A deleted call site is not a use —
 *     after this diff, the session does not call that name. What the diff
 *     *removed* is in `removed`, and only when the diff does not put it back.
 *
 * ## What it costs
 *
 * Three `git` invocations on a miss, one on a hit. A `git` invocation costs
 * about 35ms whatever the repository, because it is process startup — so the
 * fifty-file budget is spent almost entirely before any parsing happens. The
 * parse itself is single-digit milliseconds on a fifty-file diff, and
 * `--unified=0` keeps the patch to the lines that changed rather than the files
 * that contain them.
 *
 * The cache is keyed on the base ref, the head commit, and the porcelain status
 * — a session's diff only changes when the session does. Porcelain has one
 * blind spot, which is a second edit to a file that was already modified: the
 * status line is identical, so the key does not move. A dirty worktree
 * therefore only holds its answer for `DIRTY_MS`; a clean one holds it until
 * the commit changes, because nothing else can change it.
 */

const exec = promisify(execFile)

async function git(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, timeout, maxBuffer: 20 * 1024 * 1024 })
  return stdout
}

export type SymbolLanguage = 'ts' | 'vue'

export interface FileSymbols {
  path: string
  language: SymbolLanguage
  /**
   * Names this diff introduces or changes — exports, function and class
   * declarations, and a Vue file's own component name when the file arrived or
   * was renamed. A name whose defining line was merely reformatted is here too,
   * which is what "or changes" means: the diff touched the line that owns it.
   */
  defined: string[]
  /**
   * Names this diff takes away: declared on a line it removed and not put back
   * anywhere else in the same file. A rename shows the old name here and the
   * new one in `defined`.
   */
  removed: string[]
  /**
   * Names this diff depends on — imported bindings, re-export sources, bare
   * call sites, `extends`/`implements`, and components used in a Vue template.
   */
  used: string[]
}

export interface SymbolMap {
  files: FileSymbols[]
  /** Files in the diff this pass does not read, named rather than counted. */
  skipped: string[]
}

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

function languageOf(path: string): SymbolLanguage | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.vue') return 'vue'
  return TS_EXTENSIONS.has(ext) ? 'ts' : null
}

/** `work-rail-row.vue` and `WorkRailRow.vue` are the same component. */
function componentName(path: string): string {
  return basename(path)
    .replace(/\.vue$/i, '')
    .split(/[-_.]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/* -------------------------------------------------------------------------
 * Reading the patch
 * ---------------------------------------------------------------------- */

interface PatchFile {
  /** Where the file is now; for a delete, where it was. */
  path: string
  /** The other side's name, set for a rename and for an ordinary edit alike. */
  from: string | null
  created: boolean
  deleted: boolean
  added: string[]
  removed: string[]
}

/**
 * Split a unified diff into per-file added and removed lines.
 *
 * The `in hunk` flag is not decoration. A removed line whose own content starts
 * with `--` arrives as `--- …`, indistinguishable from a file header by shape
 * alone — reading headers only before the first `@@` is what tells them apart.
 * A pure rename has no `---`/`+++` pair at all, only `rename from`/`rename to`,
 * which is the case a Vue component rename lands in.
 */
function splitPatch(patch: string): PatchFile[] {
  const files: PatchFile[] = []
  let inHunk = false

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      files.push({ path: '', from: null, created: false, deleted: false, added: [], removed: [] })
      inHunk = false
      continue
    }

    const current = files[files.length - 1]
    if (!current) continue

    if (!inHunk) {
      if (line.startsWith('@@')) {
        inHunk = true
        continue
      }
      if (line.startsWith('rename from ')) {
        current.from = line.slice('rename from '.length).trim()
        continue
      }
      if (line.startsWith('rename to ')) {
        current.path = line.slice('rename to '.length).trim()
        continue
      }
      if (line.startsWith('--- ')) {
        const named = line.slice(4).trim()
        if (named === '/dev/null') current.created = true
        else current.from = named.replace(/^a\//, '')
        continue
      }
      if (line.startsWith('+++ ')) {
        const named = line.slice(4).trim()
        if (named === '/dev/null') {
          current.deleted = true
          current.path = current.from ?? ''
        }
        else {
          current.path = named.replace(/^b\//, '')
        }
      }
      continue
    }

    if (line.startsWith('@@')) continue
    if (line.startsWith('+')) current.added.push(line.slice(1))
    else if (line.startsWith('-')) current.removed.push(line.slice(1))
  }

  return files.filter(file => file.path)
}

/* -------------------------------------------------------------------------
 * Reading a line
 * ---------------------------------------------------------------------- */

/**
 * Words that look like a call and are not one.
 *
 * `if (`, `for (`, `catch (` and friends would otherwise be the most-used
 * "names" in every repository. `continue`, `true`, `null` and the rest are here
 * for the bare-identifier rule below rather than for calls.
 */
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof',
  'await', 'function', 'new', 'delete', 'void', 'yield', 'in', 'of', 'do',
  'else', 'case', 'throw', 'super', 'this', 'import', 'export', 'from',
  'as', 'const', 'let', 'var', 'class', 'extends', 'implements', 'satisfies',
  'keyof', 'infer', 'asserts', 'is', 'type', 'interface', 'enum', 'namespace',
  'declare', 'default', 'async', 'true', 'false', 'null', 'undefined',
  'continue', 'break', 'try', 'finally',
])

/** Vue's own tags, which are not somebody's component. */
const BUILT_IN_TAGS = new Set([
  'Transition', 'TransitionGroup', 'KeepAlive', 'Teleport', 'Suspense',
  'Component', 'Slot', 'Template',
])

const DECLARED: RegExp[] = [
  /(?<![.\w$])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
  /(?<![.\w$])(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  // `enum` is excluded here so `export const enum Foo` is not read as a const
  // called `enum`; the pattern below takes it.
  /(?<![.\w$])export\s+(?:declare\s+)?(?:const|let|var)\s+(?!enum\b)([A-Za-z_$][\w$]*)/g,
  /(?<![.\w$])export\s+(?:declare\s+)?(?:const\s+)?(?:interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g,
]

const EXPORT_LIST = /(?<![.\w$])export\s+(?:type\s+)?\{([^}]*)\}/g
const EXPORT_NAMESPACE = /(?<![.\w$])export\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g

const IMPORT_NAMESPACE = /(?<![.\w$])import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g
const IMPORT_LIST = /(?<![.\w$])import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}/g
const IMPORT_DEFAULT = /(?<![.\w$])import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,|from\b)/g

const INHERITS = /(?<![.\w$])(?:extends|implements)\s+([A-Za-z_$][\w$]*)/g
// The backslash in the lookbehind is for a file like this one: `\bdefine(` in a
// regex literal is call-shaped, and without it the map claims a use of
// `bdefine`. Cheaper than knowing where the string and regex literals are.
const CALL = /(?<![.\w$'"`\\])([A-Za-z_$][\w$]*)\s*\(/g
const TAG = /<([A-Za-z][\w.-]*)/g

/**
 * A line that is one identifier. With `--unified=0` a multi-line import shows
 * up as exactly this, and so does an object shorthand and a lone argument —
 * all three are the name being used.
 */
const BARE = /^(?:type\s+)?([A-Za-z_$][\w$]*)\s*,?$/

/** `defineOptions({ name: 'Foo' })` on one line. Split over several, missed. */
const COMPONENT_OPTION
  = /\bdefine(?:Options|Component)\s*\(\s*\{[^}]*?\bname\s*:\s*['"]([A-Za-z_$][\w$]*)['"]/

/** A member of an `import { … }` or `export { … }` list, both sides of `as`. */
function listMembers(body: string): { source: string; exposed: string }[] {
  const named = /^[A-Za-z_$][\w$]*$/
  return body
    .split(',')
    .map(part => part.trim().replace(/^type\s+/, ''))
    .filter(Boolean)
    .map((part) => {
      const [source = '', exposed = ''] = part.split(/\s+as\s+/).map(s => s.trim())
      return { source, exposed: exposed || source }
    })
    .filter(member => named.test(member.source) && named.test(member.exposed))
}

function tagComponent(tag: string): string | null {
  const first = tag.split('.')[0] ?? ''
  if (!first) return null
  if (/^[A-Z]/.test(first)) return BUILT_IN_TAGS.has(first) ? null : first
  if (!first.includes('-')) return null
  const pascal = first.split('-').filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
  return BUILT_IN_TAGS.has(pascal) ? null : pascal
}

interface Scanned {
  defined: string[]
  used: string[]
}

function scanLines(lines: readonly string[], language: SymbolLanguage): Scanned {
  const defined: string[] = []
  const used: string[] = []

  for (const raw of lines) {
    const line = raw.trimEnd()
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue

    /** Declared on this line, so a call-shaped match of the same name is not a use. */
    const here: string[] = []
    /** Named outright as a dependency — kept even when this line also declares it. */
    const explicit: string[] = []
    /** Inferred from shape. Dropped when the line declares the same name. */
    const incidental: string[] = []

    for (const pattern of DECLARED) {
      for (const match of line.matchAll(pattern)) if (match[1]) here.push(match[1])
    }

    for (const match of line.matchAll(EXPORT_LIST)) {
      for (const member of listMembers(match[1] ?? '')) {
        here.push(member.exposed)
        // `export { default as Foo }` re-exports something with no name of its
        // own on the other side; there is nothing to depend on by name.
        if (member.source !== 'default') explicit.push(member.source)
      }
    }

    for (const match of line.matchAll(EXPORT_NAMESPACE)) if (match[1]) here.push(match[1])

    for (const match of line.matchAll(IMPORT_LIST)) {
      for (const member of listMembers(match[1] ?? '')) {
        explicit.push(member.source)
        if (member.exposed !== member.source) explicit.push(member.exposed)
      }
    }

    for (const pattern of [IMPORT_NAMESPACE, IMPORT_DEFAULT, INHERITS]) {
      for (const match of line.matchAll(pattern)) {
        if (match[1] && !KEYWORDS.has(match[1])) explicit.push(match[1])
      }
    }

    if (language === 'vue') {
      const option = line.match(COMPONENT_OPTION)
      if (option?.[1]) here.push(option[1])

      for (const match of line.matchAll(TAG)) {
        const component = tagComponent(match[1] ?? '')
        if (component) explicit.push(component)
      }
    }

    for (const match of line.matchAll(CALL)) {
      if (match[1] && !KEYWORDS.has(match[1])) incidental.push(match[1])
    }

    const bare = trimmed.match(BARE)
    if (bare?.[1] && !KEYWORDS.has(bare[1])) incidental.push(bare[1])

    defined.push(...here)
    used.push(...explicit, ...incidental.filter(name => !here.includes(name)))
  }

  return { defined, used }
}

function symbolsForFile(file: PatchFile, language: SymbolLanguage): FileSymbols {
  const head = scanLines(file.added, language)
  const base = scanLines(file.removed, language)

  const defined = new Set(head.defined)
  const removed = new Set<string>()
  const used = new Set(head.used)

  // A name on both sides is a touched line, not a removal. This is what makes a
  // rename read as one thing gone and one thing arrived rather than as churn.
  for (const name of base.defined) if (!defined.has(name)) removed.add(name)

  if (language === 'vue') {
    const renamedFrom = file.from && file.from !== file.path ? file.from : null
    if (file.created || renamedFrom) defined.add(componentName(file.path))
    if (file.deleted) removed.add(componentName(file.path))
    else if (renamedFrom) removed.add(componentName(renamedFrom))
  }

  return {
    path: file.path,
    language,
    defined: [...defined].sort(),
    removed: [...removed].filter(name => !defined.has(name)).sort(),
    used: [...used].sort(),
  }
}

/** The names in a unified diff, with no git and no filesystem behind it. */
export function symbolsFromPatch(patch: string): SymbolMap {
  const files: FileSymbols[] = []
  const skipped: string[] = []

  for (const file of splitPatch(patch)) {
    const language = languageOf(file.path)
    if (!language) {
      skipped.push(file.path)
      continue
    }
    files.push(symbolsForFile(file, language))
  }

  return { files, skipped }
}

/* -------------------------------------------------------------------------
 * Reading a worktree
 * ---------------------------------------------------------------------- */

/**
 * How many untracked files are read, and how big one may be.
 *
 * A new file is the most common thing an agent produces and it is not in any
 * diff, so it has to be read off disk. The caps exist because "untracked" can
 * also mean a build directory somebody forgot to ignore; anything past them is
 * listed in `skipped` rather than dropped quietly.
 */
const UNTRACKED_LIMIT = 200
const UNTRACKED_BYTES = 512 * 1024

/** A dirty worktree's answer, since porcelain cannot see a second edit. */
const DIRTY_MS = 3_000

async function untrackedSymbols(worktreePath: string, paths: string[]): Promise<SymbolMap> {
  const considered = paths.slice(0, UNTRACKED_LIMIT)
  const skipped = [
    ...considered.filter(path => !languageOf(path)),
    ...paths.slice(UNTRACKED_LIMIT),
  ]

  const readable = considered.filter(path => languageOf(path))
  const files = await mapLimit(readable, 16, async (path): Promise<FileSymbols | null> => {
    const source = await readFile(join(worktreePath, path), 'utf-8').catch(() => null)
    if (source === null || source.length > UNTRACKED_BYTES) return null

    return symbolsForFile({
      path,
      from: null,
      created: true,
      deleted: false,
      added: source.split('\n'),
      removed: [],
    }, languageOf(path)!)
  })

  for (const [index, file] of files.entries()) {
    if (!file) skipped.push(readable[index]!)
  }

  return { files: files.filter((file): file is FileSymbols => file !== null), skipped }
}

interface Cached {
  map: SymbolMap
  version: string
  at: number
  dirty: boolean
}

const cache = new Map<string, Cached>()

/** A page mounting while a poll is in the air should not read the diff twice. */
const reading = inFlight<string, SymbolMap>()

function empty(): SymbolMap {
  return { files: [], skipped: [] }
}

/**
 * The names one session's work defines, drops, and depends on.
 *
 * `baseRef` is what the session is measured from — `diffBase` works it out, and
 * it is often a branch name. The merge base of that ref and `HEAD` is resolved
 * first for the same reason `reviewAnchors` uses a three-dot range: a two-dot
 * diff against a branch that has moved on would attribute everything that
 * landed there to this session, and the radar would light up over other
 * people's commits.
 *
 * Committed and uncommitted work both count. An agent mid-turn has renamed the
 * function already and not committed it, and that is exactly the moment knowing
 * is worth something.
 */
export async function symbolMap(worktreePath: string, baseRef: string): Promise<SymbolMap> {
  if (!worktreePath || !baseRef || !existsSync(worktreePath)) return empty()

  // `-uall` rather than the default: an untracked *directory* is reported as one
  // line ending in a slash, and a new component in a new folder would be read as
  // a file that is not there.
  const status = await git(worktreePath, ['status', '--porcelain=v2', '--branch', '-uall'])
    .catch(() => null)
  if (status === null) return empty()

  const lines = status.split('\n').filter(Boolean)
  const oid = lines.find(line => line.startsWith('# branch.oid '))?.slice(13).trim() ?? ''
  const entries = lines.filter(line => !line.startsWith('# '))
  const untracked = entries
    .filter(line => line.startsWith('? '))
    .map(line => line.slice(2).trim())
    .filter(path => path && !path.endsWith('/'))

  const version = `${baseRef}\n${oid}\n${entries.join('\n')}`
  const dirty = entries.length > 0

  const hit = cache.get(worktreePath)
  if (hit && hit.version === version && (!dirty || Date.now() - hit.at < DIRTY_MS)) return hit.map

  const map = await reading(`${worktreePath}\n${version}`, async () => {
    const base = (await git(worktreePath, ['merge-base', baseRef, 'HEAD']).catch(() => '')).trim()
      || baseRef

    const patch = await git(
      worktreePath,
      ['diff', '--no-color', '--find-renames', '--unified=0', base],
      60_000,
    ).catch(() => '')

    const committed = symbolsFromPatch(patch)
    const fresh = await untrackedSymbols(worktreePath, untracked)

    return {
      files: [...committed.files, ...fresh.files],
      skipped: [...committed.skipped, ...fresh.skipped],
    }
  })

  cache.set(worktreePath, { map, version, at: Date.now(), dirty })
  return map
}

/** Forget what a worktree last said, so the next read is real. For tests. */
export function forgetSymbolMaps(): void {
  cache.clear()
}
