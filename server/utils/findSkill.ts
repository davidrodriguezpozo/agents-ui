import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { H3Event } from 'h3'
import { getScopeRoots, type Scope } from './scope'
import { readInstalledPlugins, scanPluginComponents } from './pluginScan'
import { readImportsRegistry } from './github'

export interface FoundSkill {
  slug: string
  /** Directory containing SKILL.md — also holds any supporting files. */
  dir: string
  skillPath: string
  source: 'local' | 'plugin' | 'github'
  scope?: Scope
  projectDir?: string
  pluginId?: string
  pluginName?: string
  githubRepo?: string
}

/** Locate a skill across user scope, project scope, plugins and GitHub imports. */
export async function findSkill(event: H3Event, slug: string): Promise<FoundSkill | null> {
  const roots = getScopeRoots(event)

  for (const root of roots) {
    const dir = join(root.dir, 'skills', slug)
    const skillPath = join(dir, 'SKILL.md')
    if (existsSync(skillPath)) {
      return { slug, dir, skillPath, source: 'local', scope: root.scope, projectDir: root.projectDir }
    }
  }

  const plugins = await readInstalledPlugins(roots[0]!.dir)
  for (const plugin of plugins) {
    const components = await scanPluginComponents(plugin.entry.installPath, plugin.name)
    const match = components.skills.find(s => s.slug === slug)
    if (match) {
      return {
        slug,
        dir: dirname(match.filePath),
        skillPath: match.filePath,
        source: 'plugin',
        pluginId: plugin.id,
        pluginName: plugin.name,
      }
    }
  }

  const githubDir = join(roots[0]!.dir, 'github')
  if (existsSync(githubDir)) {
    const registry = await readImportsRegistry()

    for (const entry of registry.imports) {
      if (!existsSync(entry.localPath)) continue
      const scanRoot = entry.targetPath ? join(entry.localPath, entry.targetPath) : entry.localPath
      const found = await findSkillDirIn(scanRoot, slug)
      if (found) {
        return {
          slug,
          dir: found,
          skillPath: join(found, 'SKILL.md'),
          source: 'github',
          githubRepo: `${entry.owner}/${entry.repo}`,
        }
      }
    }
  }

  return null
}

async function findSkillDirIn(dir: string, slug: string): Promise<string | null> {
  if (!existsSync(dir)) return null

  let items
  try {
    items = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }

  for (const item of items) {
    if (!item.isDirectory() || item.name.startsWith('.')) continue
    const fullPath = join(dir, item.name)
    if (item.name === slug && existsSync(join(fullPath, 'SKILL.md'))) return fullPath

    const nested = await findSkillDirIn(fullPath, slug)
    if (nested) return nested
  }

  return null
}
