import { query } from '@anthropic-ai/claude-agent-sdk'
import { emit, getActive, persist, setStatus, type Run } from './runStore'
import { toQueryOptions, type ResolvedRunOptions } from './runOptions'
import { answerPermission, createPermissionBroker } from './permissionBroker'
import { mergeRules } from './permissionRules'
import { notify } from './notify'

function previewToolResult(content: unknown): string {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(c => (c as { text?: string })?.text ?? '').join('')
      : ''
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}

/**
 * Drive a run to completion, detached from any HTTP request. Nothing here
 * touches the response — progress goes into the run store, which streams to
 * whoever is currently attached and persists for whoever attaches later.
 */
export async function executeRun(
  run: Run,
  options: ResolvedRunOptions,
  opts: { unattended?: boolean; resumeSessionId?: string } = {},
): Promise<void> {
  const entry = getActive(run.id)
  if (!entry) return

  setStatus(run.id, 'running')

  // Anything the CLI wants approval for becomes an event in the run log, so it
  // survives a page refresh and replays for whoever attaches next.
  const broker = createPermissionBroker({
    ownerId: run.id,
    onRequest: (request) => {
      emit(run.id, { type: 'permission_request', request })

      // Recorded whether or not anyone is watching: this is what lets a ritual
      // later be granted exactly the permissions it turned out to need.
      if (request.suggestedRules?.length) {
        entry.run.suggestedRules = mergeRules(entry.run.suggestedRules ?? [], request.suggestedRules)
      }

      // Nobody is at the keyboard for a scheduled run. Waiting out the ten
      // minute timeout would stall the ritual and then deny anyway, so refuse
      // immediately and flag the run — the person can rerun it themselves.
      if (opts.unattended) {
        entry.run.needsAttention = true
        entry.run.deniedTools = [...new Set([...(entry.run.deniedTools ?? []), request.toolName])]
        answerPermission(request.id, {
          behavior: 'deny',
          message: `"${request.toolName}" needs your approval, and this ran on a schedule with nobody watching. Run it yourself to approve.`,
        })
        return
      }

      // Attended, but "attended" only means someone could answer — they are
      // probably in another window. A prompt nobody sees stalls until it times
      // out, so this is exactly what a notification is for.
      void notify('needsYou', `${run.title} needs you`, `Waiting for approval to use ${request.toolName}.`)
    },
    onSettled: (request, decision) => emit(run.id, {
      type: 'permission_resolved',
      id: request.id,
      behavior: decision.behavior,
    }),
  })

  try {
    for await (const message of query({
      prompt: run.input,
      options: {
        // Resuming is what makes a session a conversation rather than a series
        // of unrelated runs.
        ...toQueryOptions(options, opts.resumeSessionId),
        canUseTool: broker.canUseTool,
        abortController: entry.abort,
      },
    })) {
      if (entry.abort.signal.aborted) break

      if (message.type === 'system' && message.subtype === 'init') {
        entry.run.sdkSessionId = message.session_id
      }

      if (message.type === 'stream_event' && message.event) {
        const evt = message.event as {
          type: string
          delta?: { type: string; text?: string; thinking?: string }
        }
        if (evt.type === 'content_block_delta') {
          if (evt.delta?.type === 'text_delta' && evt.delta.text) {
            emit(run.id, { type: 'text', text: evt.delta.text })
          } else if (evt.delta?.type === 'thinking_delta' && evt.delta.thinking) {
            emit(run.id, { type: 'thinking', text: evt.delta.thinking })
          }
        }
      }

      if (message.type === 'assistant') {
        for (const block of message.message?.content ?? []) {
          if ((block as { type?: string }).type === 'tool_use') {
            const toolUse = block as { id: string; name: string; input: unknown }
            emit(run.id, {
              type: 'tool_use',
              id: toolUse.id,
              toolName: toolUse.name,
              input: toolUse.input,
            })
          }
        }
      }

      if (message.type === 'user') {
        const content = message.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if ((block as { type?: string }).type === 'tool_result') {
              const result = block as { tool_use_id: string; content?: unknown; is_error?: boolean }
              emit(run.id, {
                type: 'tool_result',
                id: result.tool_use_id,
                isError: Boolean(result.is_error),
                preview: previewToolResult(result.content),
              })
            }
          }
        }
      }

      if ('result' in message) {
        const usage = (message as { usage?: Record<string, number> }).usage ?? {}
        const stats = {
          usage: {
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
            cacheRead: usage.cache_read_input_tokens ?? 0,
            cacheCreation: usage.cache_creation_input_tokens ?? 0,
          },
          costUsd: (message as { total_cost_usd?: number }).total_cost_usd ?? 0,
          durationMs: (message as { duration_ms?: number }).duration_ms ?? 0,
          numTurns: (message as { num_turns?: number }).num_turns ?? 0,
          model: options.model,
          permissionDenials: ((message as { permission_denials?: { tool_name: string }[] }).permission_denials ?? [])
            .map(d => ({ toolName: d.tool_name })),
        }

        entry.run.stats = stats
        // The final result is authoritative — streamed deltas can be partial.
        entry.run.output = message.result
        emit(run.id, { type: 'result', text: message.result, stats })
      }
    }

    if (entry.abort.signal.aborted) {
      // cancel() already set the status; just make sure it's on disk.
      await persist(run.id)
      return
    }

    setStatus(run.id, 'completed')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    emit(run.id, { type: 'error', message })
    setStatus(run.id, 'failed', { error: message })
  } finally {
    // A prompt outliving its run would block forever with nothing to answer it.
    broker.dispose('The run ended before this tool was approved.')
    await persist(run.id)
  }
}
