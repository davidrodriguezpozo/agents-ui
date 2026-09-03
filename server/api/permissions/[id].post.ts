import { answerPermission, type PermissionDecision } from '../../utils/permissionBroker'
import type { QuestionAnswers } from '../../utils/askUserQuestion'

interface AnswerBody {
  behavior: 'allow' | 'deny'
  /** `session` also stops the CLI asking again for the same thing this run. */
  scope?: 'once' | 'session'
  message?: string
  /**
   * Answers to an `AskUserQuestion` prompt, keyed by the question's own text.
   * A list per question because a question may allow several options, and one
   * shape on the wire is easier to trust than two.
   */
  answers?: QuestionAnswers
}

/**
 * Answer a pending permission prompt — or a question, which arrives through the
 * same queue and is answered through the same id. Shared by the chat panel and
 * detached runs.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<AnswerBody>(event)

  if (body?.behavior !== 'allow' && body?.behavior !== 'deny') {
    throw createError({ statusCode: 400, message: 'behavior must be "allow" or "deny"' })
  }

  const answers = sanitiseAnswers(body.answers)

  const decision: PermissionDecision = body.behavior === 'allow'
    ? {
        behavior: 'allow',
        scope: body.scope === 'session' ? 'session' : 'once',
        ...(answers ? { answers } : {}),
      }
    : { behavior: 'deny', message: body.message }

  // Not an error: the prompt may have timed out or the run may have been
  // stopped while the answer was in flight.
  return { answered: answerPermission(id, decision) }
})

/**
 * Answers go into the tool input the CLI reads, so nothing but strings gets in.
 * Anything else is dropped rather than rejected: an answer to a question that
 * has gone away is dropped downstream anyway, and a person losing a selection
 * to a validation error is worse than the agent hearing one fewer answer.
 */
function sanitiseAnswers(raw: unknown): QuestionAnswers | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined

  const answers: QuestionAnswers = {}
  for (const [question, values] of Object.entries(raw as Record<string, unknown>)) {
    if (!question.trim() || !Array.isArray(values)) continue
    const picked = values.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    if (picked.length) answers[question] = picked
  }

  return Object.keys(answers).length ? answers : undefined
}
