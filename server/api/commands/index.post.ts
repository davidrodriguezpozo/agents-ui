import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getRequestScope, resolveForRequest } from '../../utils/scope'
import { serializeFrontmatter } from '../../utils/frontmatter'
import { localCommandInvocation } from '../../utils/collect'
import type { CommandPayload } from '~/types'

export default defineEventHandler(async (event) => {
  const payload = await readBody<CommandPayload>(event)
  const scope = getRequestScope(event)
  const name = payload.frontmatter.name
  const directory = payload.directory || ''

  // Derive filename from the command name
  const nameParts = name.split(':')
  const fileBaseName = nameParts.length > 1 ? nameParts.slice(1).join('-') : name
  const filename = `${fileBaseName}.md`

  const dir = directory
    ? resolveForRequest(event, 'commands', ...directory.split('/'))
    : resolveForRequest(event, 'commands')

  await mkdir(dir, { recursive: true })

  const filePath = join(dir, filename)
  if (existsSync(filePath)) {
    throw createError({ statusCode: 409, message: `Command already exists: ${name}` })
  }

  const content = serializeFrontmatter(payload.frontmatter, payload.body)
  await writeFile(filePath, content, 'utf-8')

  const slug = directory
    ? `${directory.replace(/\//g, '--')}--${fileBaseName}`
    : fileBaseName

  return {
    slug,
    filename,
    directory,
    frontmatter: payload.frontmatter,
    body: payload.body,
    filePath,
    scope,
    source: 'local' as const,
    invocation: localCommandInvocation(directory, fileBaseName),
  }
})
