import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'
import { detectPackageManager } from './checks'

const exec = promisify(execFile)

/**
 * Making a session's workspace runnable.
 *
 * A worktree is a bare checkout: the tracked files and nothing else. No
 * `node_modules`, no `.venv`, no generated types. So the project's own checks —
 * the whole basis for saying whether a session's work holds up — run against a
 * workspace that cannot run anything.
 *
 * On a real machine this was invisible rather than loud. Worktrees live inside
 * the repository, so Node walks up and finds the main checkout's dependencies
 * by accident, and the command half-works: it starts, then fails on something
 * generated that isn't there. Fifteen sessions, not one verdict between them,
 * and nothing ever said why.
 *
 * So a project gets a setup command as well as a check command, run once per
 * workspace before the first check. Lazily, not at creation: starting a session
 * should stay instant, and the minute this costs is worth paying at the point
 * something actually needs the answer.
 */

export type ProjectSetup = Record<string, string>

/**
 * Kept beside the check commands and for the same reason: how this project is
 * made ready is a fact about the project, and choosing what your machine runs
 * should not become a commit that decides it for everyone else.
 */
export const projectSetupStore = defineJsonStore<ProjectSetup>({
  label: 'project setup',
  path: () => join(getClaudeDir(), 'agents-ui', 'project-setup.json'),
  empty: () => ({}),
  decode: parsed => parsed?.projects ?? {},
  encode: projects => ({ version: 1, projects }),
})

export interface DetectedSetup {
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
 * A reasonable guess at what makes a fresh checkout of this project runnable.
 *
 * Install, and then whatever the project does to generate what it needs — a
 * `prepare` script exists precisely because a clean clone is not yet usable,
 * which is exactly the situation a worktree is in.
 */
export function detectSetupCommand(repoDir: string): DetectedSetup | null {
  const packageJson = readIfPresent(join(repoDir, 'package.json'))
  if (packageJson) {
    const pm = detectPackageManager(repoDir)
    let scripts: Record<string, string> = {}
    try {
      scripts = JSON.parse(packageJson).scripts ?? {}
    } catch {
      scripts = {}
    }

    // `npm ci` needs a lockfile and fails without one; `install` always works.
    const install = pm === 'npm' && existsSync(join(repoDir, 'package-lock.json'))
      ? 'npm ci'
      : `${pm} install`

    return scripts.prepare
      ? { command: install, from: 'package.json — `prepare` runs on install' }
      : { command: install, from: `the ${pm} lockfile` }
  }

  if (existsSync(join(repoDir, 'Cargo.toml'))) {
    return { command: 'cargo fetch', from: 'Cargo.toml' }
  }

  if (existsSync(join(repoDir, 'go.mod'))) {
    return { command: 'go mod download', from: 'go.mod' }
  }

  if (existsSync(join(repoDir, 'requirements.txt'))) {
    return { command: 'pip install -r requirements.txt', from: 'requirements.txt' }
  }

  return null
}

export interface ResolvedSetup {
  command: string
  source: 'configured' | 'detected'
  from?: string
}

/**
 * What to run to make a workspace of this repository usable: what it was told,
 * else what can be inferred. An empty string is a real answer — it is how a
 * project says its checkouts need nothing, and stops being asked.
 */
export async function setupCommandFor(repoDir: string | undefined): Promise<ResolvedSetup | null> {
  if (!repoDir) return null

  let configured: string | undefined
  try {
    configured = (await projectSetupStore.read())[repoDir]
  } catch {
    configured = undefined
  }

  if (configured === '') return null
  if (configured) return { command: configured, source: 'configured' }

  const detected = detectSetupCommand(repoDir)
  return detected ? { command: detected.command, source: 'detected', from: detected.from } : null
}

/** Pass an empty string to say this project's checkouts are ready as they are. */
export async function setSetupCommand(repoDir: string, command: string): Promise<string> {
  return projectSetupStore.update((projects) => {
    const next = command.trim()
    projects[repoDir] = next
    return next
  })
}

export async function clearSetupCommand(repoDir: string): Promise<void> {
  await projectSetupStore.update((projects) => {
    delete projects[repoDir]
  })
}

// --- Doing it, once per workspace --------------------------------------------

export interface SetupOutcome {
  status: 'ready' | 'skipped' | 'failed'
  /** Why it could not be done, when it could not. */
  message?: string
}

/**
 * Installing is slow and there is no point doing it twice, so a workspace that
 * has been prepared stays prepared for the life of the process. Keyed by path:
 * a worktree that is removed and re-cut gets a different one.
 */
const prepared = new Map<string, Promise<SetupOutcome>>()

export function forgetPrepared(worktreePath?: string): void {
  if (worktreePath) prepared.delete(worktreePath)
  else prepared.clear()
}

/** Long: an install on a cold cache is minutes, and giving up early is worse. */
const SETUP_TIMEOUT_MS = 15 * 60_000

/**
 * Make a workspace runnable, if it isn't already and this project says how.
 *
 * Never throws. A setup that fails is reported so the check can say the
 * workspace could not be prepared, which is a far better answer than a test
 * failure that is really a missing dependency.
 */
export async function prepareWorkspace(
  repoDir: string | undefined,
  worktreePath: string,
): Promise<SetupOutcome> {
  const existing = prepared.get(worktreePath)
  if (existing) return existing

  const attempt = (async (): Promise<SetupOutcome> => {
    const resolved = await setupCommandFor(repoDir)
    if (!resolved) return { status: 'skipped' }
    if (!existsSync(worktreePath)) {
      return { status: 'failed', message: 'The workspace is not on disk.' }
    }

    try {
      await exec('/bin/sh', ['-c', resolved.command], {
        cwd: worktreePath,
        timeout: SETUP_TIMEOUT_MS,
        maxBuffer: 20 * 1024 * 1024,
        env: process.env,
      })
      return { status: 'ready' }
    } catch (e: any) {
      const output = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim()
      const tail = output.split('\n').filter(Boolean).at(-1) ?? e.message
      return {
        status: 'failed',
        message: `\`${resolved.command}\` did not finish: ${tail}`,
      }
    }
  })()

  prepared.set(worktreePath, attempt)

  // A failure is worth retrying — a network blip should not mark a workspace
  // permanently unpreparable. A success is not worth repeating.
  const outcome = await attempt
  if (outcome.status === 'failed') prepared.delete(worktreePath)

  return outcome
}
