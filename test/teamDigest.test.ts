import { describe, expect, it } from 'vitest'
import {
  buildTeamDigest,
  renderTeamDigest,
  shouldSendTeam,
  STALE_MACHINE_MS,
} from '../server/utils/teamDigest'
import {
  DEFAULT_TEAM_DELIVERY,
  dueForTeamDelivery,
  teamCommandsRefusal,
  windowForTeam,
  type TeamDelivery,
} from '../server/utils/teamDelivery'
import type { LedgerEntry, LedgerMachineReport } from '../server/utils/sharedLedger'

/**
 * One message a day to a room other people are in.
 *
 * The personal report's four carefulnesses matter more here than they do there,
 * and for a reason that is not about correctness: a channel told "all quiet"
 * every morning gets muted, and a muted channel has lost the feature. So the
 * cases worth pinning are the ones where it must say *nothing* — and the one
 * where it must refuse something outright, because a channel is a room anybody
 * can post in.
 */

const NOW = 1_700_000_000_000
const HOUR = 3_600_000
const DAY = 86_400_000

function entry(over: Partial<LedgerEntry> & { event: LedgerEntry['event'] }): LedgerEntry {
  return { v: 1, id: `${over.event}:${Math.abs(over.at ?? 0)}`, at: NOW - HOUR, ...over } as LedgerEntry
}

function machine(name: string, lastAt?: number): LedgerMachineReport {
  return {
    machine: name,
    entries: 1,
    lastAt,
    corrupt: 0,
    newer: 0,
    totals: { turns: 0, costUsd: 0, landings: 0, reverts: 0, checks: { passing: 0, failing: 0 } },
  }
}

const window = { since: NOW - DAY, now: NOW }

describe('a quiet day', () => {
  it('says nothing at all when nothing happened anywhere', () => {
    const digest = buildTeamDigest([], [machine('laptop-aa', NOW - HOUR)], window)

    expect(shouldSendTeam(digest)).toEqual({
      send: false,
      because: 'Nothing happened anywhere since the last message.',
    })
  })

  it('says nothing when there was work but nothing landed', () => {
    // The case that would otherwise mute the channel: three people busy, nothing
    // shipped. That is what the ledger page is for.
    const digest = buildTeamDigest(
      [entry({ event: 'turn', costUsd: 4, person: 'ada@example.com' })],
      [machine('laptop-aa', NOW - HOUR)],
      window,
    )

    const verdict = shouldSendTeam(digest)
    expect(verdict.send).toBe(false)
    expect('because' in verdict && verdict.because).toContain('nothing landed')
  })

  it('speaks up for a landing, a revert or a failing check', () => {
    for (const one of [
      entry({ event: 'landing', landing: 'merged' }),
      entry({ event: 'revert' }),
      entry({ event: 'check', verdict: 'failing' }),
    ]) {
      expect(shouldSendTeam(buildTeamDigest([one], [], window)).send).toBe(true)
    }
  })

  it('does not speak up for a quiet machine on its own', () => {
    // Otherwise it fires every morning for as long as somebody is on holiday.
    const digest = buildTeamDigest([], [machine('desktop-bb', NOW - 5 * DAY)], window)

    expect(digest.quiet).toHaveLength(1)
    expect(shouldSendTeam(digest).send).toBe(false)
  })
})

describe('one machine reporting', () => {
  const entries: LedgerEntry[] = [
    entry({ event: 'turn', costUsd: 3.5, person: 'ada@example.com', repo: 'webapp' }),
    entry({ event: 'landing', at: NOW - 2 * HOUR, landing: 'merged', person: 'ada@example.com', repo: 'webapp' }),
    entry({ event: 'landing', at: NOW - 3 * HOUR, landing: 'pull-request', person: 'ada@example.com', repo: 'webapp' }),
    entry({ event: 'landing', at: NOW - 4 * HOUR, landing: 'merged', person: 'grace@example.com', repo: 'api' }),
    entry({ event: 'revert', at: NOW - 90 * 60_000, repo: 'webapp' }),
    entry({ event: 'check', at: NOW - 5 * HOUR, verdict: 'failing' }),
  ]

  it('counts what shipped, by repository and by person', () => {
    const digest = buildTeamDigest(entries, [machine('laptop-aa', NOW - HOUR)], window)

    expect(digest).toMatchObject({ landings: 3, reverts: 1, turns: 1, costUsd: 3.5 })
    expect(digest.checks).toEqual({ passing: 0, failing: 1 })
    expect(digest.shipped.map(s => [s.repo, s.landings, s.reverts])).toEqual([
      ['webapp', 2, 1], ['api', 1, 0],
    ])
    expect(digest.people.map(p => p.person)).toEqual(['ada@example.com', 'grace@example.com'])
  })

  it('renders one message a channel can read', () => {
    const message = renderTeamDigest(buildTeamDigest(entries, [machine('laptop-aa', NOW - HOUR)], window))

    expect(message).toContain('*What we shipped*')
    expect(message).toContain('3 merged')
    expect(message).toContain('1 taken back out')
    expect(message).toContain('*webapp*: 2 merged (1 reverted)')
    expect(message).toContain('ada@example.com 2')
    // Said once, at the bottom, rather than beside every figure.
    expect(message).toContain('Dollars are indicative')
  })

  it('counts a landing with no repository in the total and not in the breakdown', () => {
    const digest = buildTeamDigest(
      [entry({ event: 'landing', landing: 'merged', person: 'ada@example.com' })],
      [],
      window,
    )

    expect(digest.landings).toBe(1)
    expect(digest.shipped).toEqual([])
  })

  it('leaves anything outside the window out', () => {
    const digest = buildTeamDigest(
      [entry({ event: 'landing', at: NOW - 5 * DAY, landing: 'merged', repo: 'webapp' })],
      [],
      window,
    )

    expect(digest.landings).toBe(0)
  })
})

describe('a machine that has not reported in three days', () => {
  it('is named rather than averaged over', () => {
    const digest = buildTeamDigest(
      [entry({ event: 'landing', landing: 'merged', repo: 'webapp' })],
      [machine('laptop-aa', NOW - HOUR), machine('desktop-bb', NOW - 3 * DAY)],
      window,
    )

    expect(digest.quiet.map(q => q.machine)).toEqual(['desktop-bb'])
    expect(renderTeamDigest(digest)).toContain('desktop-bb_ has not reported for 3 days')
  })

  it('says so about a machine that has never reported at all', () => {
    const digest = buildTeamDigest(
      [entry({ event: 'landing', landing: 'merged', repo: 'webapp' })],
      [machine('empty-cc')],
      window,
    )

    expect(renderTeamDigest(digest)).toContain('has not reported at all')
  })

  it('leaves a current machine out, because a working machine is not news', () => {
    const digest = buildTeamDigest([], [machine('laptop-aa', NOW - STALE_MACHINE_MS + HOUR)], window)

    expect(digest.quiet).toEqual([])
  })
})

describe('a reply attempted from a channel', () => {
  it('is refused, in words, always', () => {
    const state: TeamDelivery = {
      ...DEFAULT_TEAM_DELIVERY,
      destination: '#shipping',
      channelId: 'C012AB3CD',
      channelLabel: '#shipping',
    }

    const refusal = teamCommandsRefusal(state)

    expect(refusal).toContain('#shipping')
    expect(refusal).toContain('can never command')
    expect(refusal).toContain('not read, at all')
    // And it points at the thing that does read replies, so the sentence is
    // useful rather than only a no.
    expect(refusal).toContain('direct message')
  })

  it('is refused even before anything has been sent, and reads as a sentence', () => {
    const refusal = teamCommandsRefusal(DEFAULT_TEAM_DELIVERY)

    expect(refusal).toContain('can never command')
    // An unset destination is an empty string rather than null, which once left
    // the sentence starting with a space.
    expect(refusal.startsWith('A team destination')).toBe(true)
  })

  it('has no switch to turn on', () => {
    // Structural rather than a default: there is no `commands` field to set.
    expect('commands' in DEFAULT_TEAM_DELIVERY).toBe(false)
  })
})

describe('the schedule', () => {
  const armed: TeamDelivery = {
    enabled: true,
    at: '09:00',
    destination: '#shipping',
    projectDir: '/w/app',
    channelId: 'C1',
  }

  const at = (hours: number) => new Date(NOW).setHours(hours, 30, 0, 0)

  it('does not fire until somebody turns it on', () => {
    expect(dueForTeamDelivery({ ...armed, enabled: false }, at(10))).toBe(false)
  })

  it('does not fire until a send has worked by hand', () => {
    // No channel id and no project means nothing has ever gone out, so there is
    // nowhere to send and nowhere to ask from.
    expect(dueForTeamDelivery({ ...armed, channelId: undefined }, at(10))).toBe(false)
    expect(dueForTeamDelivery({ ...armed, projectDir: undefined }, at(10))).toBe(false)
  })

  it('fires once the hour has passed and not before', () => {
    expect(dueForTeamDelivery(armed, at(8))).toBe(false)
    expect(dueForTeamDelivery(armed, at(10))).toBe(true)
  })

  it('does not fire twice for one day, whether it sent or skipped', () => {
    const now = at(10)

    expect(dueForTeamDelivery({ ...armed, lastSentAt: now - 60_000 }, now)).toBe(false)
    expect(dueForTeamDelivery({ ...armed, lastSkippedAt: now - 60_000 }, now)).toBe(false)
  })

  it('covers everything since the channel was last told', () => {
    const told = NOW - 3 * DAY

    // A quiet day moved the window on, so the gap does not become a gap in what
    // the channel was told.
    expect(windowForTeam({ ...armed, lastSkippedAt: told }, NOW)).toBe(told)
  })

  it('never covers less than a day or more than a week', () => {
    expect(windowForTeam({ ...armed, lastSentAt: NOW - 60_000 }, NOW)).toBe(NOW - DAY)
    expect(windowForTeam({ ...armed, lastSentAt: NOW - 30 * DAY }, NOW)).toBe(NOW - 7 * DAY)
  })
})
