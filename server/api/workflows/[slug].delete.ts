import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { findScopeContaining } from '../../utils/scope'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const root = findScopeContaining(event, 'workflows', `${slug}.json`)

  if (!root) {
    throw createError({ statusCode: 404, message: 'Workflow not found' })
  }

  await unlink(join(root.dir, 'workflows', `${slug}.json`))
  return { deleted: true, scope: root.scope }
})
