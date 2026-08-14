import {
  INBOX_DENIED_TOOLS, buildInboxPrompt, describeRunFailure, findInboxSource, inboxModel,
  inboxStore, inboxTimeoutMs, inboxTurns, mergeLearned, parseInboxReply, salvageEnvelope,
  type InboxSourceState, type RunEnvelope,
} from './inbox'
import { listMcpServers } from './mcp'
import { runClaude } from './cli'

/**
 * Going and looking, in one place because two callers need it.
 *
 * A person pressing refresh and the clock reaching 08:00 have to do exactly the
 * same thing, and the alternative — having the scheduler make an HTTP request to
 * the server it is running inside — is the kind of shortcut that works until the
 * port changes. So the work lives here and the route is a wrapper.
 *
 * Refusals come back as a value rather than an exception because both callers
 * need to say why: the route turns it into a status code, the scheduler writes it
 * where the source's last error is shown. What they share is the promise in the
 * message: nothing was spent.
 */
export type RefreshRefusal =
  | { error: 'unknown_source'; message: string }
  | { error: 'no_project'; message: string }
  | { error: 'source_unavailable'; message: string }
  | { error: 'not_headless_capable'; message: string }

export type RefreshResult =
  | { ok: true; state: InboxSourceState }
  | { ok: false; refusal: RefreshRefusal }

/**
 * Write a refusal where the reader will see it.
 *
 * Without this a refusal was only ever a toast, and the row kept whatever it last
 * said. Slack went on displaying "It ran out of turns before it finished looking"
 * — an accurate account of a run from before the pre-flight existed, and by then
 * a completely wrong explanation of why it was not working. Pressing refresh
 * appeared to change nothing.
 *
 * `checkedAt` moves too, because "we looked and were turned away at the door" is
 * news about now, not about whenever the last real run happened.
 */
async function recordRefusal(sourceKey: string, message: string): Promise<void> {
  await inboxStore.update((inbox) => {
    const existing = inbox.sources.find(s => s.source === sourceKey)
    const state = existing ?? { source: sourceKey, items: [] }
    if (!existing) inbox.sources.push(state)

    state.error = message
    state.checkedAt = Date.now()
    // Not a run, so there is nothing to say about duration or cost. Leaving the
    // last run's numbers here would attribute them to this refusal.
    state.durationMs = undefined
    state.costUsd = undefined
  })
}

/**
 * Check before spending, because the alternative is two minutes of a model
 * discovering it has no tools and a charge for finding out.
 *
 * The MCP probe is asked *from the project directory*, because that is what
 * decides the answer — Notion answers from one of this machine's projects and is
 * not configured in another. "Connected" is not the same as "configured".
 */
export async function refreshInboxSource(
  sourceKey: string,
  projectDir: string | undefined,
): Promise<RefreshResult> {
  const source = findInboxSource(sourceKey)

  if (!source) {
    return {
      ok: false,
      refusal: { error: 'unknown_source', message: 'There is no inbox source by that name.' },
    }
  }

  if (!projectDir) {
    return {
      ok: false,
      refusal: {
        error: 'no_project',
        message: 'Pick a project first. Which tools Claude can reach depends on the '
          + 'directory it is asked from, so there is nowhere to ask from yet.',
      },
    }
  }

  const servers = await listMcpServers(projectDir).catch(() => [])
  const server = servers.find(s => s.name === source.requires)

  /*
   * "Connected" turns out to be the third of three different things, and this is
   * the one that cost the most to learn.
   *
   * `claude.ai Slack` reports ✔ Connected and its scope is `claude.ai config`: it
   * is a connector configured on claude.ai, not a server on this machine. Its
   * tools arrive through a claude.ai session, so a `claude -p` run started by this
   * app gets **none of them** — asked to list its own tools from that project, a
   * run reported 28 from `notion` and zero from Slack.
   *
   * Which produced the worst possible failure: a source that looked healthy, took
   * ninety seconds, spent real tokens, and reported `error_max_turns` — a run
   * looking for tools it never had. Refused here instead, before anything is
   * spent, and said in terms that name what would fix it.
   */
  if (server?.origin === 'claude.ai') {
    const message = `${source.requires} is a claude.ai connector, so its tools only exist inside `
      + 'a claude.ai session — the background runs this app makes cannot see them. '
      + 'Nothing was spent. It would need the same service added as a local MCP server '
      + `in this project (\`claude mcp add\`) before ${source.label} could be checked here.`

    await recordRefusal(source.key, message)
    return { ok: false, refusal: { error: 'not_headless_capable', message } }
  }

  if (!server || server.status !== 'connected') {
    const reason = !server
      ? `${source.requires} is not configured in this project.`
      : server.status === 'needs-auth'
        ? `${source.requires} needs signing in to before it will answer.`
        : `${source.requires} is not answering (${server.status}).`

    const message = `${reason} Nothing was spent. Check it on the MCP page.`
    await recordRefusal(source.key, message)
    return { ok: false, refusal: { error: 'source_unavailable', message } }
  }

  // What the last run worked out, so this one can skip the discovery that made
  // the first refresh cost $1.39 rather than cents.
  const previous = (await inboxStore.read()).sources.find(s => s.source === source.key)
  const prompt = buildInboxPrompt(source, previous?.learned)
  const model = inboxModel(previous?.learned)

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
    // `--max-turns` is two numbers, not one: discovery needs room to search, work
    // out who you are, find the database and query it, while a run holding a note
    // has one job and should stop early if it cannot do it. See `inboxTurns`.
    const { stdout } = await runClaude(
      [
        '-p', prompt,
        '--output-format', 'json',
        ...(model ? ['--model', model] : []),
        '--allowedTools', ...source.tools,
        '--disallowedTools', ...INBOX_DENIED_TOOLS,
        '--max-turns', String(inboxTurns(previous?.learned)),
      ],
      { cwd: projectDir, timeout: inboxTimeoutMs(previous?.learned) },
    )

    const envelope = JSON.parse(stdout) as RunEnvelope
    reply = envelope.result ?? ''
    costUsd = envelope.total_cost_usd

    // Before reading the answer, decide whether it is one. A run that was refused
    // the tools it needed still replies `items: []`, which is indistinguishable
    // from an empty inbox and reads as "nothing is waiting on you".
    failure = describeRunFailure(envelope, source.tools)
  } catch (e: any) {
    // A timeout or a CLI failure is news about the refresh, not about the inbox.
    // The previous findings are kept — stale is more useful than blank.
    //
    // The envelope is worth digging out of a failed run rather than reporting the
    // exit code: a run that exhausts its turns exits non-zero *and* prints a full
    // report, so this path is where the most diagnosable failures land. Reported
    // raw it read "error_max_turns", which names the symptom and not the cause.
    const salvaged = salvageEnvelope(e?.data?.stdout)
    failure = (salvaged && describeRunFailure(salvaged, source.tools))
      || e?.data?.message
      || e?.message
      || 'The refresh did not finish.'

    // Even a failed run costs, and hiding that would be the one dishonesty this
    // feature cannot afford.
    costUsd = salvaged?.total_cost_usd ?? costUsd
  }

  const parsed = failure ? null : parseInboxReply(reply)
  if (parsed && 'error' in parsed) failure = parsed.error

  /*
   * The run says a tool would not answer, so this is not an answer.
   *
   * Checked here rather than trusted to the envelope because the CLI cannot see
   * it: Notion's Query Data Source has a workspace usage quota, and an exhausted
   * one comes back as a perfectly successful run whose tool result happens to say
   * "your workspace has reached the usage limit". Every tool was allowed, nothing
   * was denied, `subtype` was success — and the reply was `items: []`, which the
   * queue rendered as "Nothing is waiting on you."
   *
   * Treated as a failure, which means the previous findings stay: yesterday's
   * eight tickets are a better answer than a confident nothing.
   */
  if (parsed && 'items' in parsed && parsed.blocked) {
    failure = `A tool would not answer, so this is not an answer: ${parsed.blocked}`
  }

  const state: InboxSourceState = await inboxStore.update((inbox) => {
    const existing = inbox.sources.find(s => s.source === source.key)
    const next: InboxSourceState = existing ?? { source: source.key, items: [] }
    if (!existing) inbox.sources.push(next)

    // Only replace the findings when there are new ones to replace them with —
    // and a blocked run has none, whatever its empty list claims.
    if (parsed && 'items' in parsed && !parsed.blocked) {
      next.items = parsed.items

      // A cached run reported its own reference data dead, so it is dropped and
      // the next run rediscovers with the strong model. This is the only way a
      // moved database gets noticed: to a caller, broken queries and an empty
      // inbox are both `items: []`.
      if (parsed.stale) {
        next.learned = undefined
      } else {
        // Guarded rather than assigned: a run that used the note successfully
        // tends to report that it worked instead of restating it, and storing
        // that would turn a working cache into a status message.
        next.learned = mergeLearned(next.learned, parsed.learned)
      }

      // A dismissal for something no longer waiting is dead weight, and keeping
      // it would silently hide the item if it came back.
      const present = new Set(parsed.items.map(item => item.id))
      next.dismissed = (next.dismissed ?? []).filter(id => present.has(id))
    }

    next.checkedAt = Date.now()
    next.durationMs = Date.now() - startedAt
    next.costUsd = costUsd
    next.projectDir = projectDir
    next.error = failure
    return next
  })

  return { ok: true, state }
}
