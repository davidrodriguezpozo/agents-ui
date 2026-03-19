export default defineEventHandler(async () => {
  const knownMarketplaces = await readKnownMarketplaces()
  const installedNames = await getInstalledPluginNames()

  const marketplaces: Record<string, { plugins: any[] }> = {}

  for (const [name, marketplace] of Object.entries(knownMarketplaces)) {
    const plugins = await scanMarketplacePlugins(marketplace.installLocation)

    marketplaces[name] = {
      plugins: plugins.map(p => ({
        ...p,
        installed: installedNames.has(p.name),
        marketplace: name,
      })),
    }
  }

  return { marketplaces }
})
