import type { AvailablePlugin, MarketplaceSource, MarketplaceData } from '~/types'

export function useMarketplace() {
  const marketplaceData = useState<Record<string, { plugins: AvailablePlugin[] }>>('marketplaceData', () => ({}))
  const sources = useState<MarketplaceSource[]>('marketplaceSources', () => [])
  const loading = useState('marketplaceLoading', () => false)
  const sourcesLoading = useState('marketplaceSourcesLoading', () => false)

  async function fetchAvailable() {
    loading.value = true
    try {
      const data = await $fetch<MarketplaceData>('/api/marketplace/available')
      marketplaceData.value = data.marketplaces
    } catch (e) {
      console.error('Failed to fetch marketplace data:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchSources() {
    sourcesLoading.value = true
    try {
      const data = await $fetch<{ sources: MarketplaceSource[] }>('/api/marketplace/sources')
      sources.value = data.sources
    } catch (e) {
      console.error('Failed to fetch marketplace sources:', e)
    } finally {
      sourcesLoading.value = false
    }
  }

  async function installPlugin(marketplace: string, plugin: string): Promise<string> {
    const data = await $fetch<{ success: boolean; output: string }>('/api/marketplace/install', {
      method: 'POST',
      body: { marketplace, plugin },
    })
    return data.output
  }

  async function uninstallPlugin(plugin: string): Promise<string> {
    const data = await $fetch<{ success: boolean; output: string }>('/api/marketplace/uninstall', {
      method: 'POST',
      body: { plugin },
    })
    return data.output
  }

  async function addSource(url: string): Promise<string> {
    const data = await $fetch<{ success: boolean; output: string }>('/api/marketplace/sources/add', {
      method: 'POST',
      body: { url },
    })
    return data.output
  }

  async function removeSource(name: string): Promise<string> {
    const data = await $fetch<{ success: boolean; output: string }>('/api/marketplace/sources/remove', {
      method: 'POST',
      body: { name },
    })
    return data.output
  }

  async function updateSource(name: string): Promise<string> {
    const data = await $fetch<{ success: boolean; output: string }>('/api/marketplace/sources/update', {
      method: 'POST',
      body: { name },
    })
    return data.output
  }

  const availablePlugins = computed(() => {
    const all: AvailablePlugin[] = []
    for (const plugins of Object.values(marketplaceData.value)) {
      all.push(...plugins.plugins.filter(p => !p.installed))
    }
    return all
  })

  return {
    marketplaceData,
    sources,
    loading,
    sourcesLoading,
    availablePlugins,
    fetchAvailable,
    fetchSources,
    installPlugin,
    uninstallPlugin,
    addSource,
    removeSource,
    updateSource,
  }
}
