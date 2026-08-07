import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BuildStatus } from './buildInfo'

const exec = promisify(execFile)

/**
 * Whether there is a newer version, and the shortest way to get it.
 *
 * The app already knew what it was running and never said so unless a checkout
 * had drifted — which meant an npm install, the way most people have this,
 * showed no version anywhere at all.
 *
 * Two quite different situations, and conflating them is how you end up telling
 * somebody with no repository to run `git pull`:
 *
 *   - **Installed from npm.** The published release is the truth, so this asks
 *     the registry. Updating is one command.
 *   - **Running from a checkout.** The repository is the truth, and
 *     `buildStatus` already counts how far the running build is behind it. No
 *     network call is needed or wanted.
 */

export const PACKAGE_NAME = 'agents-studio'

/** The registry is somebody else's server, and this is a status line. */
const REGISTRY_TIMEOUT_MS = 6_000

/**
 * Checked at most this often. The answer changes when somebody publishes, which
 * is not something worth a request every time a page mounts.
 */
const CACHE_MS = 30 * 60_000

let cached: { version: string | null; at: number } | null = null

export function resetUpdateCache(): void {
  cached = null
}

/**
 * The newest published release, or null when it could not be asked.
 *
 * Null is "do not know" and must never be shown as "you are up to date" — an
 * offline machine being told it is current is worse than being told nothing.
 */
export async function latestVersion(now = Date.now()): Promise<string | null> {
  if (cached && now - cached.at < CACHE_MS) return cached.version

  try {
    const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`registry said ${response.status}`)

    const body = await response.json() as { version?: unknown }
    const version = typeof body.version === 'string' ? body.version : null

    cached = { version, at: now }
    return version
  } catch {
    // Offline, blocked, rate limited, or the registry is down. None of those
    // are worth an error on a status line; they are worth not claiming.
    cached = { version: null, at: now }
    return null
  }
}

/**
 * Compare two semver-ish strings. Only the numeric parts, and a prerelease
 * suffix loses to the same version without one — enough for "is there a newer
 * release", which is the only question asked here.
 */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) => {
    const [core = '', pre] = v.replace(/^v/, '').split('-', 2)
    return { nums: core.split('.').map(n => Number(n) || 0), pre: pre ?? '' }
  }

  const a = parts(candidate)
  const b = parts(current)

  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const x = a.nums[i] ?? 0
    const y = b.nums[i] ?? 0
    if (x !== y) return x > y
  }

  // Same numbers: a release beats a prerelease of it, nothing else counts.
  if (a.pre === b.pre) return false
  return a.pre === ''
}

export interface UpdatePlan {
  /** What is running now, when it can be named. */
  current?: string
  /** The newest published release, when the registry could be reached. */
  latest?: string
  available: boolean
  /** Null when the question does not apply, e.g. running from source. */
  command: string | null
  /**
   * Whether this instance can run the update itself. False in a checkout —
   * `git pull` there is the person's business, not a button's.
   */
  canRun: boolean
  /**
   * Whether exiting would bring it straight back. Installing registers a
   * launchd agent or systemd unit that restarts on exit, so a deployed build
   * can restart itself and a foreground one cannot.
   */
  canRestart: boolean
  /** Said plainly when there is nothing to compare against. */
  note?: string
}

export async function updatePlan(status: BuildStatus): Promise<UpdatePlan> {
  const canRestart = Boolean(status.deployedAt)

  if (status.mode === 'source') {
    return {
      available: false,
      command: null,
      canRun: false,
      canRestart,
      note: 'Running from a checkout — updating here is `git pull` and a rebuild.',
    }
  }

  if (status.mode === 'deployed') {
    // The repository is the truth, and buildStatus already counted the gap.
    return {
      current: status.sha?.slice(0, 7),
      available: status.behind > 0,
      command: status.behind > 0 ? 'make service' : null,
      canRun: false,
      canRestart,
      note: status.behind > 0
        ? `The build is ${status.behind} commit${status.behind === 1 ? '' : 's'} behind this checkout.`
        : undefined,
    }
  }

  const current = status.version
  const latest = await latestVersion()

  if (!current) {
    return { latest: latest ?? undefined, available: false, command: null, canRun: false, canRestart,
      note: 'Cannot tell which release this is.' }
  }
  if (!latest) {
    return { current, available: false, command: null, canRun: false, canRestart,
      note: 'Could not reach the registry to check for a newer release.' }
  }

  const available = isNewer(latest, current)
  return {
    current,
    latest,
    available,
    command: available ? `npm install -g ${PACKAGE_NAME}@latest` : null,
    canRun: available,
    canRestart,
  }
}

export interface UpdateResult {
  ok: boolean
  message: string
  output: string
}

/** Kept short so the tail is the useful part rather than the whole install. */
function tail(text: string, max = 4000): string {
  const trimmed = text.trimEnd()
  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed
}

/**
 * Install the newest release over this one.
 *
 * Deliberately does not restart afterwards. The running process has its modules
 * already loaded so it keeps working, but it is still the old code until
 * something restarts it — and doing that silently, in the same click, would
 * take the app away mid-sentence from somebody who only wanted to know whether
 * an update existed.
 */
export async function runUpdate(): Promise<UpdateResult> {
  try {
    const { stdout, stderr } = await exec(
      'npm',
      ['install', '-g', `${PACKAGE_NAME}@latest`],
      { timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024 },
    )
    resetUpdateCache()
    return {
      ok: true,
      message: 'Installed. Restart to run it.',
      output: tail(`${stdout}${stderr}`),
    }
  } catch (e: any) {
    return {
      ok: false,
      message: e?.code === 'ETIMEDOUT'
        ? 'The install was still going after five minutes and was stopped.'
        : 'The install failed.',
      output: tail(`${e?.stdout ?? ''}${e?.stderr ?? ''}` || String(e?.message ?? e)),
    }
  }
}
