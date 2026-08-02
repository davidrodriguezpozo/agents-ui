import { writeFile } from 'node:fs/promises'
import { serializeFrontmatter } from '../../utils/frontmatter'
import { localCommandInvocation } from '../../utils/collect'
import { resolveCommand } from '../../utils/commandPath'
import type { CommandPayload } from '~/types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const resolved = resolveCommand(event, slug)
  if (!resolved) {
    throw createError({ statusCode: 404, message: `Command not found: ${slug}` })
  }

  const { root, directory, filename, filePath } = resolved
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
