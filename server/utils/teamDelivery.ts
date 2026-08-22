import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { DEFAULT_WINDOW_MS } from './digest'
import type { DigestDelivery } from './digestDelivery'
import { postToSlack } from './digestSend'
import { parseTimeOfDay } from './inbox'
import { defineJsonStore } from './jsonStore'
import { studioUrl } from './notify'
import { ledgerEntriesIn, readLedgerFiles, teamLedger } from './sharedLedger'
import { buildTeamDigest, renderTeamDigest, shouldSendTeam, type TeamDigest } from './teamDigest'
import { findInboxSource, pickInboxServer } from './inbox'
import { listMcpServers } from './mcp'

/**
 * The team digest's own settings, its own schedule, and its own destination.
 *
 * A second store rather than a second mode on the first, because the two are
 * different messages to different places with different rules — and one record
 * holding both would have a `commands` flag that means something for one
 * destination and must never mean anything for the other. Separate stores make
 * that structural instead of conditional.
 *
 * Everything the personal report learned is carried over unchanged: off until
 * somebody turns it on, no schedule until a send has worked by hand, the
 * destination resolved to an id once and used by id afterwards, and a window
 * that covers everything since the last message. See `digestDelivery.ts` for the
 * reasoning behind each; none of it is re-argued here.
 *
 * The one rule that is *stronger* here is the one the brief insists on: **a
 * channel can receive and can never command.** The personal report reads replies
 * only in a direct message, and refuses a channel in words. This one has no
 * reply path at all — not a switch that is off, an absence — because the whole
 * point of it is to go somewhere other people can post.
 */

export interface TeamDelivery {
  enabled: boolean
  /** Local time of day, `HH:MM`. Absent means by hand only. */
  at?: string
  /** Where it goes, in your own words — "#shipping". Resolved once. */
  destination: string
  /** The project it is asked from: which MCP servers answer depends on it. */
  projectDir?: string
  /** What a send resolved. After the first send, the id is what is used. */
  channelId?: string
  channelLabel?: string
  /** When a message last actually went out. What the schedule counts against. */
  lastSentAt?: number
  /** When it was due, looked, and found nothing worth saying. */
  lastSkippedAt?: number
  lastSkippedWhy?: string
  lastError?: string
  costUsd?: number
  durationMs?: number
}

export const DEFAULT_TEAM_DELIVERY: TeamDelivery = {
  enabled: false,
  destination: '',
}

export const teamDeliveryStore = defineJsonStore<TeamDelivery>({
  label: 'team digest',
  path: () => join(getClaudeDir(), 'agents-ui', 'team-digest.json'),
  empty: () => ({ ...DEFAULT_TEAM_DELIVERY }),
  decode: parsed => ({ ...DEFAULT_TEAM_DELIVERY, ...(parsed?.delivery ?? {}) }),
  encode: delivery => ({ version: 1, delivery }),
})

export async function readTeamDelivery(): Promise<TeamDelivery> {
  try {
    return await teamDeliveryStore.read()
  } catch {
    // Unreadable settings mean do not send, which is the safe direction for
    // anything that posts where other people can read it.
    return { ...DEFAULT_TEAM_DELIVERY }
  }
}

/**
 * Why replies to this message are not read — always, and by construction.
 *
 * Kept as a function that returns a sentence rather than as an absent feature,
 * because "this cannot happen" is worth being able to *show* somebody in the
 * place they would look for the switch. A channel is a room other people can
 * post in; a reply in one that started work on your repository would be a
 * command anybody in the room could give.
 */
export function teamCommandsRefusal(state: TeamDelivery): string {
  // `||` rather than `??`: an unset destination is an empty string, not null,
  // and `??` let it through — the sentence then began with a space.
  const where = state.channelLabel || state.destination || 'A team destination'

  return `${where} receives this message and can never command anything. Replies here are not `
    + 'read, at all: anybody who can post in a channel could otherwise start work on your '
    + 'repository. The morning report to a direct message is the one that reads replies.'
}

/** Whether to send without being asked. The personal report's rule, unchanged. */
export function dueForTeamDelivery(state: TeamDelivery, now: number): boolean {
  if (!state.enabled) return false

  const at = parseTimeOfDay(state.at)
  if (!at) return false

  // The proof that a send has worked by hand. Guessing at either is how a
  // message ends up somewhere nobody chose.
  if (!state.projectDir || !state.channelId) return false

  const occurrence = new Date(now)
  occurrence.setHours(at.hours, at.minutes, 0, 0)
  if (now < occurrence.getTime()) return false

  const dealtWith = Math.max(state.lastSentAt ?? 0, state.lastSkippedAt ?? 0)
  return dealtWith < occurrence.getTime()
}

const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Everything since the channel was last told, clamped to between a day and a week. */
export function windowForTeam(state: TeamDelivery, now: number): number {
  const told = Math.max(state.lastSentAt ?? 0, state.lastSkippedAt ?? 0)
  const since = told || now - DEFAULT_WINDOW_MS

  return Math.min(Math.max(since, now - MAX_WINDOW_MS), now - DEFAULT_WINDOW_MS)
}

/** The digest for a window, read off the shared ledger's files. */
export async function buildTeamDigestNow(since: number, now: number): Promise<TeamDigest> {
  const files = await readLedgerFiles()

  return buildTeamDigest(ledgerEntriesIn(files), teamLedger(files).machines, { since, now })
}

export interface TeamSendOutcome {
  ok: boolean
  sent?: boolean
  because?: string
  refusal?: { error: string; message: string }
  state?: TeamDelivery
  /** What went out, so a page can show exactly what a channel was told. */
  message?: string
}

/**
 * Compose and send, or say why not.
 *
 * `force` is what the button passes: somebody who pressed it gets a message even
 * on a quiet day, because an empty response to a press reads as broken software.
 * The schedule never forces.
 *
 * The message is composed in full here and handed to `postToSlack` as a finished
 * string — the same posting path the personal report uses, with the same
 * allow-list and the same denials, so nothing a model decides can change what a
 * channel reads or reach anything else in Slack.
 */
export async function sendTeamDigest(
  opts: { projectDir?: string; destination?: string; force?: boolean; now?: number } = {},
): Promise<TeamSendOutcome> {
  const now = opts.now ?? Date.now()
  const state = await readTeamDelivery()
  const projectDir = opts.projectDir ?? state.projectDir
  const destination = opts.destination ?? state.destination

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

  if (!destination.trim()) {
    return {
      ok: false,
      refusal: { error: 'no_destination', message: 'Say where it should go — a channel name is enough.' },
    }
  }

  // The same judgement the inbox and the personal report make, so Slack being
  // misconfigured says one sentence everywhere rather than three.
  const slack = findInboxSource('slack')
  const servers = await listMcpServers(projectDir).catch(() => [])
  const choice = slack ? pickInboxServer(slack, servers) : { refusal: 'Slack is not a known source.' }

  if ('refusal' in choice) {
    await teamDeliveryStore.update((current) => { current.lastError = choice.refusal })
    return { ok: false, refusal: { error: 'slack_unavailable', message: choice.refusal } }
  }

  const since = windowForTeam(state, now)
  const digest = await buildTeamDigestNow(since, now)
  const verdict = shouldSendTeam(digest)

  if (!verdict.send && !opts.force) {
    /*
     * A skip is recorded rather than silent, and it moves the window on: the next
     * message covers from here, so a quiet day does not become a gap in what the
     * channel was told. It costs nothing — the digest came from local files and
     * no run happened.
     */
    const next = await teamDeliveryStore.update((current) => {
      current.lastSkippedAt = now
      current.lastSkippedWhy = verdict.because
      current.lastError = undefined
      current.costUsd = undefined
      current.durationMs = undefined
      return { ...current }
    })

    return { ok: true, sent: false, because: verdict.because, state: next }
  }

  const message = renderTeamDigest(digest, { url: studioUrl('/work') })

  /*
   * Handed the personal report's own record shape, with the reply fields empty.
   * `postToSlack` reads `destination`, `channelId` and `threadTs` and nothing
   * else — and `threadTs` is deliberately never set here, so this message is
   * never a thread anything replies into.
   */
  const asDelivery: DigestDelivery = {
    enabled: state.enabled,
    destination,
    projectDir,
    channelId: state.channelId,
    channelLabel: state.channelLabel,
    commands: false,
  }

  const post = await postToSlack(asDelivery, message, projectDir)

  const next = await teamDeliveryStore.update((current) => {
    current.projectDir = projectDir
    current.destination = destination
    current.durationMs = post.durationMs
    current.costUsd = post.costUsd
    current.lastError = post.error

    if (post.sent) {
      current.lastSentAt = now
      // Only ever set by a send that worked, so a failed attempt cannot repoint
      // the destination — the id is what stops it drifting.
      current.channelId = post.parsed.channel
      current.channelLabel = post.parsed.channelLabel ?? current.channelLabel
      current.lastSkippedWhy = undefined
    }

    return { ...current }
  })

  return post.sent
    ? { ok: true, sent: true, state: next, message }
    : { ok: false, refusal: { error: 'send_failed', message: post.error ?? 'The message did not go out.' }, state: next }
}

/**
 * The scheduled send. Nothing here arms itself — `dueForTeamDelivery` is false
 * until somebody turned it on *and* a send has worked by hand.
 */
export async function tickTeamDigest(now = Date.now()): Promise<void> {
  const state = await readTeamDelivery()
  if (!dueForTeamDelivery(state, now)) return

  try {
    await sendTeamDigest({ projectDir: state.projectDir, now })
  } catch {
    // Never worth taking a tick down for. The error is recorded on the store by
    // the send itself where it got that far.
  }
}
