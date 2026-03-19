export default defineEventHandler(async (event) => {
  const { owner, repo } = await readBody<{ owner: string; repo: string }>(event)

  const registry = await readImportsRegistry()
  const entry = findImport(registry, owner, repo)

  if (!entry) {
    throw createError({ statusCode: 404, message: 'Import not found' })
  }

  const oldSha = entry.currentSha
  await gitPull(entry.localPath)
  const newSha = await gitGetHead(entry.localPath)
  const changedFiles = oldSha ? await gitDiffFiles(entry.localPath, oldSha) : []

  entry.currentSha = newSha
  entry.remoteSha = newSha
  entry.lastChecked = new Date().toISOString()

  await writeImportsRegistry(registry)

  return { entry, changedFiles }
})
