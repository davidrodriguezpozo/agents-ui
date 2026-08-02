import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { parseFrontmatter } from './frontmatter'
import { getScopeRoots, type Scope, type ScopeRoot } from './scope'
import { readInstalledPlugins, scanPluginComponents } from './pluginScan'

export interface ResolvedAgent {
  slug: string
  name: string
  description: string
  /** The agent's instructions — becomes the system prompt when testing it. */
  prompt: string
  model?: string
  tools?: string[]
  source: 'local' | 'plugin'
  scope?: Scope
  pluginId?: string
  pluginName?: string
  filePath: string
}

function normalizeTools(value: unknown): string[] | undefined {
  if (Array.isArray(value) && value.length) return value.map(String)
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map(t => t.trim()).filter(Boolean)
  }
  return undefined
}

/** Find an agent by slug in user scope, project scope, or any installed plugin. */
export async function resolveAgent(event: H3Event, slug: string): Promise<ResolvedAgent | null> {
  return resolveAgentInRoots(getScopeRoots(event), slug)
}

/** Root-based variant, for callers without an HTTP request (the scheduler). */
export async function resolveAgentInRoots(roots: ScopeRoot[], slug: string): Promise<ResolvedAgent | null> {

  for (const root of roots) {
    const filePath = join(root.dir, 'agents', `${slug}.md`)
    if (!existsSync(filePath)) continue

    const raw = await readFile(filePath, 'utf-8')
    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(raw)

    return {
      slug,
      name: (frontmatter.name as string) || slug,
      description: (frontmatter.description as string) || '',
      prompt: body,
      model: (frontmatter.model as string) || undefined,
      tools: normalizeTools(frontmatter.tools),
      source: 'local',
      scope: root.scope,
      filePath,
    }
  }

  const plugins = await readInstalledPlugins(roots[0]!.dir)
  for (const plugin of plugins) {
    const components = await scanPluginComponents(plugin.entry.installPath, plugin.name)
    const match = components.agents.find(a => a.name === slug)
    if (!match) continue

    return {
      slug,
      name: match.name,
      description: match.description,
      prompt: match.body,
      model: match.model,
      tools: match.tools,
      source: 'plugin',
      pluginId: plugin.id,
      pluginName: plugin.name,
      filePath: match.filePath,
    }
  }

  return null
}

/**
 * Map what we store in frontmatter to what the SDK accepts.
 * `inherit` (and anything empty) means "let the CLI decide".
 */
export function toSdkModel(model?: string): string | undefined {
  if (!model || model === 'inherit') return undefined
  return model
}
