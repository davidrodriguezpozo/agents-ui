import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'
import { readSharedProject, sharedProjectPath } from './sharedProject'

const exec = promisify(execFile)

/**
 * Whether a session's work actually holds up.
 *
 * Merging used to ask only what git could answer — are there commits, is the
 * checkout clean, would it conflict. None of those say whether the code runs,
 * which is the only question most people are really asking. A diff answers it
 * for someone who can read the diff; nobody reviewing six sessions is doing
 * that, and someone who doesn't write code never could.
 *
 * So the project's own checks run in the session's workspace and the verdict
 * travels with the session.
 */

export type CheckStatus =
  /** Ran, and the project is happy. */
  | 'passing'
  /** Ran, and the project is not. This is a verdict about the code. */
  | 'failing'
  /** Could not be run at all, so there is no verdict — see `output`. */
  | 'errored'
  | 'running'

export interface SessionCheck {
  status: CheckStatus
  command: string
  /**
   * The workspace state this verdict belongs to. When it no longer matches,
   * the result describes code that has since changed and is shown as stale
   * rather than quietly believed.
   */
  fingerprint: string
  exitCode: number | null
  /** The tail of what it printed — enough to see the failure, not the suite. */
  output: string
  durationMs: number
  at: number
}

/** Long enough for a real suite, short enough that a hang is not forever. */
export const CHECK_TIMEOUT_MS = 10 * 60_000

/** Beyond this the output is scroll, not evidence. */
const MAX_OUTPUT = 6000

function tail(text: string): string {
  const trimmed = text.trimEnd()
  if (trimmed.length <= MAX_OUTPUT) return trimmed
  return `…${trimmed.slice(-MAX_OUTPUT)}`
}

// --- What to run ------------------------------------------------------------

export interface DetectedCheck {
  command: string
  /** What in the repository this was inferred from, so the guess is auditable. */
  from: string
}

function readIfPresent(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null
  } catch {
    return null
  }
}

/**
 * Which package manager this repository is run with. Picked from the lockfile
 * rather than from what happens to be installed, because the lockfile is the
 * one the project committed to.
 */
export function detectPackageManager(repoDir: string): string {
  if (existsSync(join(repoDir, 'bun.lockb')) || existsSync(join(repoDir, 'bun.lock'))) return 'bun'
  if (existsSync(join(repoDir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(repoDir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

/** Whether a Makefile defines a target, ignoring pattern rules and variables. */
export function makefileHasTarget(makefile: string, target: string): boolean {
  return new RegExp(`^${target}\\s*:(?!=)`, 'm').test(makefile)
}

function packageScripts(repoDir: string): Record<string, string> {
  const raw = readIfPresent(join(repoDir, 'package.json'))
  if (!raw) return {}
  try {
    return JSON.parse(raw).scripts ?? {}
  } catch {
    return {}
  }
}

/**
 * A reasonable guess at how this project checks itself.
 *
 * Ordered by how much the project is asserting: a `check` target exists
 * precisely because someone decided what "is this alright" means here, so it
 * beats a bare test script. A wrong guess is cheap — it is shown, and can be
 * replaced — but an unconfigured project that silently checks nothing is not,
 * which is why this tries at all rather than waiting to be told.
 */
export function detectCheckCommand(repoDir: string): DetectedCheck | null {
  const makefile = readIfPresent(join(repoDir, 'Makefile')) ?? readIfPresent(join(repoDir, 'makefile'))
  if (makefile && makefileHasTarget(makefile, 'check')) {
    return { command: 'make check', from: 'the `check` target in your Makefile' }
  }

  const scripts = packageScripts(repoDir)
  const pm = detectPackageManager(repoDir)
  if (scripts.check) {
    return { command: `${pm} run check`, from: 'the `check` script in package.json' }
  }

  if (makefile && makefileHasTarget(makefile, 'test')) {
    return { command: 'make test', from: 'the `test` target in your Makefile' }
  }

  if (scripts.test) {
    return { command: `${pm} run test`, from: 'the `test` script in package.json' }
  }

  if (existsSync(join(repoDir, 'Cargo.toml'))) {
    return { command: 'cargo test', from: 'Cargo.toml' }
  }

  if (existsSync(join(repoDir, 'go.mod'))) {
    return { command: 'go test ./...', from: 'go.mod' }
  }

  if (existsSync(join(repoDir, 'pytest.ini')) || existsSync(join(repoDir, 'pyproject.toml'))) {
    return { command: 'pytest', from: 'your Python project files' }
  }

  return null
}

// --- What this project was told to run --------------------------------------

/**
 * The check command per repository.
 *
 * Keyed by repository for the same reason permissions are: "this is how you
 * tell whether it works here" is a fact about the project, not about one
 * conversation. An empty string is meaningful — it is how a project says it
 * has no checks and should stop being asked.
 *
 * Kept out of the project's own `.claude/settings.json`, which is usually
 * tracked: choosing what your machine runs before a merge should not become a
 * commit that decides it for everyone else.
 */
export type ProjectChecks = Record<string, string>

export const projectChecksStore = defineJsonStore<ProjectChecks>({
  label: 'project checks',
  path: () => join(getClaudeDir(), 'agents-ui', 'project-checks.json'),
  empty: () => ({}),
  decode: parsed => parsed?.projects ?? {},
  encode: projects => ({ version: 1, projects }),
})

export interface ResolvedCheck {
  command: string
  source: 'configured' | 'repository' | 'detected'
  /**
   * Where this came from, when it came from somewhere nameable: the file a
   * shared command was read out of, or the evidence a guess was made from.
   */
  from?: string
}

/**
 * What to run for a repository: what this machine was told, else what the
 * repository itself says, else what can be inferred.
 *
 * The middle step is the shared half — see `sharedProject.ts` for why it is a
 * default rather than an imposition, and `scoped` for the one precedence rule
 * this follows. Never throws: being unable to read any of it means falling back
 * to a guess, not failing the turn that asked.
 */
export async function checkCommandFor(repoDir: string | undefined): Promise<ResolvedCheck | null> {
  if (!repoDir) return null

  let configured: string | undefined
  try {
    configured = (await projectChecksStore.read())[repoDir]
  } catch {
    configured = undefined
  }

  // Explicitly emptied: this machine has said this project has no checks, and
  // that beats a shared command rather than falling through to it.
  if (configured === '') return null
  if (configured) return { command: configured, source: 'configured' }

  const shared = (await readSharedProject(repoDir)).config.checks
  if (shared) {
    // The same meaning as above, said by the project: no checks here.
    if (!shared.command) return null
    return { command: shared.command, source: 'repository', from: sharedProjectPath(repoDir) }
  }

  const detected = detectCheckCommand(repoDir)
  return detected ? { command: detected.command, source: 'detected', from: detected.from } : null
}

/** Pass an empty string to say this project has no checks worth running. */
export async function setCheckCommand(repoDir: string, command: string): Promise<string> {
  return projectChecksStore.update((projects) => {
    const next = command.trim()
    projects[repoDir] = next
    return next
  })
}

/** Forget the override, so detection applies again. */
export async function clearCheckCommand(repoDir: string): Promise<void> {
  await projectChecksStore.update((projects) => {
    delete projects[repoDir]
  })
}

// --- Running it -------------------------------------------------------------

/**
 * A failure to run is not a failure of the code.
 *
 * A workspace missing its dependencies, a command that isn't on PATH, a typo
 * in the configured command — all exit non-zero, and reporting them as "your
 * tests failed" would be a lie that blocks a perfectly good merge. These are
 * reported as having no verdict at all.
 */
export function looksUnrunnable(exitCode: number | null, output: string): boolean {
  if (exitCode === 127) return true
  return /(command not found|: not found|No such file or directory\s*$|Cannot find module|Cannot find package|ENOENT|is not recognized as an internal)/im
    .test(output)
}

export interface CheckOutcome {
  status: Exclude<CheckStatus, 'running'>
  exitCode: number | null
  output: string
  durationMs: number
}

/**
 * Run a project's checks in a workspace and say what happened.
 *
 * Through a shell, because what people write here is a shell line — `make
 * check`, `npm test && npm run lint`. Nothing is interpreted; a non-zero exit
 * is the verdict.
 */
export async function runCheck(opts: {
  command: string
  cwd: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<CheckOutcome> {
  const started = Date.now()

  if (!existsSync(opts.cwd)) {
    return {
      status: 'errored',
      exitCode: null,
      output: `The workspace at ${opts.cwd} is not on disk, so nothing could be run there.`,
      durationMs: 0,
    }
  }

  try {
    const { stdout, stderr } = await exec('/bin/sh', ['-c', opts.command], {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? CHECK_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
      signal: opts.signal,
      env: process.env,
    })
    return {
      status: 'passing',
      exitCode: 0,
      output: tail(`${stdout}${stderr}`),
      durationMs: Date.now() - started,
    }
  } catch (e: any) {
    const durationMs = Date.now() - started
    const output = tail(`${e.stdout ?? ''}${e.stderr ?? ''}` || e.message || '')

    if (e.killed || e.signal === 'SIGTERM') {
      const minutes = Math.round((opts.timeoutMs ?? CHECK_TIMEOUT_MS) / 60_000)
      return {
        status: 'errored',
        exitCode: null,
        output: `\`${opts.command}\` was still running after ${minutes} minutes and was stopped, so there is no verdict.\n\n${output}`,
        durationMs,
      }
    }

    const exitCode = typeof e.code === 'number' ? e.code : null
    return {
      status: looksUnrunnable(exitCode, output) ? 'errored' : 'failing',
      exitCode,
      output,
      durationMs,
    }
  }
}

// --- Knowing when a verdict has gone stale ----------------------------------

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', args, { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 })
    return stdout.trim()
  } catch {
    return ''
  }
}

/**
 * A stable summary of everything in a workspace that a check could care about:
 * what is committed, and what is not yet. Two turns that produce the same
 * fingerprint produce the same test run, so the second one need not happen —
 * and a fingerprint that has moved on since a verdict means that verdict is
 * describing code that no longer exists.
 */
export async function worktreeFingerprint(worktreePath: string): Promise<string> {
  if (!existsSync(worktreePath)) return ''

  const head = await git(worktreePath, ['rev-parse', 'HEAD'])
  const porcelain = await git(worktreePath, ['status', '--porcelain'])
  // Uncommitted content, not just its filenames — an edit that changes no file
  // list still changes what the tests do.
  const dirtyDiff = porcelain ? await git(worktreePath, ['diff', 'HEAD']) : ''

  return createHash('sha1').update(`${head}\n${porcelain}\n${dirtyDiff}`).digest('hex')
}

/** Whether a recorded verdict still describes what is in the workspace now. */
export function isStale(check: SessionCheck | undefined, fingerprint: string): boolean {
  if (!check) return false
  if (check.status === 'running') return false
  return Boolean(fingerprint) && check.fingerprint !== fingerprint
}
