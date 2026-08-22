import {
  INBOX_DENIED_TOOLS, describeRunFailure, findInboxSource, mergeLearned, pickInboxServer,
  salvageEnvelope, type RunEnvelope,
} from './inbox'
import { runClaude } from './cli'
import { listMcpServers } from './mcp'
import {
  buildTicketPrompt, notionIntakeConfigured, notionIntakeStore, parseTicketReply,
  type NotionIntakeConfig, type NotionIntakeState,
} from './notionIntake'

/**
 * Going and looking in Notion, which is a job rather than a request.
 *
 * Split from `notionIntake.ts` the way `inboxRefresh.ts` is split from
 * `inbox.ts`, and for the same two reasons: everything that decides what a
 * reading *means* stays testable without spending anybody's money, and the run
 * itself has one home whether a person pressed the button or something else asked
 * for it later.
 *
 * Refusals come back as a value rather than an exception because the caller has
 * to say why, and because they are the common case on a machine where Notion is
 * simply not set up. What they all share is the promise in the message: nothing
 * was spent.
 */
export type NotionRefreshRefusal =
  | { error: 'not_configured'; message: string }
  | { error: 'no_project'; message: string }
  | { error: 'not_connected'; message: string }

export type NotionRefreshResult =
  | { ok: true; state: NotionIntakeState }
  | { ok: false; refusal: NotionRefreshRefusal }

/**
 * Write a refusal where the reader will see it.
 *
 * The band shows the last error beside the last reading, so a refusal that only
 * ever became a toast would leave the row saying whatever it last said — which is
 * how the inbox spent a week explaining a failure from before its own pre-flight
 * existed. `checkedAt` moves too: being turned away at the door is news about
 * now, not about whenever the last real run happened.
 */
async function recordRefusal(message: string): Promise<void> {
  await notionIntakeStore.update((state) => {
    state.error = message
    state.checkedAt = Date.now()
    // Not a run, so there is nothing to say about duration or cost. Leaving the
    // last run's numbers here would attribute them to this refusal.
    state.durationMs = undefined
    state.costUsd = undefined
  })
}

/**
 * Read the configured data source, or say why it could not be read.
 *
 * The pre-flight is `pickInboxServer`, unchanged, asked from the project
 * directory — because that is what decides the answer. Notion answers from one of
 * this machine's projects and is not configured in another, and "Connected" is not
 * the same question as "will answer an unattended run": a claude.ai connector says
 * the first and means neither. Checking before spending is the whole point; it
 * cost $0.37 to learn that the once.
 */
export async function refreshNotionIntake(
  config: NotionIntakeConfig,
  projectDir: string | undefined,
): Promise<NotionRefreshResult> {
  if (!notionIntakeConfigured(config)) {
    return {
      ok: false,
      refusal: {
        error: 'not_configured',
        message: 'Say which Notion data source holds the tickets, and which status value means an '
          + 'agent may take one. Both are in Settings. Nothing can be read until they are set.',
      },
    }
  }

  if (!projectDir) {
    return {
      ok: false,
      refusal: {
        error: 'no_project',
        message: 'Pick a project first. Which tools Claude can reach depends on the directory it '
          + 'is asked from, so there is nowhere to ask from yet.',
      },
    }
  }

  // The same server the inbox reads Notion through, with the same allowed tools.
  // Absent means somebody has edited `INBOX_SOURCES`, which is a bug rather than
  // a state a reader can fix, so it is reported as the refusal it is.
  const source = findInboxSource('notion')
  if (!source) {
    return {
      ok: false,
      refusal: { error: 'not_connected', message: 'This build has no Notion source configured to read through.' },
    }
  }

  const servers = await listMcpServers(projectDir).catch(() => [])
  const choice = pickInboxServer(source, servers)

  if ('refusal' in choice) {
    await recordRefusal(choice.refusal)
    return { ok: false, refusal: { error: 'not_connected', message: choice.refusal } }
  }

  const previous = await notionIntakeStore.read()
  const prompt = buildTicketPrompt(config, previous.learned)

  const startedAt = Date.now()
  let reply = ''
  let costUsd: number | undefined
  let failure: string | undefined

  try {
    // The deny-list is what actually restricts this — see `INBOX_DENIED_TOOLS`
    // for the two allow-list approaches that were measured not to work.
    // `--allowedTools` is here only so the MCP calls do not sit waiting for a
    // permission prompt nobody is present to answer.
    //
    // Not given the cheaper model even when it is holding a note, unlike the
    // inbox's Notion refresh: that one formats eight titles, and this one copies
    // out ticket bodies that are about to be quoted to a session. Getting the
    // text approximately right is not good enough when it is the ask.
    const { stdout } = await runClaude(
      [
        '-p', prompt,
        '--output-format', 'json',
        '--allowedTools', ...source.tools,
        '--disallowedTools', ...INBOX_DENIED_TOOLS, ...(source.deny ?? []),
        '--max-turns', String(previous.learned?.trim() ? 12 : 30),
      ],
      { cwd: projectDir, timeout: previous.learned?.trim() ? 240_000 : 420_000 },
    )

    const envelope = JSON.parse(stdout) as RunEnvelope
    reply = envelope.result ?? ''
    costUsd = envelope.total_cost_usd

    // Before reading the answer, decide whether it is one. A run refused the
    // tools it needed still replies with an empty list, which is
    // indistinguishable from "no ticket carries the status".
    failure = describeRunFailure(envelope, source.tools)
  } catch (e: any) {
    // A timeout or a CLI failure is news about the reading, not about Notion.
    // The previous tickets are kept — stale is more useful than blank. The
    // envelope is worth digging out of a failed run rather than reporting the
    // exit code: a run that exhausts its turns exits non-zero having already
    // printed a full report naming why.
    const salvaged = salvageEnvelope(e?.data?.stdout)
    failure = (salvaged && describeRunFailure(salvaged, source.tools))
      || e?.data?.message
      || e?.message
      || 'The reading did not finish.'

    // Even a failed run costs, and hiding that would be the one dishonesty this
    // feature cannot afford.
    costUsd = salvaged?.total_cost_usd ?? costUsd
  }

  const parsed = failure ? null : parseTicketReply(reply, config)
  if (parsed && 'error' in parsed) failure = parsed.error

  // The run says a tool would not answer, so this is not an answer. Notion's
  // Query Data Source is quota'd per workspace, and an exhausted one comes back
  // as a perfectly successful run whose tool result happens to say so — every
  // tool allowed, nothing denied, and an empty list that means nothing.
  if (parsed && 'tickets' in parsed && parsed.blocked) {
    failure = `A tool would not answer, so this is not an answer: ${parsed.blocked}`
  }

  const state = await notionIntakeStore.update((next) => {
    // Only replace the tickets when there are new ones to replace them with —
    // and a blocked run has none, whatever its empty list claims.
    if (parsed && 'tickets' in parsed && !parsed.blocked) {
      next.tickets = parsed.tickets

      // A run reported its own reference data dead, so it is dropped and the
      // next one rediscovers. This is the only way a moved database gets
      // noticed: to a caller, broken queries and an empty band are both [].
      if (parsed.stale) next.learned = undefined
      else next.learned = mergeLearned(next.learned, parsed.learned)
    }

    next.checkedAt = Date.now()
    next.durationMs = Date.now() - startedAt
    next.costUsd = costUsd
    next.projectDir = projectDir
    next.error = failure
    return { ...next }
  })

  return { ok: true, state }
}
