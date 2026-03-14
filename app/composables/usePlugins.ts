import type { Plugin, PluginDetail, SkillFrontmatter } from '~/types'

export function usePlugins() {
  const plugins = useState<Plugin[]>('plugins', () => [])
  const loading = useState('pluginsLoading', () => false)

  async function fetchAll() {
    loading.value = true
    try {
      plugins.value = await $fetch<Plugin[]>('/api/plugins')
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id: string) {
    return await $fetch<PluginDetail>(`/api/plugins/${encodeURIComponent(id)}`)
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    const { save } = useSettings()
    const { settings } = useSettings()
    if (!settings.value) return

    const updated = {
      ...settings.value,
      enabledPlugins: {
        ...(settings.value.enabledPlugins as Record<string, boolean>),
        [id]: enabled,
      },
    }
    await save(updated)

    // Update local plugin state
    const idx = plugins.value.findIndex(p => p.id === id)
    if (idx >= 0) plugins.value[idx] = { ...plugins.value[idx], enabled }
  }

  async function uninstall(id: string) {
    await $fetch(`/api/plugins/${encodeURIComponent(id)}`, { method: 'DELETE' })
    plugins.value = plugins.value.filter(p => p.id !== id)
  }

  async function updateSkill(pluginId: string, skill: string, frontmatter: SkillFrontmatter, body: string) {
    return await $fetch('/api/plugins/skills/update', {
      method: 'PUT',
      body: { pluginId, skill, frontmatter, body },
    })
  }

  return { plugins, loading, fetchAll, fetchOne, toggleEnabled, uninstall, updateSkill }
}
