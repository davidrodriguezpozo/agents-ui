import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { rulesFromSuggestions } from './permissionRules'
import {
  ASK_USER_QUESTION,
  parseQuestions,
  withAnswers,
  type QuestionAnswers,
  type QuestionPrompt,
} from './askUserQuestion'

/**
 * A tool call the agent cannot make until someone says yes.
 *
 * Without a `canUseTool` callback the SDK answers the CLI's permission request
 * with an error and the run stalls with no way to unstick it — the prompt has
 * to reach the browser and an answer has to come back.
 */
export interface PermissionRequest {
  id: string
  ownerId: string
  toolName: string
  input: Record<string, unknown>
  toolUseId: string
  /** Why the CLI asked, when it says. */
  decisionReason?: string
  /** Path that triggered the request, for tools that touch the filesystem. */
  blockedPath?: string
  /** True when answering "allow for this session" is meaningful. */
  canRemember: boolean
  /**
   * Rules the CLI proposed for this request, e.g. `Bash(gh:*)`. These are what
   * a ritual can be granted permanently, so they outlive the prompt itself.
   */
  suggestedRules: string[]
  /**
   * Set when this is `AskUserQuestion` — a question rather than a tool call to
   * approve. Everything that renders a prompt branches on this, and everything
   * that routes one deliberately does not: it is the same queue, the same id
   * and the same answer endpoint, because being asked something and being asked
   * for permission block a run in exactly the same way. See `askUserQuestion`.
   */
  questions?: QuestionPrompt[]
  createdAt: number
}

export type PermissionDecision =
  | {
      behavior: 'allow'
      scope?: 'once' | 'session'
      /** Answers to a question prompt. Absent, or empty, is a skip. */
      answers?: QuestionAnswers
    }
  | { behavior: 'deny'; message?: string }

interface Pending {
  request: PermissionRequest
  settle: (decision: PermissionDecision) => void
}

/**
 * Process-global, like the rest of this app's state. Keyed by request id so a
 * single answer endpoint can serve both the chat stream and detached runs.
 */
const pending = new Map<string, Pending>()

/**
 * Nothing waits forever. An unanswered prompt is denied so the run finishes and
 * the UI unblocks, rather than hanging until the server restarts.
 */
export const PERMISSION_TIMEOUT_MS = 10 * 60_000

/**
 * A question waits longer than a permission, because it is worth more.
 *
 * Ten minutes is sized for someone who is at the keyboard and looking at the
 * run. A question is the opposite case: the agent has stopped to ask which of
 * two approaches to take, and the answer is worth walking back to a desk for.
 * Denying it throws away the turn that produced the question, so the deadline
 * is an hour and the CLI, which parks a question indefinitely by default, is
 * happy to wait.
 */
export const QUESTION_TIMEOUT_MS = 60 * 60_000

let seq = 0

/** Owner id for callers without one of their own, e.g. a chat stream. */
export function newPermissionOwnerId(prefix = 'chat'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export interface PermissionBroker {
  canUseTool: CanUseTool
  /** Deny everything still outstanding — for when the run ends or is cancelled. */
  dispose: (message: string) => void
  hasPending: () => boolean
}

export function createPermissionBroker(options: {
  ownerId: string
  onRequest: (request: PermissionRequest) => void
  onSettled?: (request: PermissionRequest, decision: PermissionDecision) => void
  timeoutMs?: number
  questionTimeoutMs?: number
}): PermissionBroker {
  const {
    ownerId,
    onRequest,
    onSettled,
    timeoutMs = PERMISSION_TIMEOUT_MS,
    questionTimeoutMs = QUESTION_TIMEOUT_MS,
  } = options
  const owned = new Set<string>()

  const canUseTool: CanUseTool = (toolName, input, ctx) => {
    const id = `${ownerId}--${seq++}`
    const questions = toolName === ASK_USER_QUESTION ? parseQuestions(input) : []
    const request: PermissionRequest = {
      id,
      ownerId,
      toolName,
      input,
      toolUseId: ctx.toolUseID,
      decisionReason: ctx.decisionReason,
      blockedPath: ctx.blockedPath,
      // Nothing about a question can be remembered. "Always allow
      // AskUserQuestion" would grant the right to be asked, which nobody wants
      // and which the CLI would then stop asking about — so the offer is never
      // made, whatever the CLI suggested alongside it.
      canRemember: questions.length ? false : Boolean(ctx.suggestions?.length),
      suggestedRules: questions.length ? [] : rulesFromSuggestions(ctx.suggestions),
      ...(questions.length ? { questions } : {}),
      createdAt: Date.now(),
    }

    return new Promise<PermissionResult>((resolve) => {
      let settled = false

      const settle = (decision: PermissionDecision) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        pending.delete(id)
        owned.delete(id)
        ctx.signal.removeEventListener('abort', onAbort)
        onSettled?.(request, decision)
        resolve(toResult(decision, input, ctx.suggestions))
      }

      const onAbort = () => settle({
        behavior: 'deny',
        message: 'The run was stopped before this tool was approved.',
      })

      const deadline = questions.length ? questionTimeoutMs : timeoutMs
      const timer = setTimeout(() => settle(questions.length
        ? {
            behavior: 'deny',
            message: `Nobody answered your question within ${
              Math.round(deadline / 60_000)
            } minutes. Say what you needed to know and stop.`,
          }
        : {
            behavior: 'deny',
            message: `Nobody answered the permission prompt for ${toolName} within ${
              Math.round(deadline / 60_000)
            } minutes, so it was denied. Explain what you needed and stop.`,
          }), deadline)
      // A waiting prompt should not keep the process alive on its own.
      ;(timer as { unref?: () => void }).unref?.()

      if (ctx.signal.aborted) {
        onAbort()
        return
      }

      pending.set(id, { request, settle })
      owned.add(id)
      ctx.signal.addEventListener('abort', onAbort, { once: true })

      onRequest(request)
    })
  }

  return {
    canUseTool,
    dispose(message: string) {
      for (const id of [...owned]) {
        pending.get(id)?.settle({ behavior: 'deny', message })
      }
    },
    hasPending: () => owned.size > 0,
  }
}

/**
 * Answer a prompt. Returns false when the id is unknown — already answered,
 * timed out, or from a run that ended.
 */
export function answerPermission(id: string, decision: PermissionDecision): boolean {
  const entry = pending.get(id)
  if (!entry) return false

  // A question is answered once and never remembered: `session` scope hands the
  // CLI's own suggestions back as permission updates, and for a question those
  // would buy the right to ask without being asked, which is not a thing anyone
  // means to grant. Stripped here rather than trusted from a request body.
  const answer: PermissionDecision = entry.request.questions?.length && decision.behavior === 'allow'
    ? { behavior: 'allow', ...(decision.answers ? { answers: decision.answers } : {}) }
    : decision

  entry.settle(answer)
  return true
}

export function listPending(ownerId?: string): PermissionRequest[] {
  return [...pending.values()]
    .map(p => p.request)
    .filter(r => !ownerId || r.ownerId === ownerId)
}

function toResult(
  decision: PermissionDecision,
  input: Record<string, unknown>,
  suggestions?: PermissionUpdate[],
): PermissionResult {
  if (decision.behavior === 'deny') {
    return {
      behavior: 'deny',
      message: decision.message || 'The user denied this tool call.',
    }
  }

  return {
    behavior: 'allow',
    // The CLI validates an allow against a schema that requires this. For
    // anything but a question nothing here rewrites the call, so it goes back
    // exactly as it came in; a question's answers are the one thing that has
    // to travel this way — see `askUserQuestion`.
    updatedInput: decision.answers ? withAnswers(input, decision.answers) : input,
    // "Allow for this run" is exactly what the CLI's own suggestions encode, so
    // handing them straight back stops it asking again for the same thing.
    ...(decision.scope === 'session' && suggestions?.length
      ? { updatedPermissions: suggestions }
      : {}),
  }
}
