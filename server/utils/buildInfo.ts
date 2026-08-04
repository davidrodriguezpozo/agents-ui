import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * Which version of this app you are actually looking at.
 *
 * Installing is a deploy: the service runs a copy of the build taken at the
 * moment it was installed, which is what stops a rebuild from pulling the code
 * out from under a running server. The cost of that is drift — you can commit a
 * fix, watch the tests pass, and still be using the app from an hour ago
 * without a single sign that anything is behind.
 *
 * So the deploy leaves a note saying what it was cut from, and this reads it
 * back against the repository it came from.
 */

export interface DeployedBuild {
  sha: string
  subject: string
  committedAt: number
  deployedAt: number
  repoDir: string
}

export interface BuildStatus {
  /** `source` means someone is running it from the repo, where drift is moot. */
  mode: 'deployed' | 'source'
  sha?: string
  subject?: string
  deployedAt?: number
  repoDir?: string
  /** Commits in the repository that the running build does not have. */
  behind: number
  stale: boolean
  /** Set when the deployed commit is not in the repository any more. */
  unknownCommit?: boolean
}

export const BUILD_INFO_FILE = 'build-info.json'

/** How to say it, kept apart from finding it out so it can be tested. */
export function describeBuild(status: BuildStatus): string {
  if (status.mode === 'source') return 'Running from source'
  if (status.unknownCommit) return 'Running a build from a commit this repository no longer has'
  if (!status.behind) return 'Running the current build'

  return `Build is ${status.behind} commit${status.behind === 1 ? '' : 's'} behind`
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, timeout: 10_000 })
  return stdout.trim()
}

/**
 * The note left by the deploy, which sits beside the server it describes.
 * Running from the repository there is no note, and nothing to be stale about.
 */
export async function readDeployedBuild(dir = process.cwd()): Promise<DeployedBuild | null> {
  const path = join(dir, BUILD_INFO_FILE)
  if (!existsSync(path)) return null

  try {
    return JSON.parse(await readFile(path, 'utf-8')) as DeployedBuild
  } catch {
    return null
  }
}

export async function buildStatus(): Promise<BuildStatus> {
  const deployed = await readDeployedBuild()
  if (!deployed) return { mode: 'source', behind: 0, stale: false }

  const base: BuildStatus = {
    mode: 'deployed',
    sha: deployed.sha,
    subject: deployed.subject,
    deployedAt: deployed.deployedAt,
    repoDir: deployed.repoDir,
    behind: 0,
    stale: false,
  }

  // The repository can be moved, deleted or rewritten under a deployed build.
  // None of that is worth an error on a status line.
  if (!deployed.repoDir || !existsSync(deployed.repoDir)) return base

  try {
    await git(deployed.repoDir, ['cat-file', '-e', `${deployed.sha}^{commit}`])
  } catch {
    return { ...base, unknownCommit: true, stale: true }
  }

  try {
    const count = Number(await git(deployed.repoDir, ['rev-list', '--count', `${deployed.sha}..HEAD`]))
    const behind = Number.isFinite(count) ? count : 0
    return { ...base, behind, stale: behind > 0 }
  } catch {
    return base
  }
}
