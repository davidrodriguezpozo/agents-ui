import { runClaude } from './cli'
import { listMcpServers } from './mcp'
import { findInboxSource, pickInboxServer, describeRunFailure, salvageEnvelope, type RunEnvelope } from './inbox'
import { buildDigest } from './digest'
import { renderDigest, shouldSend } from './digestMessage'
import { studioUrl } from './notify'
import {
  buildDeliveryPrompt, deliveryModel, deliveryStore, deliveryTimeoutMs, deliveryTurns,
  DELIVERY_DENIED_TOOLS, DELIVERY_TOOLS, dueForDelivery, parseDeliveryReply, readDelivery,
  windowFor, type DigestDelivery,
} from './digestDelivery'

/**
 * Actually sending it.
 *
 * Split from `digestDelivery` the way `inboxRefresh` is split from `inbox`, and
 * for the same reason: a person pressing the button and the clock reaching 08:15
 * have to do exactly the same thing, and the alternative — having the scheduler
 * make an HTTP request to the server it is running inside — works until the port
 * changes.
 *
 * Refusals come back as values rather than exceptions, because both callers need
 * to say why: the route turns one into a status code, the scheduler writes it
 * where the last error is shown. What they share is the promise in the message —
 * a refusal spends nothing.
 */

export type SendRefusal =
  | { error: 'no_project'; message: string }
  | { error: 'slack_unavailable'; message: string }

export type SendOutcome =
  | { ok: true; sent: true; state: DigestDelivery }
  /** It looked, and there was nothing worth saying. Nothing was spent. */
  | { ok: true; sent: false; because: string; state: DigestDelivery }
  | { ok: false; refusal: SendRefusal }

/**
 * Write a refusal where it will be read.
 *
 * Same reasoning as the inbox's: without this, a refusal is a toast and the row
 * goes on showing whatever it last said — so a feature that has been unable to
 * send for a week reads as one that sent successfully a week ago.
 */
async function recordRefusal(message: string): Promise<DigestDelivery> {
  return deliveryStore.update((state) => {
    state.lastError = message
    // Not a run, so attributing the last one's numbers to it would be a lie.
    state.costUsd = undefined
    state.durationMs = undefined
    return { ...state }
  })
}

/**
 * Compose and send, or say why not.
 *
 * `force` is what the button passes: somebody who asked for a message gets one
 * even on a quiet morning, because an empty response to a press reads as broken
 * software. The schedule never forces — see `shouldSend`.
 */
export async function sendDigest(
  opts: { projectDir?: string; force?: boolean; now?: number } = {},
): Promise<SendOutcome> {
  const now = opts.now ?? Date.now()
  const state = await readDelivery()
  const projectDir = opts.projectDir ?? state.projectDir

  if (!projectDir) {
    return {
      ok: false,
      refusal: {
        error: 'no_project',
        message: 'Pick a project first. Which tools Claude can reach depends on the directory '
          + 'it is asked from, so there is nowhere to ask from yet.',
      },
    }
  }

  /*
   * Check before spending, and check the same way the inbox does.
   *
   * `pickInboxServer` against the Slack source is not a shortcut — it is the
   * judgement this app has already paid to learn. A claude.ai connector reports
   * Connected and hands an unattended run no tools at all, which is a charge for
   * discovering that nothing could be sent. Reusing it also means Slack being
   * misconfigured says the same sentence in both features, which is the sentence
   * that has been tested against real machines.
   */
  const slack = findInboxSource('slack')
  const servers = await listMcpServers(projectDir).catch(() => [])
  const choice = slack ? pickInboxServer(slack, servers) : { refusal: 'Slack is not a known source.' }

  if ('refusal' in choice) {
    await recordRefusal(choice.refusal)
    return { ok: false, refusal: { error: 'slack_unavailable', message: choice.refusal } }
  }

  const since = windowFor(state, now)
  const digest = await buildDigest(since)

  const verdict = shouldSend(digest)
  if (!verdict.send && !opts.force) {
    /*
     * A skip is recorded, not silent.
     *
     * It moves the window on — the next send covers from here, not from the last
     * message — and it stops the tick reconsidering the same quiet morning every
     * two minutes. It costs nothing: the digest is assembled from local files
     * and no run happened.
     */
    const next = await deliveryStore.update((current) => {
      current.lastSkippedAt = now
      current.lastSkippedWhy = verdict.because
      current.lastError = undefined
      current.costUsd = undefined
      current.durationMs = undefined
      return { ...current }
    })

    return { ok: true, sent: false, because: verdict.because, state: next }
  }

  const message = renderDigest(digest, { now, url: studioUrl('/') })
  const prompt = buildDeliveryPrompt(state, message)

  const startedAt = Date.now()
  let reply = ''
  let costUsd: number | undefined
  let failure: string | undefined

  try {
    const { stdout } = await runClaude(
      [
        '-p', prompt,
        '--output-format', 'json',
        ...(deliveryModel(state) ? ['--model', deliveryModel(state)!] : []),
        // Allow-listed so the send does not sit waiting for a permission prompt
        // nobody is present to answer; denied so that being confused about the
        // job cannot turn into a canvas, a new channel or a message that
        // outlives this app. See `DELIVERY_DENIED_TOOLS`.
        '--allowedTools', ...DELIVERY_TOOLS,
        '--disallowedTools', ...DELIVERY_DENIED_TOOLS,
        '--max-turns', String(deliveryTurns(state)),
      ],
      { cwd: projectDir, timeout: deliveryTimeoutMs(state) },
    )

    const envelope = JSON.parse(stdout) as RunEnvelope
    reply = envelope.result ?? ''
    costUsd = envelope.total_cost_usd

    // Read against the write tool alone. A run refused `slack_search_channels`
    // when it already had an id was refused something it did not need, and
    // counting that would report a successful send as a failure.
    failure = describeRunFailure(envelope, DELIVERY_TOOLS.filter(t => t.endsWith('slack_send_message')))
  } catch (e: any) {
    const salvaged = salvageEnvelope(e?.data?.stdout)
    failure = (salvaged && describeRunFailure(salvaged, DELIVERY_TOOLS))
      || e?.data?.message
      || e?.message
      || 'The send did not finish.'
    costUsd = salvaged?.total_cost_usd ?? costUsd
    reply = salvaged?.result ?? reply
  }

  const parsed = parseDeliveryReply(reply)

  /*
   * A run that failed *and* claims to have sent is believed about the sending.
   *
   * The order matters and it is not obvious. If a run posts the message and then
   * dies formatting its reply, treating that as "not sent" leaves `lastSentAt`
   * unwritten — and the schedule sends the same report again tomorrow on top of
   * the one already in the channel. A duplicate is the one failure mode this
   * cannot correct for you, so a claimed send with a channel id is taken at its
   * word and the trouble is reported beside it.
   */
  const sent = parsed.sent && Boolean(parsed.channel)
  const error = sent ? failure : (failure ?? parsed.error)

  const next = await deliveryStore.update((current) => {
    current.projectDir = projectDir
    current.durationMs = Date.now() - startedAt
    current.costUsd = costUsd
    current.lastError = error

    if (sent) {
      current.lastSentAt = now
      // Only ever widened by a send that worked, so a failed attempt cannot
      // repoint the destination — the id is the thing that stops it drifting.
      current.channelId = parsed.channel
      current.channelLabel = parsed.channelLabel ?? current.channelLabel
      current.lastSkippedWhy = undefined
    }

    return { ...current }
  })

  if (sent) return { ok: true, sent: true, state: next }

  return {
    ok: true,
    sent: false,
    because: error ?? 'It did not send, and gave no reason.',
    state: next,
  }
}

/** A send in flight, so a slow one cannot stack up behind the tick. */
let sending = false

/**
 * The daily send, for the machine that was told to.
 *
 * Rides the scheduler's poll rather than owning a timer — the question "is it
 * time" is a file read and does not deserve one.
 *
 * Nothing here arms itself: `dueForDelivery` is false unless somebody turned it
 * on, set a time, and proved it works by sending one by hand. The ceiling is one
 * message a day, which is the sentence the cost of this feature is bounded by.
 */
export async function tickDigestDelivery(now = Date.now()): Promise<void> {
  if (sending) return

  const state = await readDelivery()
  if (!dueForDelivery(state, now)) return

  sending = true
  try {
    const result = await sendDigest({ projectDir: state.projectDir, now })

    if (!result.ok) {
      // `sendDigest` has already written the reason onto the delivery record, so
      // the morning's silence explains itself where you would look for it.
      console.log(`[digest] not sent: ${result.refusal.error}`)
      return
    }

    if (!result.sent) {
      console.log(`[digest] nothing sent: ${result.because}`)
      return
    }

    const cost = result.state.costUsd
    console.log(`[digest] sent to ${result.state.channelLabel ?? result.state.channelId}`
      + (cost ? `, $${cost.toFixed(2)}` : ''))
  } catch (e: any) {
    // Never let this take down the tick that rituals and pull requests ride on.
    console.log(`[digest] send failed: ${e?.message ?? e}`)
  } finally {
    sending = false
  }
}
