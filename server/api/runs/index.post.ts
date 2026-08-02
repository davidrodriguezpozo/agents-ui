import { resolveRunOptions, type RunRequest } from '../../utils/runOptions'
import { createRun } from '../../utils/runStore'
import { executeRun } from '../../utils/runner'
import type { RunKind } from '../../utils/runStore'

interface StartRunBody extends RunRequest {
  input: string
  kind?: RunKind
  title?: string
  invocation?: string
}

/**
 * Start a run and return immediately. The run keeps going regardless of what
 * the caller does next — attach to `/api/runs/:id/stream` to watch it.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<StartRunBody>(event)

  if (!body?.input?.trim()) {
    throw createError({ statusCode: 400, message: 'input is required' })
  }

  const options = await resolveRunOptions(event, body)

  const run = createRun({
    kind: body.kind ?? 'chat',
    title: body.title?.trim() || deriveTitle(body.input),
    input: body.input.trim(),
    invocation: body.invocation,
    agentSlug: body.agentSlug,
    projectDir: options.cwd,
  })

  // Deliberately not awaited: the response returns while the run continues.
  void executeRun(run, options)

  return { id: run.id, status: run.status, createdAt: run.createdAt }
})

function deriveTitle(input: string): string {
  const flat = input.replace(/\s+/g, ' ').trim()
  return flat.length > 70 ? `${flat.slice(0, 70)}…` : flat
}
