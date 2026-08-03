import { existsSync } from 'node:fs'
import { mkdir, readdir, rmdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getClaudeDir } from './claudeDir'
import { patchSession, readSessions } from './sessions'
import { excludeWorktreeDir, isGitRepo, worktreePathFor } from './worktrees'

const exec = promisify(execFile)

/**
 * Move session worktrees out of the app's own directory and into their repos.
 *
 * They used to live under `~/.claude/agents-ui/worktrees/`, which put a user's
 * actual work inside the directory holding the app's state — so anything that
 * reset the app destroyed the work with it. This runs once at startup and is a
 * no-op afterwards.
 *
 * `git worktree move` keeps uncommitted changes and re-points git's own
 * registration, so nothing is copied by hand. Any session that cannot be moved
 * is left exactly where it is: the old path still works, and the next startup
 * will try again.
 */

export function legacyWorktreeRoot(): string {
  return join(getClaudeDir(), 'agents-ui', 'worktrees')
}

export interface MigrationResult {
  moved: { id: string; from: string; to: string }[]
  failed: { id: string; reason: string }[]
}

export async function migrateWorktrees(): Promise<MigrationResult> {
  const result: MigrationResult = { moved: [], failed: [] }

  const legacyRoot = legacyWorktreeRoot()
  if (!existsSync(legacyRoot)) return result

  const sessions = await readSessions()

  for (const session of sessions) {
    if (!session.worktreePath.startsWith(legacyRoot)) continue

    const target = worktreePathFor(session.repoDir, session.id)

    // Nothing to move: the directory is already gone. Leave the record alone so
    // the worktree-recovery path can still offer to rebuild it.
    if (!existsSync(session.worktreePath)) continue

    if (existsSync(target)) {
      result.failed.push({ id: session.id, reason: `Something already exists at ${target}` })
      continue
    }

    if (!(await isGitRepo(session.repoDir))) {
      result.failed.push({ id: session.id, reason: `${session.repoDir} is no longer a git repository` })
      continue
    }

    try {
      await excludeWorktreeDir(session.repoDir)
      await mkdir(join(target, '..'), { recursive: true })

      await exec('git', ['worktree', 'move', session.worktreePath, target], {
        cwd: session.repoDir,
        timeout: 120_000,
      })

      await patchSession(session.id, { worktreePath: target })
      result.moved.push({ id: session.id, from: session.worktreePath, to: target })
    } catch (e: any) {
      result.failed.push({
        id: session.id,
        reason: e?.stderr?.trim() || e?.message || 'Unknown error',
      })
    }
  }

  await removeEmptyLegacyDirs(legacyRoot)
  return result
}

/**
 * Tidy the empty shells the move leaves behind, so the old location does not
 * linger and invite the question of which one is real. Only ever removes empty
 * directories, so anything not migrated is left untouched.
 */
async function removeEmptyLegacyDirs(legacyRoot: string): Promise<void> {
  const perRepo = await readdir(legacyRoot).catch(() => [] as string[])

  for (const name of perRepo) {
    await rmdir(join(legacyRoot, name)).catch(() => {})
  }
  await rmdir(legacyRoot).catch(() => {})
}
