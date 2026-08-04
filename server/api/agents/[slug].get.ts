import { readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findScopeContaining } from '../../utils/scope'
import { parseFrontmatter } from '../../utils/frontmatter'
import { collectAgents } from '../../utils/collect'
import type { AgentFrontmatter } from '~/types'

function normalizeTools(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map(t => t.trim()).filter(Boolean)
  }
  return undefined
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const root = findScopeContaining(event, 'agents', `${slug}.md`)

  // Not on disk under a scope — it may be a plugin subagent, which is read-only
  // but still worth showing rather than 404ing.
  if (!root) {
    const fromPlugin = (await collectAgents(event)).find(a => a.slug === slug && a.source === 'plugin')
    if (fromPlugin) return { ...fromPlugin, lastModified: null }

    throw createError({ statusCode: 404, message: `Agent not found: ${slug}` })
  }

  const filePath = join(root.dir, 'agents', `${slug}.md`)
  const [raw, fileStat] = await Promise.all([
    readFile(filePath, 'utf-8'),
    stat(filePath),
  ])
  const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(raw)

  return {
    slug,
    filename: `${slug}.md`,
    frontmatter: { ...frontmatter, name: frontmatter.name ?? slug, tools: normalizeTools(frontmatter.tools) },
    body,
    hasMemory: existsSync(join(root.dir, 'agent-memory', slug)),
    filePath,
    scope: root.scope,
    source: 'local' as const,
    projectDir: root.projectDir,
    readOnly: false,
    lastModified: fileStat.mtimeMs,
  }
})
