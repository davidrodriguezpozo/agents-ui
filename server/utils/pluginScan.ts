import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { parseFrontmatter } from './frontmatter'
import type {
  PluginAgent,
  PluginCommand,
  PluginComponents,
  PluginHookEntry,
  PluginMcpServer,
  PluginScript,
  PluginSkill,
} from '~/types'

/** Directories a plugin may put skills in. `skills/` is the convention; some
 * plugins (e.g. figma) ship extra sets in sibling `*-skills/` directories. */
function isSkillsDir(name: string): boolean {
  return name === 'skills' || name.endsWith('-skills')
}

const MCP_FILENAMES = ['.mcp.json', 'mcp.json']

async function readJson<T>(path: string): Promise<T | null> {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(await readFile(path, 'utf-8')) as T
  } catch {
    return null
  }
}

async function walkMarkdown(dir: string, base = dir): Promise<{ path: string; rel: string }[]> {
  if (!existsSync(dir)) return []

  const found: { path: string; rel: string }[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...await walkMarkdown(full, base))
    } else if (entry.name.endsWith('.md')) {
      found.push({ path: full, rel: relative(base, full) })
    }
  }

  return found
}

/**
 * Command invocation name as Claude Code exposes it.
 *
 * `commands/debug.md`           in plugin `hd` → `/hd:debug`
 * `commands/defender/pickup.md` in plugin `hd` → `/defender:pickup`
 *
 * A command at the root of `commands/` is namespaced under the plugin name;
 * one inside a subdirectory is namespaced under that subdirectory instead.
 */
export function pluginCommandInvocation(pluginName: string, relPath: string): string {
  const segments = relPath.replace(/\.md$/, '').split(sep)
  if (segments.length === 1) return `/${pluginName}:${segments[0]}`
  return `/${segments.join(':')}`
}

async function scanCommands(installPath: string, pluginName: string): Promise<PluginCommand[]> {
  const files = await walkMarkdown(join(installPath, 'commands'))

  const commands = await Promise.all(files.map(async ({ path, rel }) => {
    const raw = await readFile(path, 'utf-8')
    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw)
    const segments = rel.replace(/\.md$/, '').split(sep)
    const name = segments[segments.length - 1]!

    return {
      name,
      invocation: pluginCommandInvocation(pluginName, rel),
      namespace: segments.length > 1 ? segments.slice(0, -1).join(':') : pluginName,
      description: (frontmatter.description as string) || '',
      argumentHint: (frontmatter['argument-hint'] as string) || undefined,
      allowedTools: normalizeTools(frontmatter['allowed-tools']),
      model: (frontmatter.model as string) || undefined,
      body,
      filePath: path,
      relPath: rel,
    } satisfies PluginCommand
  }))

  return commands.sort((a, b) => a.invocation.localeCompare(b.invocation))
}

function normalizeTools(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map(t => t.trim()).filter(Boolean)
  }
  return undefined
}

async function scanAgents(installPath: string): Promise<PluginAgent[]> {
  const files = await walkMarkdown(join(installPath, 'agents'))

  const agents = await Promise.all(files.map(async ({ path, rel }) => {
    const raw = await readFile(path, 'utf-8')
    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw)
    const fallback = rel.replace(/\.md$/, '').split(sep).pop()!

    return {
      name: (frontmatter.name as string) || fallback,
      description: (frontmatter.description as string) || '',
      model: (frontmatter.model as string) || undefined,
      tools: normalizeTools(frontmatter.tools),
      color: (frontmatter.color as string) || undefined,
      body,
      filePath: path,
      relPath: rel,
    } satisfies PluginAgent
  }))

  return agents.sort((a, b) => a.name.localeCompare(b.name))
}

async function scanSkills(installPath: string): Promise<PluginSkill[]> {
  let topLevel
  try {
    topLevel = await readdir(installPath, { withFileTypes: true })
  } catch {
    return []
  }

  const skills: PluginSkill[] = []

  for (const entry of topLevel) {
    if (!entry.isDirectory() || !isSkillsDir(entry.name)) continue
    await collectSkills(join(installPath, entry.name), entry.name, skills)
  }

  return skills.sort((a, b) => a.slug.localeCompare(b.slug))
}

async function collectSkills(dir: string, group: string, out: PluginSkill[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue

    const skillDir = join(dir, entry.name)
    const skillPath = join(skillDir, 'SKILL.md')

    if (existsSync(skillPath)) {
      const raw = await readFile(skillPath, 'utf-8')
      const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw)
      out.push({
        slug: entry.name,
        group,
        frontmatter: { name: entry.name, ...frontmatter } as PluginSkill['frontmatter'],
        body,
        filePath: skillPath,
      })
    } else {
      // Nested grouping directory — keep looking one level down.
      await collectSkills(skillDir, group, out)
    }
  }
}

async function scanHooks(installPath: string): Promise<PluginHookEntry[]> {
  const hooksDir = join(installPath, 'hooks')
  if (!existsSync(hooksDir)) return []

  const config = await readJson<{ hooks?: Record<string, unknown[]> }>(join(hooksDir, 'hooks.json'))
  const entries: PluginHookEntry[] = []

  for (const [eventName, matchers] of Object.entries(config?.hooks ?? {})) {
    for (const matcher of matchers as Record<string, unknown>[]) {
      const commands = ((matcher?.hooks as Record<string, unknown>[]) ?? [])
        .map(h => String(h?.command ?? ''))
        .filter(Boolean)

      entries.push({
        event: eventName,
        matcher: (matcher?.matcher as string) || undefined,
        commands,
      })
    }
  }

  return entries
}

async function scanMcpServers(installPath: string): Promise<PluginMcpServer[]> {
  for (const filename of MCP_FILENAMES) {
    const config = await readJson<{ mcpServers?: Record<string, Record<string, unknown>> }>(
      join(installPath, filename)
    )
    if (!config?.mcpServers) continue

    return Object.entries(config.mcpServers).map(([name, server]) => ({
      name,
      transport: (server.type as string) || (server.url ? 'http' : 'stdio'),
      target: (server.url as string) || (server.command as string) || '',
      configPath: join(installPath, filename),
    }))
  }

  return []
}

async function scanScripts(installPath: string): Promise<PluginScript[]> {
  const scriptsDir = join(installPath, 'scripts')
  if (!existsSync(scriptsDir)) return []

  const collect = async (dir: string): Promise<PluginScript[]> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }

    const found: PluginScript[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '_test') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        found.push(...await collect(full))
      } else {
        found.push({ name: relative(scriptsDir, full), filePath: full })
      }
    }
    return found
  }

  const scripts = await collect(scriptsDir)
  return scripts.sort((a, b) => a.name.localeCompare(b.name))
}

async function findReadme(installPath: string): Promise<string | null> {
  for (const name of ['README.md', 'readme.md', 'Readme.md']) {
    const path = join(installPath, name)
    if (existsSync(path)) return path
  }
  return null
}

/**
 * Everything a plugin contributes: commands, subagents, skills, hooks, MCP
 * servers and scripts. Plugins are more than their skills — the UI used to
 * show only `skills/`, which hid most of a plugin's surface area.
 */
export async function scanPluginComponents(
  installPath: string,
  pluginName: string,
): Promise<PluginComponents> {
  if (!existsSync(installPath)) {
    return { commands: [], agents: [], skills: [], hooks: [], mcpServers: [], scripts: [], readmePath: null }
  }

  const [commands, agents, skills, hooks, mcpServers, scripts, readmePath] = await Promise.all([
    scanCommands(installPath, pluginName),
    scanAgents(installPath),
    scanSkills(installPath),
    scanHooks(installPath),
    scanMcpServers(installPath),
    scanScripts(installPath),
    findReadme(installPath),
  ])

  return { commands, agents, skills, hooks, mcpServers, scripts, readmePath }
}

export interface InstalledPluginEntry {
  scope?: string
  installPath: string
  version?: string
  installedAt?: string
  lastUpdated?: string
  gitCommitSha?: string
}

export interface InstalledPluginRecord {
  id: string
  name: string
  marketplace: string
  entry: InstalledPluginEntry
  meta: { name?: string; description?: string; version?: string; author?: { name: string; email?: string } } | null
}

/** Read `installed_plugins.json` and resolve each plugin's metadata. */
export async function readInstalledPlugins(claudeDir: string): Promise<InstalledPluginRecord[]> {
  const installed = await readJson<{ plugins: Record<string, InstalledPluginEntry[]> }>(
    join(claudeDir, 'plugins', 'installed_plugins.json')
  )
  if (!installed?.plugins) return []

  const records = await Promise.all(
    Object.entries(installed.plugins).map(async ([id, entries]) => {
      const entry = entries?.[0]
      if (!entry?.installPath) return null

      const [name, marketplace] = id.split('@')
      const meta = await readJson<InstalledPluginRecord['meta']>(
        join(entry.installPath, '.claude-plugin', 'plugin.json')
      )

      return {
        id,
        name: meta?.name || name || id,
        marketplace: marketplace || 'unknown',
        entry,
        meta,
      } satisfies InstalledPluginRecord
    })
  )

  return records.filter((r): r is InstalledPluginRecord => r !== null)
}
