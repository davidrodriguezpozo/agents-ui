import { query } from '@anthropic-ai/claude-agent-sdk'
import { emit, getActive, persist, setStatus, type Run } from './runStore'
import { toQueryOptions, type ResolvedRunOptions } from './runOptions'
import { refusedHostsIn } from './sandboxViolations'
import { recordQuota } from './quota'
import { answerPermission, createPermissionBroker } from './permissionBroker'
import { mergeRules } from './permissionRules'
import { notify } from './notify'
import { budgetStoppedMessage } from './budget'
import { tokenUsageOf } from './usage'
import { nowTrustedFully } from './liveTrust'
import { closeSteerChannel, openSteerChannel } from './liveSteer'
import { queueMessage } from './sessionQueue'
import { paragraphBreaks } from './textBlocks'

function toolResultText(content: unknown): string {
  return typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(c => (c as { text?: string })?.text ?? '').join('')
      : ''
}

function previewToolResult(content: unknown): string {
  const text = toolResultText(content)
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
  opts: { unattended?: boolean; resumeSessionId?: string; maxBudgetUsd?: number } = {},
): Promise<void> {
  const entry = getActive(run.id)
  if (!entry) return

  setStatus(run.id, 'running')

  // Anything the CLI wants approval for becomes an event in the run log, so it
  // survives a page refresh and replays for whoever attaches next.
  const broker = createPermissionBroker({
    ownerId: run.id,
    onRequest: async (request) => {
      emit(run.id, { type: 'permission_request', request })

      // Recorded whether or not anyone is watching: this is what lets a ritual
      // later be granted exactly the permissions it turned out to need.
      if (request.suggestedRules?.length) {
        entry.run.suggestedRules = mergeRules(entry.run.suggestedRules ?? [], request.suggestedRules)
      }

      // Checked before everything below, including the unattended refusal: a
      // session someone deliberately set to Auto has said what it wants, and a
      // repair turn on it should not be refused for the crime of running while
      // nobody watched.
      //
      // `once` rather than `session`: the second hands the CLI's own
      // suggestions back as permission updates, and those carry a destination
      // that can be `userSettings` or `projectSettings`. Auto means this
      // session stops asking, not that every command it happened to run gets
      // written into settings on disk. Answering each call costs nothing worth
      // measuring and leaves nothing behind.
      if (await nowTrustedFully(run.sessionId)) {
        answerPermission(request.id, { behavior: 'allow', scope: 'once' })
        return
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
      void notify(
        'needsYou',
        `${run.title} needs you`,
        `Waiting for approval to use ${request.toolName}.`,
        runPath(run),
      )
    },
    onSettled: (request, decision) => emit(run.id, {
      type: 'permission_resolved',
      id: request.id,
      behavior: decision.behavior,
    }),
  })

  /**
   * What each tool call was asked to do, so a refusal can be traced back to it.
   *
   * The sandbox's proxy does not name the host it blocked — `curl` refused
   * example.com says only that a tunnel failed — so the host often has to come
   * from the command that produced the failure. Kept for the life of the run
   * and no longer.
   */
  const commandById = new Map<string, string>()

  /**
   * The prompt, as a stream rather than a string, so a correction typed while
   * this is running can reach it. See `liveSteer` — the cost of the choice is
   * that closing the input is now this function's job, on every ending.
   */
  const prompt = openSteerChannel(run.id, run.input)

  /** Accepted mid-turn and never handed over, because the turn ended first. */
  const undelivered: string[] = []

  /** Where one block of the answer ends and the next begins. */
  const breaks = paragraphBreaks()

  try {
    for await (const message of query({
      prompt,
      options: {
        // Resuming is what makes a session a conversation rather than a series
        // of unrelated runs.
        ...toQueryOptions(options, opts.resumeSessionId, opts.maxBudgetUsd),
        canUseTool: broker.canUseTool,
        abortController: entry.abort,
      },
    })) {
      if (entry.abort.signal.aborted) break

      if (message.type === 'system' && message.subtype === 'init') {
        entry.run.sdkSessionId = message.session_id
      }

      // Arrives during runs that were happening anyway, so collecting it costs
      // nothing. It is an account-level fact rather than a fact about this run,
      // which is why it goes to its own store rather than onto the record.
      if (message.type === 'rate_limit_event') {
        void recordQuota((message as { rate_limit_info?: Record<string, unknown> }).rate_limit_info ?? {})
      }

      if (message.type === 'stream_event' && message.event) {
        const evt = message.event as {
          type: string
          content_block?: { type?: string }
          delta?: { type: string; text?: string; thinking?: string }
        }
        if (evt.type === 'content_block_start') {
          breaks.startBlock(evt.content_block?.type)
        }
        if (evt.type === 'content_block_delta') {
          if (evt.delta?.type === 'text_delta' && evt.delta.text) {
            const text = breaks.delta('text', evt.delta.text)
            if (text) emit(run.id, { type: 'text', text })
          } else if (evt.delta?.type === 'thinking_delta' && evt.delta.thinking) {
            const text = breaks.delta('thinking', evt.delta.thinking)
            if (text) emit(run.id, { type: 'thinking', text })
          }
        }
      }

      if (message.type === 'assistant') {
        for (const block of message.message?.content ?? []) {
          if ((block as { type?: string }).type === 'tool_use') {
            const toolUse = block as { id: string; name: string; input: unknown }
            const command = (toolUse.input as { command?: unknown } | null)?.command
            if (typeof command === 'string') commandById.set(toolUse.id, command)
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
              const text = toolResultText(result.content)

              // Only worth asking when the sandbox is actually on — the DNS
              // half of a denial reads identically to an offline machine, and
              // blaming the sandbox for that would be a lie.
              //
              // Not keyed on `is_error` either: a command piped through `head`,
              // or one whose failure was caught, comes back marked fine. Both
              // were seen in a real blocked run.
              if (options.sandbox.enabled) {
                const refused = refusedHostsIn(
                  commandById.get(result.tool_use_id) ?? '',
                  text,
                  { allowed: options.sandbox.allowedDomains },
                )
                if (refused.length) {
                  entry.run.refusedHosts = [...new Set([...(entry.run.refusedHosts ?? []), ...refused])]
                }
              }

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

      /**
       * Keyed on the message type rather than on a `result` field, because the
       * SDK's *error* results do not carry one — a run stopped for hitting its
       * budget or its turn limit went through here unnoticed, reported as
       * completed with no output and, worse, with its cost never recorded. A
       * spending limit whose own enforcement is invisible to the spend page
       * would be a poor limit.
       */
      if (message.type === 'result') {
        /**
         * The turn is over, so the input is over: in streaming input mode the
         * SDK will not close stdin for us, and a CLI whose stdin is open waits
         * for another instruction forever. Closing here is exactly what the SDK
         * does itself for a single-turn query, at the same moment.
         */
        undelivered.push(...closeSteerChannel(run.id))

        const subtype = (message as { subtype?: string }).subtype
        const stats = {
          usage: tokenUsageOf(message),
          costUsd: (message as { total_cost_usd?: number }).total_cost_usd ?? 0,
          durationMs: (message as { duration_ms?: number }).duration_ms ?? 0,
          numTurns: (message as { num_turns?: number }).num_turns ?? 0,
          model: options.model,
          permissionDenials: ((message as { permission_denials?: { tool_name: string }[] }).permission_denials ?? [])
            .map(d => ({ toolName: d.tool_name })),
        }

        entry.run.stats = stats

        // Stopped part-way rather than finished. The work is incomplete, which
        // is the same situation as a run that was refused a tool it needed —
        // so it is flagged the same way and does not read as a clean success.
        const stoppedEarly = subtype === 'error_max_budget_usd' || subtype === 'error_max_turns'
        if (stoppedEarly) {
          entry.run.needsAttention = true
          entry.run.stoppedBy = subtype === 'error_max_budget_usd' ? 'budget' : 'turns'
        }

        const text = (message as { result?: string }).result
          ?? (subtype === 'error_max_budget_usd'
            ? budgetStoppedMessage(opts.maxBudgetUsd)
            : subtype === 'error_max_turns'
              ? `This run reached its limit of ${options.maxTurns} turns and was stopped, so the work is unfinished.`
              : 'The run ended without a final answer.')

        // The final result is authoritative — streamed deltas can be partial.
        entry.run.output = text
        emit(run.id, { type: 'result', text, stats })

        if (stoppedEarly) {
          await notify(
            'failed',
            `${run.title} stopped early`,
            entry.run.stoppedBy === 'budget'
              ? 'It reached its spending limit.'
              : 'It reached its turn limit.',
            runPath(run),
          )
        }
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

    /**
     * Every other ending — stopped, failed, the CLI going away — closes here.
     * The result path above has already done it, and closing twice reports
     * nothing the second time.
     */
    undelivered.push(...closeSteerChannel(run.id))

    /**
     * A message taken for this turn that the turn ended before delivering is
     * still the next thing somebody meant to say, so it becomes what it would
     * have been had they pressed the other button: the front of the session's
     * queue, which `startTurn` flushes as soon as this run's status settles.
     */
    if (run.sessionId) {
      for (const text of undelivered) {
        await queueMessage(run.sessionId, text).catch(() => null)
      }
    }

    await persist(run.id)
  }
}
