import { escapeMrkdwn, windowLabel } from './digestMessage'
import type { LedgerEntry, LedgerMachineReport } from './sharedLedger'

/**
 * One message a day about what the team shipped.
 *
 * The personal morning report is the model to copy and its four carefulnesses
 * are copied wholesale — nothing on a quiet day, nothing scheduled until a send
 * has worked by hand, the destination resolved to an id once, and a window that
 * covers everything since the last message rather than a calendar day. A team
 * channel needs all four harder than a DM does: a daily "all quiet" is how a
 * channel gets muted, and a muted channel loses the feature entirely.
 *
 * Two things about the content are decisions rather than details:
 *
 *   - **It reads the shared ledger, not this machine.** `sharedLedger.ts` is the
 *     only thing here that knows what anybody else did, so it is the only honest
 *     source for a message about "the team". A digest assembled from one laptop
 *     would report one laptop's day under a plural pronoun.
 *   - **A machine that has not reported is named, not averaged over.** Three
 *     days of silence from somebody's laptop is the most useful line in the
 *     message on the day it appears, and the easiest thing to accidentally hide
 *     behind a total.
 *
 * What it deliberately cannot say yet is in the brief's findings: the ledger
 * carries outcomes, not attention, so "blocked and on whom" and "rituals that
 * stopped working" have no lines to read. Better an absent band than a band
 * assembled from this machine's own state and labelled as the team's.
 */

/** Past this a machine is reported as quiet rather than counted as current. */
export const STALE_MACHINE_MS = 2 * 86_400_000

/** Enough rows to be worth reading; past this the count carries it. */
const MAX_ROWS = 6

export interface TeamShipped {
  /** The repository, by the name the ledger carries. */
  repo: string
  landings: number
  /** Of those, taken back out since. */
  reverts: number
  /** `personKey` — an address — to how many they landed. Named people only. */
  by: { person: string; landings: number }[]
}

export interface TeamMachineLine {
  machine: string
  lastAt?: number
  /** How long since it last had anything to say, in whole hours. */
  quietForMs?: number
}

export interface TeamDigest {
  since: number
  until: number
  costUsd: number
  turns: number
  landings: number
  reverts: number
  checks: { passing: number; failing: number }
  shipped: TeamShipped[]
  /** Named people, most landings first. */
  people: { person: string; landings: number; costUsd: number }[]
  /** Machines that have gone quiet. Current ones are not worth a line. */
  quiet: TeamMachineLine[]
  /** How many machines reported at all. */
  machines: number
}

/**
 * The digest, from the ledger's own lines.
 *
 * Pure over entries and machine reports, so every number in the message can be
 * traced to a line in a file — which is the property that makes a team-wide
 * figure arguable-with rather than something to take on trust.
 */
export function buildTeamDigest(
  entries: LedgerEntry[],
  machines: LedgerMachineReport[],
  opts: { since: number; now: number },
): TeamDigest {
  const inWindow = entries.filter(entry => entry.at >= opts.since && entry.at <= opts.now)

  const digest: TeamDigest = {
    since: opts.since,
    until: opts.now,
    costUsd: 0,
    turns: 0,
    landings: 0,
    reverts: 0,
    checks: { passing: 0, failing: 0 },
    shipped: [],
    people: [],
    quiet: [],
    machines: machines.length,
  }

  const byRepo = new Map<string, TeamShipped>()
  const byPerson = new Map<string, { landings: number; costUsd: number }>()

  for (const entry of inWindow) {
    const person = entry.person
    const held = person ? byPerson.get(person) ?? { landings: 0, costUsd: 0 } : undefined

    if (entry.event === 'turn') {
      digest.turns++
      digest.costUsd = round(digest.costUsd + (entry.costUsd ?? 0))
      if (held) held.costUsd = round(held.costUsd + (entry.costUsd ?? 0))
    }

    if (entry.event === 'landing') {
      digest.landings++
      if (held) held.landings++

      // A landing with no repository named still counts in the total; it just
      // has nowhere to sit in the breakdown, the same way every other dimension
      // in this app treats an absent value.
      if (entry.repo) {
        const shipped = byRepo.get(entry.repo) ?? { repo: entry.repo, landings: 0, reverts: 0, by: [] }
        shipped.landings++
        if (person) {
          const row = shipped.by.find(candidate => candidate.person === person)
          if (row) row.landings++
          else shipped.by.push({ person, landings: 1 })
        }
        byRepo.set(entry.repo, shipped)
      }
    }

    if (entry.event === 'revert') {
      digest.reverts++
      if (entry.repo) {
        const shipped = byRepo.get(entry.repo) ?? { repo: entry.repo, landings: 0, reverts: 0, by: [] }
        shipped.reverts++
        byRepo.set(entry.repo, shipped)
      }
    }

    if (entry.event === 'check') {
      if (entry.verdict === 'passing') digest.checks.passing++
      else if (entry.verdict === 'failing') digest.checks.failing++
    }

    if (person && held) byPerson.set(person, held)
  }

  digest.shipped = [...byRepo.values()]
    .sort((a, b) => b.landings - a.landings || a.repo.localeCompare(b.repo))
    .slice(0, MAX_ROWS)
    .map(shipped => ({ ...shipped, by: shipped.by.sort((a, b) => b.landings - a.landings) }))

  digest.people = [...byPerson.entries()]
    .map(([person, held]) => ({ person, ...held }))
    .sort((a, b) => b.landings - a.landings || b.costUsd - a.costUsd)
    .slice(0, MAX_ROWS)

  digest.quiet = machines
    .filter(machine => !machine.lastAt || opts.now - machine.lastAt > STALE_MACHINE_MS)
    .map(machine => ({
      machine: machine.machine,
      lastAt: machine.lastAt,
      quietForMs: machine.lastAt ? opts.now - machine.lastAt : undefined,
    }))
    .sort((a, b) => (b.quietForMs ?? Infinity) - (a.quietForMs ?? Infinity))

  return digest
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/**
 * Whether there is anything worth a message.
 *
 * The rule the personal report arrived at, applied harder. Landings, reverts and
 * failing checks are news. Spend on its own is not: a day where three people
 * each burned four dollars and shipped nothing is a day the ledger page is for,
 * and a channel told about it daily learns to skip the message.
 *
 * A machine that has gone quiet *is* news, but only on its own it would fire a
 * message every morning for as long as somebody is on holiday — so it rides
 * along with real news rather than triggering one.
 */
export function shouldSendTeam(digest: TeamDigest): { send: true } | { send: false; because: string } {
  if (digest.landings) return { send: true }
  if (digest.reverts) return { send: true }
  if (digest.checks.failing) return { send: true }

  if (digest.turns) {
    return {
      send: false,
      because: `${digest.turns} turn${digest.turns === 1 ? '' : 's'} and nothing landed, `
        + 'so there is nothing a channel needs to be told.',
    }
  }

  return { send: false, because: 'Nothing happened anywhere since the last message.' }
}

/**
 * The message, as Slack mrkdwn.
 *
 * Composed here in full and sent verbatim — the run that posts it is handed a
 * finished string and denied every other way of writing to Slack, so nothing a
 * model decides can change what a channel reads.
 */
export function renderTeamDigest(digest: TeamDigest, opts: { url?: string } = {}): string {
  const lines: string[] = []

  lines.push(`*What we shipped* · ${windowLabel(digest.since, digest.until)}`)
  lines.push('')

  const headline = [
    `${digest.landings} merged`,
    digest.reverts ? `${digest.reverts} taken back out` : '',
    digest.checks.failing ? `${digest.checks.failing} failing check${digest.checks.failing === 1 ? '' : 's'}` : '',
    `$${digest.costUsd.toFixed(2)} across ${digest.turns} turn${digest.turns === 1 ? '' : 's'}`,
  ].filter(Boolean)
  lines.push(headline.join(' · '))

  if (digest.shipped.length) {
    lines.push('')
    for (const shipped of digest.shipped) {
      const who = shipped.by.length
        ? ` — ${shipped.by.map(row => `${escapeMrkdwn(row.person)} ${row.landings}`).join(', ')}`
        : ''
      const back = shipped.reverts ? ` (${shipped.reverts} reverted)` : ''
      lines.push(`• *${escapeMrkdwn(shipped.repo)}*: ${shipped.landings} merged${back}${who}`)
    }
  }

  if (digest.quiet.length) {
    lines.push('')
    for (const machine of digest.quiet) {
      lines.push(`• _${escapeMrkdwn(machine.machine)}_ has not reported ${quietFor(machine.quietForMs)}`)
    }
  }

  /*
   * Said once, at the bottom. Every figure above is as indicative as the records
   * it is built from — on a subscription nothing is billed per turn — and a
   * caveat on each number would be noise while saying it nowhere would imply a
   * precision the ledger does not have.
   */
  lines.push('')
  lines.push(
    `_From ${digest.machines} machine${digest.machines === 1 ? '' : 's'}' own ledgers, `
    + 'as far as each has pushed. Dollars are indicative._',
  )

  if (opts.url) lines.push(`<${opts.url}|Open the ledger>`)

  return lines.join('\n')
}

function quietFor(ms?: number): string {
  if (ms === undefined) return 'at all'

  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `for ${days} day${days === 1 ? '' : 's'}`

  const hours = Math.max(1, Math.floor(ms / 3_600_000))
  return `for ${hours} hour${hours === 1 ? '' : 's'}`
}
