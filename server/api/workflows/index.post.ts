import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getRequestScope, resolveForRequest } from '../../utils/scope'
import type { WorkflowPayload, Workflow } from '~/types'

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<WorkflowPayload>(event)
  if (!body.name?.trim()) {
    throw createError({ statusCode: 400, message: 'name is required' })
  }

  const scope = getRequestScope(event)
  const dir = resolveForRequest(event, 'workflows')
  await mkdir(dir, { recursive: true })

  let slug = slugify(body.name)
  let filePath = join(dir, `${slug}.json`)
  let counter = 2
  while (existsSync(filePath)) {
    slug = `${slugify(body.name)}-${counter}`
    filePath = join(dir, `${slug}.json`)
    counter++
  }

  const workflow: Omit<Workflow, 'slug' | 'filePath' | 'scope'> = {
    name: body.name.trim(),
    description: body.description || '',
    steps: body.steps || [],
    createdAt: new Date().toISOString(),
  }

  await writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf-8')
  return { slug, filePath, scope, ...workflow } as Workflow
})
