import { unlink } from 'node:fs/promises'
import { resolveCommand } from '../../utils/commandPath'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const resolved = resolveCommand(event, slug)
  if (!resolved) {
    throw createError({ statusCode: 404, message: `Command not found: ${slug}` })
  }

  try {
    await unlink(resolved.filePath)
  } catch {
    throw createError({ statusCode: 500, message: `Failed to delete command: ${slug}` })
  }

  return { deleted: true, slug, scope: resolved.root.scope }
})
