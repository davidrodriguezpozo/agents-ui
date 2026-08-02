import { getScopeRoots } from '../../utils/scope'
import { readInstalledPlugins, scanPluginComponents } from '../../utils/pluginScan'
import { resolveEnabledPlugins } from '../../utils/pluginState'
import type { Plugin } from '~/types'

export default defineEventHandler(async (event) => {
  const roots = getScopeRoots(event)
  const [records, isEnabled] = await Promise.all([
    readInstalledPlugins(roots[0]!.dir),
    resolveEnabledPlugins(event),
  ])

  const plugins: Plugin[] = await Promise.all(records.map(async (record) => {
    const components = await scanPluginComponents(record.entry.installPath, record.name)

    return {
      id: record.id,
      name: record.name,
      marketplace: record.marketplace,
      description: record.meta?.description ?? '',
      version: record.entry.version ?? 'unknown',
      enabled: isEnabled(record.id),
      installedAt: record.entry.installedAt ?? '',
      lastUpdated: record.entry.lastUpdated ?? '',
      installPath: record.entry.installPath,
      skills: components.skills.map(s => s.slug),
      author: record.meta?.author,
      counts: {
        commands: components.commands.length,
        agents: components.agents.length,
        skills: components.skills.length,
        hooks: components.hooks.length,
        mcpServers: components.mcpServers.length,
        scripts: components.scripts.length,
      },
    } satisfies Plugin
  }))

  return plugins.sort((a, b) => a.name.localeCompare(b.name))
})
