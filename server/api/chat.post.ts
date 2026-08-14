import { query } from '@anthropic-ai/claude-agent-sdk'
import { resolveRunOptions, toQueryOptions } from '../utils/runOptions'
import { createPermissionBroker, newPermissionOwnerId } from '../utils/permissionBroker'
import { tokenUsageOf } from '../utils/usage'
import type { PermissionMode } from '~/types'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  messages: ChatMessage[]
  sessionId?: string
  agentSlug?: string
  projectDir?: string
  systemPromptOverride?: string
  /** Fidelity controls, surfaced in the Studio run settings. */
  allowedTools?: string[]
  disallowedTools?: string[]
  permissionMode?: PermissionMode
  maxTurns?: number
  loadProjectSettings?: boolean
  model?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ChatRequest>(event)

  if (!body.messages?.length) {
    throw createError({ statusCode: 400, message: 'messages is required' })
  }

  const lastUserMessage = body.messages.filter(m => m.role === 'user').pop()
  if (!lastUserMessage) {
    throw createError({ statusCode: 400, message: 'No user message found' })
  }

  // Shared with the detached runner, so an interactive chat and a scheduled run
  // build byte-identical sessions — agent prompt, model, tool policy, plugins.
  //
  // `managerChat` is set here rather than by the caller because this endpoint
  // *is* the Studio's chat: with an agent the agent's prompt wins anyway, and
  // without one, being told you are an assistant inside the agent manager is
  // the truth. Everything detached — sessions, rituals, workflow steps — goes
  // through the run path instead and is no longer told any of it.
  const options = await resolveRunOptions(event, { ...body, managerChat: true })
  const { agent, plugins, allowedTools, permissionMode, maxTurns, model } = options

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const sendEvent = (type: string, data: unknown) => {
    if (event.node.res.writableEnded) return
    event.node.res.write(`data: ${JSON.stringify({ type, ...data as object })}\n\n`)
  }

  // Kills the CLI subprocess when the browser goes away, instead of leaving it
  // running against a stream nobody is reading.
  const abortController = new AbortController()

  // Any tool the CLI wants approval for is pushed to the browser, which answers
  // through /api/permissions/:id. Without this the SDK errors the request and
  // the run stalls with no prompt and no way to unstick it.
  const broker = createPermissionBroker({
    ownerId: newPermissionOwnerId(),
    onRequest: request => sendEvent('permission_request', { request }),
    onSettled: (request, decision) => sendEvent('permission_resolved', {
      id: request.id,
      behavior: decision.behavior,
    }),
  })

  event.node.req.on('close', () => {
    broker.dispose('The user closed the conversation before approving this tool.')
    abortController.abort()
  })

  sendEvent('run_config', {
    cwd: options.cwd,
    model: model ?? 'inherit',
    allowedTools: allowedTools ?? null,
    permissionMode,
    maxTurns,
    agentSource: agent?.source ?? null,
    agentScope: agent?.scope ?? null,
    pluginName: agent?.pluginName ?? null,
    plugins: plugins.length,
  })

  let sessionId = body.sessionId || null

  try {
    let resultText = ''

    for await (const message of query({
      prompt: lastUserMessage.content,
      options: {
        ...toQueryOptions(options, sessionId),
        canUseTool: broker.canUseTool,
        abortController,
      },
    })) {
      // Capture session ID for resumption
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id
        sendEvent('session', { sessionId })
      }

      // Stream incremental text and thinking deltas
      if (message.type === 'stream_event' && message.event) {
        const evt = message.event as {
          type: string
          content_block?: { type: string }
          delta?: { type: string; text?: string; thinking?: string }
        }
        if (evt.type === 'content_block_start' && evt.content_block?.type === 'thinking') {
          sendEvent('thinking_start', {})
        }
        if (evt.type === 'content_block_delta') {
          if (evt.delta?.type === 'text_delta' && evt.delta.text) {
            sendEvent('text_delta', { text: evt.delta.text })
          } else if (evt.delta?.type === 'thinking_delta' && evt.delta.thinking) {
            sendEvent('thinking_delta', { text: evt.delta.thinking })
          }
        }
      }

      // Tool calls with their inputs — what the execution inspector renders
      if (message.type === 'assistant') {
        const content = message.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if ((block as { type?: string }).type === 'tool_use') {
              const toolUse = block as { id: string; name: string; input: unknown }
              sendEvent('tool_use', {
                id: toolUse.id,
                toolName: toolUse.name,
                input: toolUse.input,
              })
            }
          }
        }
      }

      // Tool results, so the inspector can pair them with their calls
      if (message.type === 'user') {
        const content = message.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if ((block as { type?: string }).type === 'tool_result') {
              const result = block as { tool_use_id: string; content?: unknown; is_error?: boolean }
              sendEvent('tool_result', {
                id: result.tool_use_id,
                isError: Boolean(result.is_error),
                preview: previewToolResult(result.content),
              })
            }
          }
        }
      }

      if (message.type === 'tool_progress') {
        sendEvent('tool_progress', {
          toolName: message.tool_name,
          elapsed: message.elapsed_time_seconds,
        })
      }

      // Final result — carries usage, cost and any permission denials
      if ('result' in message) {
        resultText = message.result
        sendEvent('result', {
          text: resultText,
          stopReason: message.stop_reason,
          stats: {
            usage: tokenUsageOf(message),
            costUsd: (message as { total_cost_usd?: number }).total_cost_usd ?? 0,
            durationMs: (message as { duration_ms?: number }).duration_ms ?? 0,
            numTurns: (message as { num_turns?: number }).num_turns ?? 0,
            model,
            permissionDenials: ((message as { permission_denials?: { tool_name: string }[] }).permission_denials ?? [])
              .map(d => ({ toolName: d.tool_name })),
          },
        })
      }
    }

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    sendEvent('error', { message: errorMessage })
  } finally {
    // `done` and `end()` are what release the composer in the browser, so they
    // have to happen on every path out of here — including a thrown query.
    broker.dispose('The conversation ended before this tool was approved.')
    sendEvent('done', { sessionId })
    event.node.res.end()
  }
})

function previewToolResult(content: unknown): string {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(c => (c as { text?: string })?.text ?? '').join('')
      : ''
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}
