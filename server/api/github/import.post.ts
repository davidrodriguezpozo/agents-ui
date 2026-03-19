export default defineEventHandler(async (event) => {
  const { owner, repo, url, targetPath, selectedSkills } = await readBody<{
    owner: string
    repo: string
    url: string
    targetPath: string
    selectedSkills: string[]
  }>(event)

  if (!owner || !repo || !url) {
    throw createError({ statusCode: 400, message: 'owner, repo, and url are required' })
  }

  const registry = await readImportsRegistry()

  if (findImport(registry, owner, repo)) {
    throw createError({
      statusCode: 409,
      data: { error: 'already_exists', message: 'This repository is already imported' },
    })
  }

  const localPath = resolveClaudePath('github', owner, repo)
  const repoUrl = `https://github.com/${owner}/${repo}.git`

  await gitClone(repoUrl, localPath)

  let sha: string
  try {
    sha = await gitGetHead(localPath)
  } catch {
    sha = ''
  }

  const now = new Date().toISOString()
  const entry = {
    owner,
    repo,
    url,
    targetPath: targetPath || '',
    localPath,
    importedAt: now,
    lastChecked: now,
    currentSha: sha,
    remoteSha: sha,
    selectedSkills: selectedSkills || [],
  }

  registry.imports.push(entry)

  try {
    await writeImportsRegistry(registry)
  } catch {
    await removeClone(localPath)
    throw createError({ statusCode: 500, message: 'Failed to save import registry' })
  }

  return entry
})
