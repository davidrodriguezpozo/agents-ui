import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { H3Event } from 'h3'
import { parseFrontmatter } from './frontmatter'
import { getScopeRoots, type ScopeRoot } from './scope'
import { readInstalledPlugins, scanPluginComponents } from './pluginScan'
import type { Agent, AgentFrontmatter, Command, CommandFrontmatter } from '~/types'

function normalizeTools(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map(t => t.trim()).filter(Boolean)
  }
  return undefined
}

async function readAgentsIn(root: ScopeRoot): Promise<Agent[]> {
  const agentsDir = join(root.dir, 'agents')
  if (!existsSync(agentsDir)) return []

  const files = (await readdir(agentsDir)).filter(f => f.endsWith('.md'))

  return Promise.all(files.map(async (filename) => {
    const filePath = join(agentsDir, filename)
    const raw = await readFile(filePath, 'utf-8')
    const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(raw)
    const slug = filename.replace(/\.md$/, '')

    return {
      slug,
      filename,
      frontmatter: { name: slug, ...frontmatter, tools: normalizeTools(frontmatter.tools) },
      body,
      hasMemory: existsSync(join(root.dir, 'agent-memory', slug)),
      filePath,
      scope: root.scope,
      source: 'local' as const,
      projectDir: root.projectDir,
    } satisfies Agent
  }))
}

/** Agents from `~/.claude`, the selected project, and every installed plugin. */
export async function collectAgents(event: H3Event): Promise<Agent[]> {
  const roots = getScopeRoots(event)
  const perScope = await Promise.all(roots.map(readAgentsIn))
  const agents = perScope.flat()

  const plugins = await readInstalledPlugins(getScopeRoots(event)[0]!.dir)
  for (const plugin of plugins) {
    const components = await scanPluginComponents(plugin.entry.installPath, plugin.name)
    for (const agent of components.agents) {
      agents.push({
        slug: agent.name,
        filename: agent.relPath,
        frontmatter: {
          name: agent.name,
          description: agent.description,
          model: agent.model as AgentFrontmatter['model'],
          color: agent.color,
          tools: agent.tools,
        },
        body: agent.body,
        hasMemory: false,
        filePath: agent.filePath,
        scope: 'user',
        source: 'plugin',
        pluginId: plugin.id,
        pluginName: plugin.name,
        readOnly: true,
      })
    }
  }

  return agents.sort((a, b) => a.slug.localeCompare(b.slug))
}

/**
 * `commands/foo.md` → `/foo`, `commands/git/sync.md` → `/git:sync`.
 * Matches how Claude Code namespaces user and project commands.
 */
export function localCommandInvocation(directory: string, name: string): string {
  if (!directory) return `/${name}`
  return `/${directory.split('/').join(':')}:${name}`
}

async function scanCommandDir(dir: string, relDir: string, root: ScopeRoot): Promise<Command[]> {
  if (!existsSync(dir)) return []

  const entries = await readdir(dir, { withFileTypes: true })
  const commands: Command[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      commands.push(...await scanCommandDir(fullPath, relDir ? `${relDir}/${entry.name}` : entry.name, root))
      continue
    }
    if (!entry.name.endsWith('.md')) continue

    const raw = await readFile(fullPath, 'utf-8')
    const { frontmatter, body } = parseFrontmatter<CommandFrontmatter>(raw)
    const name = entry.name.replace(/\.md$/, '')
    const slug = relDir ? `${relDir.replace(/\//g, '--')}--${name}` : name

    commands.push({
      slug,
      filename: entry.name,
      directory: relDir,
      frontmatter: { name: slug, ...frontmatter },
      body,
      filePath: fullPath,
      scope: root.scope,
      source: 'local',
      invocation: localCommandInvocation(relDir, name),
      projectDir: root.projectDir,
    })
  }

  return commands
}

/** Commands from `~/.claude`, the selected project, and every installed plugin. */
export async function collectCommands(event: H3Event): Promise<Command[]> {
  const roots = getScopeRoots(event)
  const perScope = await Promise.all(roots.map(root => scanCommandDir(join(root.dir, 'commands'), '', root)))
  const commands = perScope.flat()

  const plugins = await readInstalledPlugins(roots[0]!.dir)
  for (const plugin of plugins) {
    const components = await scanPluginComponents(plugin.entry.installPath, plugin.name)
    for (const command of components.commands) {
      const segments = command.relPath.replace(/\.md$/, '').split(sep)
      const directory = segments.slice(0, -1).join('/')

      commands.push({
        slug: `${plugin.name}--${segments.join('--')}`,
        filename: segments[segments.length - 1] + '.md',
        directory,
        frontmatter: {
          name: command.name,
          description: command.description,
          'argument-hint': command.argumentHint,
          'allowed-tools': command.allowedTools,
          model: command.model,
        },
        body: command.body,
        filePath: command.filePath,
        scope: 'user',
        source: 'plugin',
        invocation: command.invocation,
        pluginId: plugin.id,
        pluginName: plugin.name,
        readOnly: true,
      })
    }
  }

  return commands.sort((a, b) => a.invocation.localeCompare(b.invocation))
}
