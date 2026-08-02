import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getRequestScope, resolveForRequest } from '../../utils/scope'
import { serializeFrontmatter } from '../../utils/frontmatter'
import type { AgentPayload } from '~/types'

export default defineEventHandler(async (event) => {
  const payload = await readBody<AgentPayload>(event)
  const scope = getRequestScope(event)
  const slug = payload.frontmatter.name
  const agentsDir = resolveForRequest(event, 'agents')
  const filePath = join(agentsDir, `${slug}.md`)

  if (existsSync(filePath)) {
    throw createError({ statusCode: 409, message: `Agent already exists: ${slug}` })
  }

  await mkdir(agentsDir, { recursive: true })

  const content = serializeFrontmatter(payload.frontmatter, payload.body)
  await writeFile(filePath, content, 'utf-8')

  const hasMemory = Boolean(payload.frontmatter.memory && payload.frontmatter.memory !== 'none')
  if (hasMemory) {
    await mkdir(resolveForRequest(event, 'agent-memory', slug), { recursive: true })
  }

  return {
    slug,
    filename: `${slug}.md`,
    frontmatter: payload.frontmatter,
    body: payload.body,
    hasMemory,
    filePath,
    scope,
    source: 'local' as const,
  }
})
