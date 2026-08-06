import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { findScopeContaining } from '../../../utils/scope'
import { startWorkflowRun } from '../../../utils/workflowRunner'
import { readProjectState } from '../../../utils/projects'
import type { Workflow } from '~/types'

/**
 * Run a workflow.
 *
 * Returns as soon as the record exists rather than when the work is done: a
 * workflow is minutes of agents, and a request held open for it is a request
 * that dies with the tab — which is the whole thing this replaced.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const body = await readBody<{ input?: string; projectDir?: string }>(event)

  const input = body?.input?.trim()
  if (!input) {
    throw createError({ statusCode: 400, data: { error: 'no_input', message: 'Say what it should work on.' } })
  }

  const root = findScopeContaining(event, 'workflows', `${slug}.json`)
  if (!root) throw createError({ statusCode: 404, message: 'Workflow not found' })

  const filePath = join(root.dir, 'workflows', `${slug}.json`)
  const workflow = {
    slug,
    filePath,
    scope: root.scope,
    ...JSON.parse(await readFile(filePath, 'utf-8')),
  } as Workflow

  const projectDir = body?.projectDir || (await readProjectState()).activePath || undefined

  return { run: await startWorkflowRun(workflow, input, projectDir) }
})
