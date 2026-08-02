import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { findScopeContaining } from '../../utils/scope'
import type { Workflow } from '~/types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const root = findScopeContaining(event, 'workflows', `${slug}.json`)

  if (!root) {
    throw createError({ statusCode: 404, message: 'Workflow not found' })
  }

  const filePath = join(root.dir, 'workflows', `${slug}.json`)
  const data = JSON.parse(await readFile(filePath, 'utf-8'))
  return { slug, filePath, scope: root.scope, ...data } as Workflow
})
