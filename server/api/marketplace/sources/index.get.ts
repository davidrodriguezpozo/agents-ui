export default defineEventHandler(async () => {
  const knownMarketplaces = await readKnownMarketplaces()

  const sources = Object.entries(knownMarketplaces).map(([name, marketplace]) => {
    const { sourceType, sourceUrl } = getMarketplaceSourceInfo(marketplace)
    return {
      name,
      sourceType,
      sourceUrl,
      lastUpdated: marketplace.lastUpdated,
    }
  })

  return { sources }
})
