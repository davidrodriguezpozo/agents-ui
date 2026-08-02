import { getScopeRoots } from '../../utils/scope'
import { readInstalledPlugins, scanPluginComponents } from '../../utils/pluginScan'
import { resolveEnabledPlugins } from '../../utils/pluginState'
import type { PluginDetail } from '~/types'

export default defineEventHandler(async (event) => {
  const id = decodeURIComponent(getRouterParam(event, 'id')!)
  const roots = getScopeRoots(event)

  const records = await readInstalledPlugins(roots[0]!.dir)
  const record = records.find(r => r.id === id)
  if (!record) {
    throw createError({ statusCode: 404, message: `Plugin not found: ${id}` })
  }

  const [components, isEnabled] = await Promise.all([
    scanPluginComponents(record.entry.installPath, record.name),
    resolveEnabledPlugins(event),
  ])

  return {
    id,
    name: record.name,
    marketplace: record.marketplace,
    description: record.meta?.description ?? '',
    version: record.entry.version ?? 'unknown',
    enabled: isEnabled(id),
    installedAt: record.entry.installedAt ?? '',
    lastUpdated: record.entry.lastUpdated ?? '',
    installPath: record.entry.installPath,
    author: record.meta?.author,
    counts: {
      commands: components.commands.length,
      agents: components.agents.length,
      skills: components.skills.length,
      hooks: components.hooks.length,
      mcpServers: components.mcpServers.length,
      scripts: components.scripts.length,
    },
    ...components,
    // The skill editor still expects the standalone `Skill` shape.
    skillDetails: components.skills.map(skill => ({
      slug: skill.slug,
      frontmatter: skill.frontmatter,
      body: skill.body,
      filePath: skill.filePath,
      source: 'plugin' as const,
      pluginId: id,
      pluginName: record.name,
    })),
  } satisfies PluginDetail
})
