import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { getRequestScope, resolveForRequest } from '../utils/scope'

export default defineEventHandler(async (event) => {
  const scope = getRequestScope(event)
  const filePath = resolveForRequest(event, 'settings.json')

  if (!existsSync(filePath)) return { __scope: scope, __filePath: filePath }

  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf-8'))
    return { ...parsed, __scope: scope, __filePath: filePath }
  } catch {
    throw createError({
      statusCode: 500,
      message: `Failed to read ${filePath} — file may be malformed`,
    })
  }
})
