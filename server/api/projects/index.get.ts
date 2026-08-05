import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readProjectState, seedProjectsIfUnwritten } from '../../utils/projects'
import { readSessions } from '../../utils/sessions'
import { readSchedules } from '../../utils/schedules'
import { currentBranch, isGitRepo } from '../../utils/worktrees'
import { getProjectDir } from '../../utils/scope'

/**
 * Every project, with the state of each one on disk.
 *
 * A registered project can stop being a repository — moved, renamed, deleted —
 * and the switcher has to say so rather than offering it and failing later. So
 * the stored list is only the paths; whether each is there, and what it is on,
 * is read fresh.
 */
export default defineEventHandler(async (event) => {
  // The first read after upgrading finds no file, and someone with sessions
  // already running should not be asked to retype the paths those sessions
  // record. Anything the client still has in local storage wins as the active
  // one, since that is the project they were last looking at.
  const [sessions, schedules] = await Promise.all([
    readSessions().catch(() => []),
    readSchedules().catch(() => []),
  ])
  await seedProjectsIfUnwritten(
    [
      // Most recently touched first, so the seeded list opens in a useful order.
      ...[...sessions].sort((a, b) => b.updatedAt - a.updatedAt).map(s => s.repoDir),
      ...schedules.map(s => s.projectDir),
    ],
    getProjectDir(event),
  )

  const state = await readProjectState()

  const projects = await Promise.all(state.projects.map(async (project) => {
    const exists = existsSync(project.path)
    const isRepo = exists && await isGitRepo(project.path)

    return {
      ...project,
      exists,
      isRepo,
      // Only meaningful for a repository, and only worth a subprocess for one.
      branch: isRepo ? await currentBranch(project.path).catch(() => null) : null,
      // Whether writing to project scope would land somewhere that exists yet.
      hasClaudeDir: exists && existsSync(join(project.path, '.claude')),
      sessionCount: sessions.filter(s => s.repoDir === project.path).length,
    }
  }))

  return {
    projects,
    activePath: state.activePath,
    // So the client can shorten paths to `~/…` without guessing where home is.
    home: homedir(),
  }
})
