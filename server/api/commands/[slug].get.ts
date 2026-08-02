import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { findScopeContaining } from '../../utils/scope'
import { parseFrontmatter } from '../../utils/frontmatter'
import { collectCommands, localCommandInvocation } from '../../utils/collect'
import { slugToPath } from '../../utils/commandPath'
import type { CommandFrontmatter } from '~/types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const { directory, filename } = slugToPath(slug)
  const segments = directory ? ['commands', ...directory.split('/'), filename] : ['commands', filename]

  const root = findScopeContaining(event, ...segments)

  // Not on disk under a scope — it may be a plugin command, which is read-only
  // but still worth showing rather than 404ing.
  if (!root) {
    const fromPlugin = (await collectCommands(event)).find(c => c.slug === slug)
    if (fromPlugin) return { ...fromPlugin, lastModified: null }

    throw createError({ statusCode: 404, message: `Command not found: ${slug}` })
  }

  const filePath = join(root.dir, ...segments)
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
