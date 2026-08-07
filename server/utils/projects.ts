import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'

/**
 * The repositories this machine works in.
 *
 * There used to be exactly one, held in the browser's local storage, and
 * everything downstream inherited that: switching projects meant retyping a
 * path, and closing the tab in the wrong browser profile meant losing which
 * project you were in. None of that was a real constraint — a session has
 * always recorded its own `repoDir`, checks have always been keyed by
 * repository, and a ritual has always carried the directory it runs in. The
 * single working directory was only ever a limit on what could be *said*.
 *
 * So this is the list, on disk, next to the sessions that reference it. One
 * project is active at a time, because project-scoped configuration comes from
 * exactly one `.claude` directory and pretending otherwise would make "which
 * agents do I have" unanswerable. Everything else — sessions, rituals, runs —
 * spans all of them.
 */

/**
 * h3's error inside the server, so the message survives serialisation; a plain
 * one outside it, where `createError` is not an auto-import that exists.
 */
function badRequest(message: string): Error {
  if (typeof createError === 'function') return createError({ statusCode: 400, message })
  return new Error(message)
}

export interface Project {
  /**
   * Absolute and resolved. This is the identity of a project: sessions,
   * checks and rituals all reference a repository by its path, so two spellings
   * of the same directory would read as two projects that share their work.
   */
  path: string
  /** What a list calls it. Defaults to the last segment of the path. */
  name: string
  addedAt: number
  /** Most recently worked in, first — which is the order a switcher wants. */
  lastUsedAt: number
  /**
   * A folder this repository lives inside, kept readable from every session.
   *
   * Set when the repository was picked out of a parent that is not one:
   *
   *   project/          <- contextDir
   *     app/            <- the project
   *     specs/
   *
   * A session works in a worktree, which is a copy of the repository alone.
   * The specs are not in it and never can be, so without this they simply
   * vanish the moment work moves into a session — which is most of the reason
   * the parent was chosen in the first place.
   */
  contextDir?: string
}

interface ProjectState {
  projects: Project[]
  /** Path of the active project, or null when none is. */
  activePath: string | null
}

export const projectStore = defineJsonStore<ProjectState>({
  label: 'projects',
  path: () => join(getClaudeDir(), 'agents-ui', 'projects.json'),
  empty: () => ({ projects: [], activePath: null }),
  decode: parsed => ({
    projects: (parsed?.projects ?? []).filter((p: Project) => p?.path),
    activePath: parsed?.activePath ?? null,
  }),
  encode: state => ({ version: 1, ...state }),
})

/**
 * One spelling of a directory, so the same repository is never two projects.
 *
 * The directory picker hands back paths with a trailing slash and people type
 * `~`, and both of those would otherwise produce a second entry for a project
 * that is already in the list.
 */
export function normaliseProjectPath(input: string): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return null

  const expanded = raw === '~'
    ? homedir()
    : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw

  if (!isAbsolute(expanded)) return null
  return resolve(expanded)
}

export function defaultProjectName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

/** Most recently used first; ties broken by name so the order is stable. */
function byRecency(a: Project, b: Project): number {
  return b.lastUsedAt - a.lastUsedAt || a.name.localeCompare(b.name)
}

export async function readProjectState(): Promise<ProjectState> {
  const state = await projectStore.read()
  return { ...state, projects: [...state.projects].sort(byRecency) }
}

export async function readProjects(): Promise<Project[]> {
  return (await readProjectState()).projects
}

/**
 * Add a project, or return the one already there.
 *
 * Adding is deliberately not the same as activating: the sidebar does both, but
 * a session started against a path nobody has registered should record the
 * repository without yanking the person's view to it.
 */
export async function addProject(
  input: string,
  name?: string,
  contextDir?: string,
): Promise<Project | null> {
  const path = normaliseProjectPath(input)
  if (!path || !existsSync(path)) return null

  // Only a real directory, and never the project itself — a repository is
  // already readable from its own worktree.
  const context = contextDir ? normaliseProjectPath(contextDir) : null
  const validContext = context && context !== path && existsSync(context) ? context : undefined

  return projectStore.update((state) => {
    const existing = state.projects.find(p => p.path === path)
    if (existing) {
      if (name?.trim()) existing.name = name.trim()
      if (validContext) existing.contextDir = validContext
      return existing
    }

    const now = Date.now()
    const project: Project = {
      path,
      name: name?.trim() || defaultProjectName(path),
      addedAt: now,
      lastUsedAt: now,
      ...(validContext ? { contextDir: validContext } : {}),
    }
    state.projects.push(project)
    return project
  })
}

/**
 * Make a project the active one, adding it if it is new.
 *
 * Passing null means "no project", which is a real state: the app works against
 * your personal `~/.claude` alone, and forcing a choice before anything can be
 * read would make the first run worse than it needs to be.
 */
export async function setActiveProject(input: string | null): Promise<ProjectState> {
  if (input === null) {
    return projectStore.update((state) => {
      state.activePath = null
      return { ...state, projects: [...state.projects].sort(byRecency) }
    })
  }

  const path = normaliseProjectPath(input)
  if (!path || !existsSync(path)) {
    throw badRequest(`Not a directory on this machine: ${input}`)
  }

  await addProject(path)

  return projectStore.update((state) => {
    const project = state.projects.find(p => p.path === path)
    if (project) project.lastUsedAt = Date.now()
    state.activePath = path
    return { ...state, projects: [...state.projects].sort(byRecency) }
  })
}

/**
 * Forget a project. Nothing on disk is touched — not the repository, not its
 * worktrees, not the sessions that branched from it. Those sessions keep
 * working, and keep naming a repository that is no longer in the list, which is
 * the honest outcome: removing a bookmark is not the same as ending the work.
 */
export async function removeProject(input: string): Promise<boolean> {
  const path = normaliseProjectPath(input)
  if (!path) return false

  return projectStore.update((state) => {
    const index = state.projects.findIndex(p => p.path === path)
    if (index < 0) return false

    state.projects.splice(index, 1)
    // Whatever was used most recently is the least surprising thing to land on.
    if (state.activePath === path) {
      state.activePath = [...state.projects].sort(byRecency)[0]?.path ?? null
    }
    return true
  })
}

export async function renameProject(input: string, name: string): Promise<Project | null> {
  const path = normaliseProjectPath(input)
  const trimmed = name.trim()
  if (!path || !trimmed) return null

  return projectStore.update((state) => {
    const project = state.projects.find(p => p.path === path)
    if (!project) return null
    project.name = trimmed
    return project
  })
}

/**
 * Note that work happened in a project, so the switcher's order reflects where
 * you have actually been rather than the order things were added.
 */
export async function touchProject(input: string | null | undefined): Promise<void> {
  const path = input ? normaliseProjectPath(input) : null
  if (!path) return

  await projectStore.update((state) => {
    const project = state.projects.find(p => p.path === path)
    if (project) project.lastUsedAt = Date.now()
  })
}

/**
 * Fill an empty list from the work that already exists.
 *
 * Turning this on should not present someone who has run twenty sessions with
 * an empty project list and a path to retype. Sessions and rituals already name
 * their repositories, so the list can be rebuilt from them exactly once — when
 * the file has never been written. After that the list is the person's own, and
 * a project they removed must stay removed.
 */
export async function seedProjectsIfUnwritten(
  paths: (string | null | undefined)[],
  activePath?: string | null,
): Promise<void> {
  if (existsSync(projectStore.path())) return

  const seen = new Set<string>()
  for (const candidate of paths) {
    const path = candidate ? normaliseProjectPath(candidate) : null
    if (!path || seen.has(path) || !existsSync(path)) continue
    seen.add(path)
    await addProject(path)
  }

  if (seen.size) {
    const active = activePath ? normaliseProjectPath(activePath) : null
    await setActiveProject(active && seen.has(active) ? active : [...seen][0]!)
  }
}

/**
 * Directories a session in this repository should also be able to read.
 *
 * Empty for an ordinary project, which is the overwhelming case — this exists
 * for the repository that was picked out of a larger folder, where everything
 * it was picked out of is the context the work depends on.
 */
export async function contextDirsFor(repoDir: string | undefined): Promise<string[]> {
  if (!repoDir) return []
  try {
    const path = normaliseProjectPath(repoDir)
    const project = (await projectStore.read()).projects.find(p => p.path === path)
    return project?.contextDir && existsSync(project.contextDir) ? [project.contextDir] : []
  } catch {
    // A session that cannot read the list still runs; it just sees less.
    return []
  }
}
