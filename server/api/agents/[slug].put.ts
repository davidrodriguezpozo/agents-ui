import { writeFile, rename, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolveClaudePath } from '../../utils/claudeDir'
import { serializeFrontmatter } from '../../utils/frontmatter'
import type { AgentPayload } from '~/types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const filePath = resolveClaudePath('agents', `${slug}.md`)

  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, message: `Agent not found: ${slug}` })
  }

  const payload = await readBody<AgentPayload>(event)
  const newSlug = payload.frontmatter.name
  const newFilePath = resolveClaudePath('agents', `${newSlug}.md`)

  const content = serializeFrontmatter(payload.frontmatter, payload.body)
  await writeFile(newFilePath, content, 'utf-8')

  // Handle rename
  if (slug !== newSlug) {
    if (filePath !== newFilePath) {
      const { unlink } = await import('node:fs/promises')
      await unlink(filePath)
    }
    // Rename memory directory if it exists
    const oldMemDir = resolveClaudePath('agent-memory', slug)
    const newMemDir = resolveClaudePath('agent-memory', newSlug)
    if (existsSync(oldMemDir) && !existsSync(newMemDir)) {
      await rename(oldMemDir, newMemDir)
    }
  }

  // Create or clean up memory directory
  const memoryDir = resolveClaudePath('agent-memory', newSlug)
  if (payload.frontmatter.memory && payload.frontmatter.memory !== 'none') {
    if (!existsSync(memoryDir)) {
      await mkdir(memoryDir, { recursive: true })
    }
  } else {
    // Remove memory directory when memory is set to 'none' or unset
    if (existsSync(memoryDir)) {
      const { rm } = await import('node:fs/promises')
      await rm(memoryDir, { recursive: true })
    }
  }

  return {
    slug: newSlug,
    filename: `${newSlug}.md`,
    frontmatter: payload.frontmatter,
    body: payload.body,
    hasMemory: existsSync(resolveClaudePath('agent-memory', newSlug)),
    filePath: newFilePath,
  }
})
