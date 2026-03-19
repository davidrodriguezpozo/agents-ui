import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveClaudePath } from './claudeDir'

interface KnownMarketplace {
  source: { source: string; url?: string; repo?: string; path?: string }
  installLocation: string
  lastUpdated: string
  autoUpdate?: boolean
}

interface PluginJson {
  name: string
  description?: string
  author?: { name: string; email?: string }
}

interface ScannedPlugin {
  name: string
  description: string
  author?: { name: string; email?: string }
  skillCount: number
  commandCount: number
}

export async function readKnownMarketplaces(): Promise<Record<string, KnownMarketplace>> {
  const path = resolveClaudePath('plugins', 'known_marketplaces.json')
  if (!existsSync(path)) return {}
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as Record<string, KnownMarketplace>
  } catch {
    return {}
  }
}

export async function scanMarketplacePlugins(installLocation: string): Promise<ScannedPlugin[]> {
  const pluginsDir = join(installLocation, 'plugins')
  if (!existsSync(pluginsDir)) return []

  const plugins: ScannedPlugin[] = []
  const entries = await readdir(pluginsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const pluginDir = join(pluginsDir, entry.name)
    const pluginJsonPath = join(pluginDir, '.claude-plugin', 'plugin.json')

    if (!existsSync(pluginJsonPath)) continue

    try {
      const raw = await readFile(pluginJsonPath, 'utf-8')
      const pluginJson = JSON.parse(raw) as PluginJson

      // Count skills
      let skillCount = 0
      const skillsDir = join(pluginDir, 'skills')
      if (existsSync(skillsDir)) {
        const skillEntries = await readdir(skillsDir, { withFileTypes: true })
        skillCount = skillEntries.filter(e => e.isDirectory()).length
      }

      // Count commands
      let commandCount = 0
      const commandsDir = join(pluginDir, 'commands')
      if (existsSync(commandsDir)) {
        const cmdEntries = await readdir(commandsDir, { withFileTypes: true })
        commandCount = cmdEntries.filter(e => e.isDirectory()).length
      }

      plugins.push({
        name: pluginJson.name || entry.name,
        description: pluginJson.description || '',
        author: pluginJson.author,
        skillCount,
        commandCount,
      })
    } catch {
      // Skip malformed plugins
    }
  }

  return plugins
}

export async function getInstalledPluginNames(): Promise<Set<string>> {
  const path = resolveClaudePath('plugins', 'installed_plugins.json')
  if (!existsSync(path)) return new Set()
  try {
    const raw = await readFile(path, 'utf-8')
    const data = JSON.parse(raw) as { plugins: Record<string, unknown[]> }
    const names = new Set<string>()
    for (const id of Object.keys(data.plugins || {})) {
      const [name] = id.split('@')
      names.add(name)
    }
    return names
  } catch {
    return new Set()
  }
}

export function getMarketplaceSourceInfo(marketplace: KnownMarketplace): { sourceType: string; sourceUrl: string } {
  const src = marketplace.source
  if (src.source === 'github') return { sourceType: 'github', sourceUrl: src.repo || '' }
  if (src.source === 'git') return { sourceType: 'git', sourceUrl: src.url || '' }
  if (src.source === 'directory') return { sourceType: 'directory', sourceUrl: src.path || '' }
  return { sourceType: src.source, sourceUrl: '' }
}
