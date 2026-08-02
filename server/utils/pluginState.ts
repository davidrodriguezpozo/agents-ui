import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { getScopeRoots, type ScopeRoot } from './scope'

async function readEnabledMap(claudeDir: string): Promise<Record<string, boolean>> {
  const path = join(claudeDir, 'settings.json')
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as { enabledPlugins?: Record<string, boolean> }
    return parsed.enabledPlugins ?? {}
  } catch {
    return {}
  }
}

/**
 * Resolve whether each installed plugin is enabled. Project settings win over
 * user settings, and an installed plugin with no entry anywhere is enabled —
 * `enabledPlugins` records deviations from that default, not the full set.
 */
export async function resolveEnabledPlugins(event: H3Event): Promise<(id: string) => boolean> {
  return resolveEnabledPluginsInRoots(getScopeRoots(event))
}

/** Root-based variant, for callers without an HTTP request (the scheduler). */
export async function resolveEnabledPluginsInRoots(roots: ScopeRoot[]): Promise<(id: string) => boolean> {
  const maps = await Promise.all(roots.map(root => readEnabledMap(root.dir)))

  // Later roots (project) take precedence over earlier ones (user).
  const merged = Object.assign({}, ...maps) as Record<string, boolean>
  return (id: string) => merged[id] ?? true
}
