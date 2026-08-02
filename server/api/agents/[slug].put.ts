import { writeFile, rename, mkdir, rm, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findScopeContaining } from '../../utils/scope'
import { serializeFrontmatter } from '../../utils/frontmatter'
import type { AgentPayload } from '~/types'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const root = findScopeContaining(event, 'agents', `${slug}.md`)

  if (!root) {
    throw createError({ statusCode: 404, message: `Agent not found: ${slug}` })
  }

  const filePath = join(root.dir, 'agents', `${slug}.md`)
  const payload = await readBody<AgentPayload & { lastModified?: number }>(event)

  // File conflict detection
  if (payload.lastModified) {
    const fileStat = await stat(filePath)
    if (Math.abs(fileStat.mtimeMs - payload.lastModified) > 1000) {
      throw createError({ statusCode: 409, message: 'This file was modified externally. Reload to see the latest version.' })
    }
  }

  const newSlug = payload.frontmatter.name
  const newFilePath = join(root.dir, 'agents', `${newSlug}.md`)

  const content = serializeFrontmatter(payload.frontmatter, payload.body)
  await writeFile(newFilePath, content, 'utf-8')

  // Handle rename
  if (slug !== newSlug) {
    if (filePath !== newFilePath) {
      await unlink(filePath)
    }
    const oldMemDir = join(root.dir, 'agent-memory', slug)
    const newMemDir = join(root.dir, 'agent-memory', newSlug)
    if (existsSync(oldMemDir) && !existsSync(newMemDir)) {
      await rename(oldMemDir, newMemDir)
    }
  }

  // Create or clean up memory directory
  const memoryDir = join(root.dir, 'agent-memory', newSlug)
  if (payload.frontmatter.memory && payload.frontmatter.memory !== 'none') {
    if (!existsSync(memoryDir)) {
      await mkdir(memoryDir, { recursive: true })
    }
  } else if (existsSync(memoryDir)) {
    await rm(memoryDir, { recursive: true })
  }

  const newStat = await stat(newFilePath)

  return {
    slug: newSlug,
    filename: `${newSlug}.md`,
    frontmatter: payload.frontmatter,
    body: payload.body,
    hasMemory: existsSync(memoryDir),
    filePath: newFilePath,
    scope: root.scope,
    source: 'local' as const,
    projectDir: root.projectDir,
    lastModified: newStat.mtimeMs,
  }
})
