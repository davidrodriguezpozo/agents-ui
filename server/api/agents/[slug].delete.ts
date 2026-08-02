import { rm, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findScopeContaining } from '../../utils/scope'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const root = findScopeContaining(event, 'agents', `${slug}.md`)

  if (!root) {
    throw createError({ statusCode: 404, message: `Agent not found: ${slug}` })
  }

  try {
    await unlink(join(root.dir, 'agents', `${slug}.md`))
  } catch {
    throw createError({ statusCode: 500, message: `Failed to delete agent: ${slug}` })
  }

  const memoryDir = join(root.dir, 'agent-memory', slug)
  if (existsSync(memoryDir)) {
    await rm(memoryDir, { recursive: true, force: true })
  }

  return { deleted: true, slug, scope: root.scope }
})
