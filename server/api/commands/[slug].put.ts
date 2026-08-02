import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { findScopeContaining } from '../../utils/scope'
import { serializeFrontmatter } from '../../utils/frontmatter'
import { localCommandInvocation } from '../../utils/collect'
import { slugToPath } from '../../utils/commandPath'
import type { CommandPayload } from '~/types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const { directory, filename } = slugToPath(slug)
  const segments = directory ? ['commands', ...directory.split('/'), filename] : ['commands', filename]

  const root = findScopeContaining(event, ...segments)
  if (!root) {
    throw createError({ statusCode: 404, message: `Command not found: ${slug}` })
  }

  const filePath = join(root.dir, ...segments)
  const payload = await readBody<CommandPayload>(event)
  const content = serializeFrontmatter(payload.frontmatter, payload.body)
  await writeFile(filePath, content, 'utf-8')

  return {
    slug,
    filename,
    directory,
    frontmatter: payload.frontmatter,
    body: payload.body,
    filePath,
    scope: root.scope,
    source: 'local' as const,
    invocation: localCommandInvocation(directory, filename.replace(/\.md$/, '')),
    projectDir: root.projectDir,
  }
})
