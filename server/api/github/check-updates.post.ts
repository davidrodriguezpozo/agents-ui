export default defineEventHandler(async () => {
  const registry = await readImportsRegistry()
  const now = new Date().toISOString()

  await Promise.allSettled(
    registry.imports.map(async (entry) => {
      const remoteSha = await gitLsRemote(`https://github.com/${entry.owner}/${entry.repo}.git`)
      entry.lastChecked = now
      if (remoteSha) entry.remoteSha = remoteSha
    })
  )

  await writeImportsRegistry(registry)

  return {
    imports: registry.imports,
    updatesAvailable: registry.imports.filter(i => i.currentSha !== i.remoteSha).length,
  }
})
