import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import type { Recurrence } from './schedules'

/**
 * The half of a project's configuration that belongs to the project.
 *
 * Rituals, the check command and the sandbox rules are all already files, and
 * all three are deliberately kept on this machine — `projectRules.ts`,
 * `checks.ts` and `sandbox.ts` each say so in the same words: the project's own
 * `.claude/settings.json` is tracked, so writing your convenience there turns
 * it into everybody's policy by way of a commit nobody asked for.
 *
 * That reasoning is right about *implicit* writes and says nothing about
 * deliberate ones. A team that wants one answer to "how do you tell whether it
 * works here" has nowhere to put it: every machine is asked separately, gets it
 * slightly wrong differently, and a new colleague starts from nothing. What is
 * missing is not a server. It is the distinction between mine and ours.
 *
 * So this file, and only this file, is the shared half:
 *
 *   `<repo>/.claude/agents-studio.json`
 *
 * It is tracked, reviewed and pulled like any other file in the repository —
 * which is the whole transport. Nothing here writes it as a side effect of
 * anything: it is written when somebody explicitly shares a definition, it
 * lands in their diff, and it arrives on a colleague's machine the way every
 * other decision about the project does.
 *
 * Four decisions worth stating, because each one is the difference between this
 * being useful and being a trap:
 *
 *   - **Precedence is one rule: machine over repository over default.** See
 *     `scoped`. A shared value is a *default*, never an imposition — otherwise
 *     pulling `main` could change what your machine is allowed to reach, which
 *     is exactly the failure the three files above were avoiding. Removing your
 *     override is how you go back to the team's answer.
 *   - **A shared thing is identified by a key, not by an id.** Machine ids are
 *     minted locally and mean nothing on anybody else's disk. A shared ritual
 *     carries a slug that is stable across checkouts, which is what lets one
 *     machine's override name the thing it overrides.
 *   - **An invalid entry is reported, not dropped.** A colleague's typo must not
 *     become a ritual that silently does not exist here; it becomes a problem
 *     with a path into the file and a sentence about what is wrong. Same for a
 *     shared ritual that names a path only their machine has.
 *   - **Unknown fields survive a write.** Somebody on a newer version will have
 *     written keys this code has never heard of, and dropping them on the next
 *     write would make an upgrade look like data loss in their diff.
 */

/** Where the shared half lives, relative to the repository root. */
export const SHARED_FILE = join('.claude', 'agents-studio.json')

/** What this code understands. A file that says more than this keeps saying it. */
export const SHARED_VERSION = 1

/**
 * A ritual the repository owns.
 *
 * Deliberately a subset of `Schedule`. Everything to do with *this* machine's
 * relationship to a ritual — when it last ran, whether it is paused, the ids of
 * its runs — stays on this machine, keyed by the ritual's `key`. Sharing a
 * ritual shares the intent, never the history.
 */
export interface SharedRitual {
  /** Stable across checkouts, and how an override names what it overrides. */
  key: string
  title: string
  input: string
  invocation?: string
  agentSlug?: string
  recurrence: Recurrence
  /**
   * Paths this ritual needs, relative to the repository.
   *
   * A ritual written on one machine regularly names something only that machine
   * has. Listed here, the absence becomes a sentence on the row instead of a
   * failure at 08:00 with nobody watching — see `ritualProblems`.
   */
  requires?: string[]
}

export interface SharedChecks {
  /** Empty string is meaningful: this project has no checks. */
  command: string
}

export interface SharedSandbox {
  enabled?: boolean
  allowedDomains?: string[]
}

export interface SharedProject {
  checks?: SharedChecks
  sandbox?: SharedSandbox
  rituals?: SharedRitual[]
}

/** Something in the file that cannot be used, and where it is. */
export interface SharedProblem {
  /** A path into the file, as a person would point at it: `rituals[2].title`. */
  at: string
  /** What is wrong and what would fix it. */
  message: string
}

export interface SharedRead {
  /** Absolute, so a message can name the file somebody has to edit. */
  path: string
  exists: boolean
  config: SharedProject
  problems: SharedProblem[]
  /**
   * Everything in the file this version does not understand, kept verbatim so
   * that writing does not delete a colleague's newer fields.
   */
  unknown: Record<string, unknown>
}

export function sharedProjectPath(repoDir: string): string {
  return join(repoDir, SHARED_FILE)
}

// --- Reading ----------------------------------------------------------------

/**
 * Read the shared half. Never throws.
 *
 * A missing file is the normal case and not a problem: most projects never
 * share anything. A file that cannot be parsed *is* a problem, and one that is
 * reported rather than swallowed — a team that has committed this file needs to
 * know their machine is ignoring it.
 */
export async function readSharedProject(repoDir: string | undefined): Promise<SharedRead> {
  const path = repoDir ? sharedProjectPath(repoDir) : ''
  const empty: SharedRead = { path, exists: false, config: {}, problems: [], unknown: {} }

  if (!repoDir || !path) return empty

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return empty
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return {
      ...empty,
      exists: true,
      problems: [{
        at: '',
        message: `${path} is not valid JSON (${(e as Error).message}). Nothing in it is being used.`,
      }],
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ...empty,
      exists: true,
      problems: [{ at: '', message: `${path} should contain a JSON object. Nothing in it is being used.` }],
    }
  }

  return parseShared(raw as Record<string, unknown>, path, repoDir)
}

/** Split into its own function so the parsing can be tested without a disk. */
export function parseShared(raw: Record<string, unknown>, path: string, repoDir?: string): SharedRead {
  const problems: SharedProblem[] = []
  const config: SharedProject = {}
  const { version, checks, sandbox, rituals, ...unknown } = raw

  if (version !== undefined && (typeof version !== 'number' || version > SHARED_VERSION)) {
    problems.push({
      at: 'version',
      message: `This file was written by a newer version of Agents Studio (${String(version)}). `
        + 'What it holds is still read as far as this version understands it — update to get the rest.',
    })
  }

  if (checks !== undefined) {
    const command = (checks as SharedChecks | null)?.command
    if (typeof command !== 'string') {
      problems.push({ at: 'checks.command', message: 'Should be a string — the command to run. Ignored.' })
    } else {
      config.checks = { command: command.trim() }
    }
  }

  if (sandbox !== undefined) {
    const raw = sandbox as SharedSandbox | null
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      problems.push({ at: 'sandbox', message: 'Should be an object. Ignored.' })
    } else {
      const value: SharedSandbox = {}
      if (raw.enabled !== undefined) {
        if (typeof raw.enabled !== 'boolean') {
          problems.push({ at: 'sandbox.enabled', message: 'Should be true or false. Ignored.' })
        } else {
          value.enabled = raw.enabled
        }
      }
      if (raw.allowedDomains !== undefined) {
        if (!Array.isArray(raw.allowedDomains) || raw.allowedDomains.some(d => typeof d !== 'string')) {
          problems.push({ at: 'sandbox.allowedDomains', message: 'Should be a list of hostnames. Ignored.' })
        } else {
          value.allowedDomains = [...new Set(raw.allowedDomains.map(d => d.trim()).filter(Boolean))]
        }
      }
      if (Object.keys(value).length) config.sandbox = value
    }
  }

  if (rituals !== undefined) {
    if (!Array.isArray(rituals)) {
      problems.push({ at: 'rituals', message: 'Should be a list. Ignored.' })
    } else {
      const kept: SharedRitual[] = []
      const seen = new Set<string>()

      rituals.forEach((entry, index) => {
        const at = `rituals[${index}]`
        const ritual = parseRitual(entry, at, problems)
        if (!ritual) return

        // Two rituals with one key would make an override ambiguous, which is
        // worse than one of them not being there.
        if (seen.has(ritual.key)) {
          problems.push({ at, message: `Two rituals share the key "${ritual.key}". Only the first is used.` })
          return
        }

        seen.add(ritual.key)
        kept.push(ritual)
      })

      if (kept.length) config.rituals = kept
    }
  }

  // Checked last, so a ritual with a bad key is reported as a bad key rather
  // than as a missing path.
  if (repoDir) {
    for (const ritual of config.rituals ?? []) problems.push(...ritualProblems(ritual, repoDir))
  }

  return { path, exists: true, config, problems, unknown }
}

function parseRitual(entry: unknown, at: string, problems: SharedProblem[]): SharedRitual | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    problems.push({ at, message: 'Should be an object with a key, a title, an input and a recurrence. Ignored.' })
    return null
  }

  const raw = entry as Record<string, unknown>
  const key = typeof raw.key === 'string' ? raw.key.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const input = typeof raw.input === 'string' ? raw.input.trim() : ''

  if (!key) {
    problems.push({ at: `${at}.key`, message: 'Needs a key — a short stable name, the same in every checkout. Ignored.' })
    return null
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
    problems.push({
      at: `${at}.key`,
      message: `"${key}" should be lower case letters, numbers and hyphens. Ignored.`,
    })
    return null
  }
  if (!title) {
    problems.push({ at: `${at}.title`, message: 'Needs a title, which is what a row is called. Ignored.' })
    return null
  }
  if (!input) {
    problems.push({ at: `${at}.input`, message: 'Needs an input — the instruction to run. Ignored.' })
    return null
  }

  const recurrence = parseRecurrence(raw.recurrence, at, problems)
  if (!recurrence) return null

  const ritual: SharedRitual = { key, title, input, recurrence }

  if (typeof raw.invocation === 'string' && raw.invocation.trim()) ritual.invocation = raw.invocation.trim()
  if (typeof raw.agentSlug === 'string' && raw.agentSlug.trim()) ritual.agentSlug = raw.agentSlug.trim()

  if (raw.requires !== undefined) {
    if (!Array.isArray(raw.requires) || raw.requires.some(p => typeof p !== 'string')) {
      problems.push({ at: `${at}.requires`, message: 'Should be a list of paths inside the repository. Ignored.' })
    } else {
      const safe = (raw.requires as string[]).map(p => p.trim()).filter(Boolean).filter((p) => {
        // A shared file is written by somebody else, so a path out of the
        // repository is refused rather than resolved. Reported below.
        const escapes = isAbsolute(p) || normalize(p).startsWith('..')
        if (escapes) {
          problems.push({
            at: `${at}.requires`,
            message: `"${p}" points outside the repository. Only paths inside it are checked.`,
          })
        }
        return !escapes
      })

      if (safe.length) ritual.requires = safe
    }
  }

  return ritual
}

function parseRecurrence(value: unknown, at: string, problems: SharedProblem[]): Recurrence | null {
  const raw = (value ?? {}) as Partial<Recurrence>
  const hour = raw.hour
  const minute = raw.minute

  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    problems.push({ at: `${at}.recurrence.hour`, message: 'Needs an hour from 0 to 23. Ignored.' })
    return null
  }
  if (typeof minute !== 'number' || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    problems.push({ at: `${at}.recurrence.minute`, message: 'Needs a minute from 0 to 59. Ignored.' })
    return null
  }

  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : []

  if (Array.isArray(raw.days) && days.length !== new Set(raw.days).size) {
    problems.push({
      at: `${at}.recurrence.days`,
      message: 'Days are 0 (Sunday) to 6. Anything else in the list is ignored.',
    })
  }

  return { hour, minute, days }
}

/**
 * What is wrong with a shared ritual *here*, as opposed to in the file.
 *
 * The brief's case: a ritual that names a path only one machine has. It is not
 * an invalid ritual — it is a valid one that cannot work on this checkout, and
 * the difference matters because the fix is on the machine, not in the file.
 */
export function ritualProblems(ritual: SharedRitual, repoDir: string): SharedProblem[] {
  const missing = (ritual.requires ?? []).filter(path => !existsSync(join(repoDir, path)))
  if (!missing.length) return []

  return [{
    at: `rituals.${ritual.key}`,
    message: `"${ritual.title}" needs ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} `
      + 'not in this checkout. It is listed but will not be run here.',
  }]
}

// --- Writing ----------------------------------------------------------------

/**
 * Change the shared half, keeping everything this version does not understand.
 *
 * Two spaces and a trailing newline because this file is read as a diff by
 * whoever reviews the commit — the formatting is part of what makes sharing a
 * decision rather than a side effect.
 */
export async function updateSharedProject(
  repoDir: string,
  mutate: (config: SharedProject) => void,
): Promise<SharedRead> {
  const path = sharedProjectPath(repoDir)
  const before = await readSharedProject(repoDir)

  const config: SharedProject = JSON.parse(JSON.stringify(before.config))
  mutate(config)

  const body: Record<string, unknown> = { version: SHARED_VERSION, ...before.unknown }
  if (config.checks) body.checks = config.checks
  if (config.sandbox) body.sandbox = config.sandbox
  if (config.rituals?.length) body.rituals = config.rituals

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8')

  return readSharedProject(repoDir)
}

// --- Precedence -------------------------------------------------------------

/** Which half of the configuration a value came from. */
export type ConfigScope = 'machine' | 'repository' | 'default'

export interface Scoped<T> {
  value: T
  scope: ConfigScope
  /** The file it came from, when it came from one. For saying so on the page. */
  from?: string
}

/**
 * The one precedence rule, in one place: machine, then repository, then the
 * built-in default.
 *
 * A shared value is a default and never an imposition. The alternative — the
 * repository winning — means a colleague's commit can change what your machine
 * runs and what it is allowed to reach, which is precisely what keeping these
 * files off `.claude/settings.json` was protecting. Going back to the team's
 * answer is deleting your override, which is a thing you do on purpose.
 */
export function scoped<T>(
  machine: T | undefined,
  repository: T | undefined,
  fallback: T,
  from?: string,
): Scoped<T> {
  if (machine !== undefined) return { value: machine, scope: 'machine' }
  if (repository !== undefined) return { value: repository, scope: 'repository', from }

  return { value: fallback, scope: 'default' }
}
