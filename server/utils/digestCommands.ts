import { runClaude } from './cli'
import { describeRunFailure, salvageEnvelope, type RunEnvelope } from './inbox'
import { startSession } from './startSession'
import { startTurn } from './sessionTurn'
import { titleFromPrompt } from './sessions'
import { checkBudget } from './budget'
import { notify } from './notify'
import { postToSlack } from './digestSend'
import {
  buildCommandPrompt, commandsLeftToday, commandsRefusal, COMMAND_DENIED_TOOLS, COMMAND_TOOLS,
  dayKey, deliveryModel, deliveryStore, MAX_COMMANDS_PER_POLL, newCommands, parseThreadReply,
  readDelivery, type DigestDelivery, type ThreadReply,
} from './digestDelivery'

/**
 * Replying to the morning report to start work.
 *
 * The report was the first thing this app sent outward. This is the return leg,
 * and it is the whole reason the outward leg was worth building: the message
 * arrives on a phone, on a train, and the answer to "the rate limiting session's
 * checks are failing" is a sentence you can type there — which then cuts a
 * branch and a worktree on the machine at home and starts working on it.
 *
 * **Why this is safe enough to exist.** A reply becomes an agent with a shell on
 * your repository, so the guards are the feature rather than trimming around it:
 *
 *   - `commandsRefusal` will not read replies anywhere but a **direct message**.
 *     Slack channel ids say what kind of conversation they are; in a DM with
 *     yourself there is no other author, so a command cannot be forged. A channel
 *     can receive the report and can never command this.
 *   - the run that reads the thread holds **one read tool** and is denied every
 *     way of writing anywhere, including every way of posting to Slack. It is
 *     asked to transcribe, not to understand — see `buildCommandPrompt`.
 *   - which replies count is decided by **code, not by a model**: author id,
 *     cursor, and not-the-report-itself. See `newCommands`.
 *   - the work lands in a **session**, which is this app's existing answer to
 *     "an agent I am not watching": its own branch, its own checkout, nothing
 *     merged and nothing pushed until you say so.
 *   - three per poll, ten a day, and the daily spending cap applies as it does to
 *     any unattended work.
 *
 * What it cannot protect you from is your own instruction. A reply saying
 * something destructive is you typing it, and it is treated exactly as though you
 * had typed it into the app — which is the honest bargain, and the reason the
 * switch is off until you turn it on.
 */

export type CommandsRefusal =
  | { error: 'not_configured'; message: string }
  | { error: 'no_budget'; message: string }

export interface CommandsResult {
  /** Sessions started, in the order the replies arrived. */
  started: { sessionId: string; title: string; ts: string }[]
  /** Replies seen and deliberately not acted on, with why. */
  skipped: { ts: string; because: string }[]
  costUsd?: number
  error?: string
}

export type CommandsOutcome =
  | { ok: true; result: CommandsResult; state: DigestDelivery }
  | { ok: false; refusal: CommandsRefusal }

/** Turns and time for a transcription job. It reads one thread and stops. */
const COMMAND_TURNS = 6
const COMMAND_TIMEOUT_MS = 90_000

/**
 * Read the thread and act on what is new in it.
 *
 * Never throws: it rides the same poll as rituals and pull requests, and one bad
 * Slack reply must not take down the tick everything else depends on.
 */
export async function readCommands(now = Date.now()): Promise<CommandsOutcome> {
  const state = await readDelivery()

  const refusal = commandsRefusal(state)
  if (refusal) {
    return { ok: false, refusal: { error: 'not_configured', message: refusal } }
  }

  /*
   * The spending cap is checked before the reading run, not before the sessions.
   *
   * Reading the thread costs money too, and on a day that has already hit the
   * limit there is nothing that could be done with what it found — so paying to
   * find out would be the one charge with no possible benefit.
   */
  const budget = await checkBudget(now, { unattended: true })
  if (!budget.allowed) {
    return { ok: false, refusal: { error: 'no_budget', message: budget.reason! } }
  }

  const projectDir = state.projectDir!
  const startedAt = Date.now()

  let reply = ''
  let costUsd: number | undefined
  let failure: string | undefined

  try {
    const { stdout } = await runClaude(
      [
        '-p', buildCommandPrompt(state),
        '--output-format', 'json',
        ...(deliveryModel(state) ? ['--model', deliveryModel(state)!] : []),
        '--allowedTools', ...COMMAND_TOOLS,
        // The important half. See COMMAND_DENIED_TOOLS: this run cannot write
        // anywhere, least of all back into the thread it is reading.
        '--disallowedTools', ...COMMAND_DENIED_TOOLS,
        '--max-turns', String(COMMAND_TURNS),
      ],
      { cwd: projectDir, timeout: COMMAND_TIMEOUT_MS },
    )

    const envelope = JSON.parse(stdout) as RunEnvelope
    reply = envelope.result ?? ''
    costUsd = envelope.total_cost_usd
    failure = describeRunFailure(envelope, COMMAND_TOOLS)
  } catch (e: any) {
    const salvaged = salvageEnvelope(e?.data?.stdout)
    failure = (salvaged && describeRunFailure(salvaged, COMMAND_TOOLS))
      || e?.data?.message
      || e?.message
      || 'Reading the thread did not finish.'
    costUsd = salvaged?.total_cost_usd ?? costUsd
    reply = salvaged?.result ?? reply
  }

  const parsed = failure ? null : parseThreadReply(reply)
  const readError = failure
    ?? (parsed && 'error' in parsed ? parsed.error : undefined)
    /*
     * A tool that would not answer is not an empty thread.
     *
     * The same trap the inbox documents, with a worse consequence here: an empty
     * list means "you asked for nothing", so a refused tool would quietly read as
     * a morning where you had no instructions — for good, and silently.
     */
    ?? (parsed && 'replies' in parsed && parsed.blocked
      ? `A tool would not answer, so the thread was not read: ${parsed.blocked}`
      : undefined)

  const result: CommandsResult = { started: [], skipped: [], costUsd, error: readError }

  const replies = !readError && parsed && 'replies' in parsed ? parsed.replies : []
  const fresh = newCommands(replies, state)

  /*
   * The cap is applied here rather than inside `newCommands`, so what was left
   * out is still reported and the cursor does not move past it. A command over
   * the limit is deferred to the next poll, not dropped.
   */
  const allowance = Math.min(MAX_COMMANDS_PER_POLL, commandsLeftToday(state, now))
  const taking = fresh.slice(0, allowance)

  for (const over of fresh.slice(allowance)) {
    result.skipped.push({
      ts: over.ts,
      because: allowance === 0
        ? `Today's limit of instructions has been reached. This one waits until tomorrow.`
        : 'More arrived than one poll will take. This one waits for the next.',
    })
  }

  for (const command of taking) {
    const started = await startFromReply(command, projectDir)

    if ('error' in started) {
      result.skipped.push({ ts: command.ts, because: started.error })
      // Still counted as dealt with: retrying a session that could not be cut
      // every two minutes for the rest of the day is not a recovery, it is a
      // loop. The reason is reported, and reported back into the thread.
    } else {
      result.started.push(started)
    }

    await confirm(state, projectDir, command, started)
  }

  /*
   * The cursor moves over everything looked at, including what was refused.
   *
   * The alternative — advancing only past what worked — means a reply that cannot
   * become a session is re-read on every poll forever, and every poll costs a
   * run. Anything skipped has already been reported into the thread, which is the
   * place its author is reading.
   */
  const dealtWith = [...taking].sort((a, b) => (a.ts < b.ts ? -1 : 1)).at(-1)?.ts

  const next = await deliveryStore.update((current) => {
    current.commandsError = readError
    if (dealtWith) {
      current.commandsCursor = dealtWith
      current.lastCommandAt = now

      const today = dayKey(now)
      const count = current.commandsToday?.day === today ? current.commandsToday.count : 0
      current.commandsToday = { day: today, count: count + taking.length }
    }
    return { ...current }
  })

  if (result.started.length) {
    await notify(
      'finished',
      `Started ${result.started.length} ${result.started.length === 1 ? 'session' : 'sessions'} from Slack`,
      result.started.map(entry => entry.title).join(', '),
      '/work',
    )
  }

  console.log(`[commands] ${result.started.length} started, ${result.skipped.length} skipped`
    + (costUsd ? `, $${costUsd.toFixed(2)}` : '')
    + `, ${Date.now() - startedAt}ms`)

  return { ok: true, result, state: next }
}

/**
 * Turn one reply into a session.
 *
 * The text is the instruction, verbatim and uninterpreted — exactly what it would
 * be had it been typed into the box on the sessions page. Nothing here reads it,
 * summarises it or decides whether it is reasonable, because there is no version
 * of that judgement this app could make better than the person who wrote it.
 */
async function startFromReply(
  command: ThreadReply,
  repoDir: string,
): Promise<{ sessionId: string; title: string; ts: string } | { error: string }> {
  try {
    const session = await startSession({ repoDir, title: titleFromPrompt(command.text) })

    try {
      await startTurn(session, command.text)
    } catch (e: any) {
      // The worktree exists by now, so this is a session you have rather than
      // nothing — the same call the sessions route makes, and for the same
      // reason: destroying a real workspace to tidy up an error loses more.
      return {
        error: `A session was created but could not start working: `
          + `${e?.data?.message ?? e?.message ?? 'unknown error'}`,
      }
    }

    return { sessionId: session.id, title: session.title, ts: command.ts }
  } catch (e: any) {
    return { error: `Could not start a session: ${e?.data?.message ?? e?.message ?? 'unknown error'}` }
  }
}

/**
 * Say what was done with the instruction, under the instruction.
 *
 * Not a nicety. This is the only feedback anybody typing into Slack gets, and
 * without it the feature is a hole you drop sentences into — a reply that was
 * never read looks exactly like one that started a session two minutes ago.
 *
 * A failure to confirm is deliberately not a failure of the command: the session
 * is already running, and reporting otherwise would send somebody looking for
 * work that is in fact underway.
 */
async function confirm(
  state: DigestDelivery,
  projectDir: string,
  command: ThreadReply,
  outcome: { sessionId: string; title: string } | { error: string },
): Promise<void> {
  const text = 'error' in outcome
    ? `:warning: Could not act on that. ${outcome.error}`
    : `:hourglass_flowing_sand: Started *${outcome.title}* on its own branch. `
      + 'Nothing will be merged or pushed without you.'

  try {
    await postToSlack(state, text, projectDir, { threadTs: state.threadTs })
  } catch (e: any) {
    console.log(`[commands] could not confirm ${command.ts}: ${e?.message ?? e}`)
  }
}

/** A read in flight, so a slow one cannot stack up behind the poll. */
let reading = false

/**
 * The poll, for a machine that was told to listen.
 *
 * Rides the same timer as the event triggers and the inbox. Everything expensive
 * is behind `commandsRefusal`, which is a file read and false until somebody has
 * turned this on, sent a report by hand, and pointed it at a direct message —
 * so the common case costs nothing.
 */
export async function tickDigestCommands(now = Date.now()): Promise<void> {
  if (reading) return

  const state = await readDelivery()
  if (commandsRefusal(state)) return

  reading = true
  try {
    const outcome = await readCommands(now)
    if (!outcome.ok) console.log(`[commands] skipped: ${outcome.refusal.error}`)
  } catch (e: any) {
    console.log(`[commands] failed: ${e?.message ?? e}`)
  } finally {
    reading = false
  }
}
