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
  agentCount: number
}

/** Recursively count markdown files, so namespaced commands are included. */
async function countMarkdown(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0

  let count = 0
  const walk = async (current: string) => {
    const entries = await readdir(current, { withFileTypes: true }) as DirEntry[]
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory()) await walk(join(current, entry.name))
      else if (entry.name.endsWith('.md')) count++
    }
  }

  try {
    await walk(dir)
  } catch {
    return count
  }
  return count
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

/** Minimal shape of a `readdir` entry — this project has no @types/node. */
interface DirEntry {
  name: string
  isDirectory(): boolean
}

interface MarketplaceManifest {
  plugins?: { name: string; source?: string }[]
}

/**
 * Every plugin directory a marketplace offers. The manifest is authoritative —
 * it declares each plugin's `source` path (e.g. `./plugins/hd`) — so a repo can
 * lay its plugins out however it likes. Falls back to scanning `plugins/` for
 * marketplaces whose manifest omits the list.
 */
async function pluginDirs(installLocation: string): Promise<{ name: string; dir: string }[]> {
  const manifestPath = join(installLocation, '.claude-plugin', 'marketplace.json')
  const declared: { name: string; dir: string }[] = []

  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as MarketplaceManifest
      for (const entry of manifest.plugins ?? []) {
        const dir = entry.source
          ? join(installLocation, entry.source)
          : join(installLocation, 'plugins', entry.name)
        declared.push({ name: entry.name, dir })
      }
    } catch {
      // Malformed manifest — fall through to the directory scan
    }
  }

  if (declared.length) return declared

  const pluginsDir = join(installLocation, 'plugins')
  if (!existsSync(pluginsDir)) return []
  const entries = await readdir(pluginsDir, { withFileTypes: true })
  return entries
    .filter((e: DirEntry) => e.isDirectory())
    .map((e: DirEntry) => ({ name: e.name, dir: join(pluginsDir, e.name) }))
}

export async function scanMarketplacePlugins(installLocation: string): Promise<ScannedPlugin[]> {
  const plugins: ScannedPlugin[] = []

  for (const entry of await pluginDirs(installLocation)) {
    const pluginDir = entry.dir
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
        skillCount = skillEntries.filter((e: DirEntry) => e.isDirectory()).length
      }

      // Commands are markdown files, and may sit in namespace subdirectories —
      // counting directories under-reports a flat plugin as zero.
      const commandCount = await countMarkdown(join(pluginDir, 'commands'))
      const agentCount = await countMarkdown(join(pluginDir, 'agents'))

      plugins.push({
        name: pluginJson.name || entry.name,
        description: pluginJson.description || '',
        author: pluginJson.author,
        skillCount,
        commandCount,
        agentCount,
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
