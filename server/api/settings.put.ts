import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getRequestScope, resolveForRequest } from '../utils/scope'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, message: 'Request body must be a JSON object' })
  }

  const scope = getRequestScope(event)
  const filePath = resolveForRequest(event, 'settings.json')

  // Strip the metadata keys the GET handler adds.
  const { __scope, __filePath, ...settings } = body as Record<string, unknown>

  try {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8')
  } catch {
    throw createError({ statusCode: 500, message: `Failed to write ${filePath}` })
  }

  return { ...settings, __scope: scope, __filePath: filePath }
})
