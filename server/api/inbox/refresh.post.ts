import {
  INBOX_DENIED_TOOLS, findInboxSource, inboxStore, parseInboxReply,
  type InboxSourceState,
} from '../../utils/inbox'
import { listMcpServers } from '../../utils/mcp'
import { runClaude } from '../../utils/cli'
import { getProjectDir } from '../../utils/scope'

/**
 * Go and look, then write down what was found.
 *
 * This is the expensive half and it is deliberately explicit: the spike that
 * proved it possible took 155 seconds and real tokens, because "what is assigned
 * to me" means finding the database, working out which person is you, and
 * querying it. Nothing polls this. A person presses refresh, or a ritual calls
 * it on a schedule — which is the thing this app is for.
 *
 * Three things are checked before spending anything:
 *
 *   - that the source exists;
 *   - that a project is selected, because MCP reachability is decided by the
 *     working directory and asking from nowhere reaches nothing;
 *   - that the server it needs is actually answering *from that directory*.
 *     Notion answers from one of this machine's projects and is not configured
 *     in another, and "connected" is not the same as "configured".
 *
 * The last one is the difference between a clear explanation and two minutes of
 * a model discovering it has no tools.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ source?: string }>(event).catch(() => ({} as { source?: string }))
  const source = findInboxSource(String(body?.source ?? ''))

  if (!source) {
    throw createError({
      statusCode: 400,
      data: { error: 'unknown_source', message: 'There is no inbox source by that name.' },
    })
  }

  const projectDir = getProjectDir(event)
  if (!projectDir) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'no_project',
        message: 'Pick a project first. Which tools Claude can reach depends on the '
          + 'directory it is asked from, so there is nowhere to ask from yet.',
      },
    })
  }

  // Asked from the project, because that is what decides the answer.
  const servers = await listMcpServers(projectDir).catch(() => [])
  const server = servers.find(s => s.name === source.requires)

  if (!server || server.status !== 'connected') {
    const reason = !server
      ? `${source.requires} is not configured in this project.`
      : server.status === 'needs-auth'
        ? `${source.requires} needs signing in to before it will answer.`
        : `${source.requires} is not answering (${server.status}).`

    throw createError({
      statusCode: 409,
      data: {
        error: 'source_unavailable',
        message: `${reason} Nothing was spent. Check it on the MCP page.`,
      },
    })
  }

  const startedAt = Date.now()
  let reply = ''
  let costUsd: number | undefined
  let failure: string | undefined

  try {
    // The deny-list is what actually restricts this — see INBOX_DENIED_TOOLS for
    // the two allow-list approaches that were tried and measured not to work.
    // `--allowedTools` is here only so the MCP calls do not sit waiting for a
    // permission prompt nobody is present to answer.
    //
    // `--max-turns` because this is discovery, and discovery is where a run
    // wanders. Twelve is enough for search-then-query and short of an afternoon.
    const { stdout } = await runClaude(
      [
        '-p', source.prompt,
        '--output-format', 'json',
        '--allowedTools', ...source.tools,
        '--disallowedTools', ...INBOX_DENIED_TOOLS,
        '--max-turns', '12',
      ],
      { cwd: projectDir, timeout: 240_000 },
    )

    const envelope = JSON.parse(stdout) as { result?: string; total_cost_usd?: number }
    reply = envelope.result ?? ''
    costUsd = envelope.total_cost_usd
  } catch (e: any) {
    // A timeout or a CLI failure is news about the refresh, not about the inbox.
    // The previous findings are kept — stale is more useful than blank.
    failure = e?.data?.message || e?.message || 'The refresh did not finish.'
  }

  const parsed = failure ? null : parseInboxReply(reply)
  if (parsed && 'error' in parsed) failure = parsed.error

  const next: InboxSourceState = await inboxStore.update((inbox) => {
    const existing = inbox.sources.find(s => s.source === source.key)
    const state: InboxSourceState = existing ?? { source: source.key, items: [] }
    if (!existing) inbox.sources.push(state)

    // Only replace the findings when there are new ones to replace them with.
    if (parsed && 'items' in parsed) {
      state.items = parsed.items

      // A dismissal for something no longer waiting is dead weight, and keeping
      // it would silently hide the item if it came back.
      const present = new Set(parsed.items.map(item => item.id))
      state.dismissed = (state.dismissed ?? []).filter(id => present.has(id))
    }

    state.checkedAt = Date.now()
    state.durationMs = Date.now() - startedAt
    state.costUsd = costUsd
    state.projectDir = projectDir
    state.error = failure
    return state
  })

  return next
})
