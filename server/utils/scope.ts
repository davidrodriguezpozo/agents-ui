import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { H3Event } from 'h3'
import { getClaudeDir } from './claudeDir'

export type Scope = 'user' | 'project'

export interface ScopeRoot {
  scope: Scope
  /** The `.claude` directory for this scope */
  dir: string
  /** For project scope, the repository root that contains `.claude` */
  projectDir?: string
}

const PROJECT_DIR_HEADER = 'x-project-dir'
const SCOPE_HEADER = 'x-claude-scope'

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * The project root the client is currently pointed at, or null.
 * Sent as the `x-project-dir` header by the client $fetch interceptor;
 * also accepted as a `projectDir` query param for direct API use.
 */
export function getProjectDir(event: H3Event): string | null {
  const header = getHeader(event, PROJECT_DIR_HEADER)
  const queryValue = getQuery(event).projectDir
  const raw = (header || (typeof queryValue === 'string' ? queryValue : '') || '').trim()
  if (!raw) return null

  const expanded = expandHome(decode(raw))
  if (!isAbsolute(expanded)) return null

  const dir = resolve(expanded)
  return existsSync(dir) ? dir : null
}

/** `<projectDir>/.claude`, or null when no project is selected. */
export function getProjectClaudeDir(event: H3Event): string | null {
  const projectDir = getProjectDir(event)
  return projectDir ? join(projectDir, '.claude') : null
}

/** Which scope a write should target. Defaults to `user`. */
export function getRequestScope(event: H3Event): Scope {
  const queryValue = getQuery(event).scope
  const raw = (typeof queryValue === 'string' ? queryValue : getHeader(event, SCOPE_HEADER)) || 'user'
  return raw === 'project' ? 'project' : 'user'
}

/**
 * Every scope worth reading from, in precedence order (user first, then project).
 * Project is only included when a project directory is selected and it actually
 * has a `.claude` directory — unless `includeMissing` is set, which callers use
 * when they are about to create it.
 */
export function getScopeRoots(event: H3Event, opts: { includeMissing?: boolean } = {}): ScopeRoot[] {
  return scopeRootsFor(getProjectDir(event), opts)
}

/**
 * Scope roots from an explicit project directory rather than a request. Used by
 * background work (the scheduler) which has no HTTP context to read headers from.
 */
export function scopeRootsFor(
  projectDir?: string | null,
  opts: { includeMissing?: boolean } = {},
): ScopeRoot[] {
  const roots: ScopeRoot[] = [{ scope: 'user', dir: getClaudeDir() }]

  if (projectDir && existsSync(projectDir)) {
    const dir = join(projectDir, '.claude')
    if (opts.includeMissing || existsSync(dir)) {
      roots.push({ scope: 'project', dir, projectDir })
    }
  }

  return roots
}

/** Resolve a path inside a specific scope's `.claude` directory. */
export function resolveScoped(event: H3Event, scope: Scope, ...segments: string[]): string {
  if (scope === 'project') {
    const dir = getProjectClaudeDir(event)
    if (!dir) {
      throw createError({
        statusCode: 400,
        message: 'No project directory selected. Pick one in the sidebar before using project scope.',
      })
    }
    return join(dir, ...segments)
  }
  return join(getClaudeDir(), ...segments)
}

/** Resolve a path inside the scope this request asked for. */
export function resolveForRequest(event: H3Event, ...segments: string[]): string {
  return resolveScoped(event, getRequestScope(event), ...segments)
}

/**
 * Find which scope actually contains `relativePath`, preferring the requested
 * scope. Lets read/update/delete handlers work without the client having to
 * remember where an item lives.
 */
export function findScopeContaining(event: H3Event, ...segments: string[]): ScopeRoot | null {
  const requested = getRequestScope(event)
  const roots = getScopeRoots(event)
  const ordered = [
    ...roots.filter(r => r.scope === requested),
    ...roots.filter(r => r.scope !== requested),
  ]

  for (const root of ordered) {
    if (existsSync(join(root.dir, ...segments))) return root
  }
  return null
}
