export default defineEventHandler(async (event) => {
  const { owner, repo } = await readBody<{ owner: string; repo: string }>(event)

  const registry = await readImportsRegistry()
  const entry = findImport(registry, owner, repo)

  if (!entry) {
    throw createError({ statusCode: 404, message: 'Import not found' })
  }

  await removeClone(entry.localPath)
  registry.imports = registry.imports.filter(i => !(i.owner === owner && i.repo === repo))
  await writeImportsRegistry(registry)

  return { success: true }
})
