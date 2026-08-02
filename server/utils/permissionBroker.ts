import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'

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
  createdAt: number
}

export type PermissionDecision =
  | { behavior: 'allow'; scope?: 'once' | 'session' }
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
}): PermissionBroker {
  const { ownerId, onRequest, onSettled, timeoutMs = PERMISSION_TIMEOUT_MS } = options
  const owned = new Set<string>()

  const canUseTool: CanUseTool = (toolName, input, ctx) => {
    const id = `${ownerId}--${seq++}`
    const request: PermissionRequest = {
      id,
      ownerId,
      toolName,
      input,
      toolUseId: ctx.toolUseID,
      decisionReason: ctx.decisionReason,
      blockedPath: ctx.blockedPath,
      canRemember: Boolean(ctx.suggestions?.length),
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

      const timer = setTimeout(() => settle({
        behavior: 'deny',
        message: `Nobody answered the permission prompt for ${toolName} within ${
          Math.round(timeoutMs / 60_000)
        } minutes, so it was denied. Explain what you needed and stop.`,
      }), timeoutMs)
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
  entry.settle(decision)
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
    // The CLI validates an allow against a schema that requires this. Nothing
    // here rewrites the call, so it goes back exactly as it came in.
    updatedInput: input,
    // "Allow for this run" is exactly what the CLI's own suggestions encode, so
    // handing them straight back stops it asking again for the same thing.
    ...(decision.scope === 'session' && suggestions?.length
      ? { updatedPermissions: suggestions }
      : {}),
  }
}
