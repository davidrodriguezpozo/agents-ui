import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { findScopeContaining } from '../../utils/scope'
import { slugToPath } from '../../utils/commandPath'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const { directory, filename } = slugToPath(slug)
  const segments = directory ? ['commands', ...directory.split('/'), filename] : ['commands', filename]

  const root = findScopeContaining(event, ...segments)
  if (!root) {
    throw createError({ statusCode: 404, message: `Command not found: ${slug}` })
  }

  try {
    await unlink(join(root.dir, ...segments))
  } catch {
    throw createError({ statusCode: 500, message: `Failed to delete command: ${slug}` })
  }

  return { deleted: true, slug, scope: root.scope }
})
