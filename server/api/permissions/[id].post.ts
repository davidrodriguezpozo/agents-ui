import { answerPermission, type PermissionDecision } from '../../utils/permissionBroker'

interface AnswerBody {
  behavior: 'allow' | 'deny'
  /** `session` also stops the CLI asking again for the same thing this run. */
  scope?: 'once' | 'session'
  message?: string
}

/**
 * Answer a pending permission prompt. Shared by the chat panel and detached
 * runs — request ids are unique across both.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<AnswerBody>(event)

  if (body?.behavior !== 'allow' && body?.behavior !== 'deny') {
    throw createError({ statusCode: 400, message: 'behavior must be "allow" or "deny"' })
  }

  const decision: PermissionDecision = body.behavior === 'allow'
    ? { behavior: 'allow', scope: body.scope === 'session' ? 'session' : 'once' }
    : { behavior: 'deny', message: body.message }

  // Not an error: the prompt may have timed out or the run may have been
  // stopped while the answer was in flight.
  return { answered: answerPermission(id, decision) }
})
