import { readFile, stat } from 'node:fs/promises'
import { parseFrontmatter } from '../../utils/frontmatter'
import { collectCommands, localCommandInvocation } from '../../utils/collect'
import { resolveCommand } from '../../utils/commandPath'
import type { CommandFrontmatter } from '~/types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const resolved = resolveCommand(event, slug)

  // Not on disk under a scope — it may be a plugin command, which is read-only
  // but still worth showing rather than 404ing.
  if (!resolved) {
    const fromPlugin = (await collectCommands(event)).find(c => c.slug === slug)
    if (fromPlugin) return { ...fromPlugin, lastModified: null }

    throw createError({ statusCode: 404, message: `Command not found: ${slug}` })
  }

  const { root, directory, filename, filePath } = resolved
  const [raw, fileStat] = await Promise.all([readFile(filePath, 'utf-8'), stat(filePath)])
  const { frontmatter, body } = parseFrontmatter<CommandFrontmatter>(raw)

  return {
    slug,
    filename,
    directory,
    frontmatter: { name: slug, ...frontmatter },
    body,
    filePath,
    scope: root.scope,
    source: 'local' as const,
    invocation: localCommandInvocation(directory, filename.replace(/\.md$/, '')),
    projectDir: root.projectDir,
    readOnly: false,
    lastModified: fileStat.mtimeMs,
  }
})
