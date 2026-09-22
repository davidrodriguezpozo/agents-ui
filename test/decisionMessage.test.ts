import { describe, expect, it } from 'vitest'
import { CARD_LIMIT, renderDecision, worthSending } from '../server/utils/decisionMessage'
import {
  DECISION_FORMAT, COUNTED_FORMAT, LEDGER_FORMAT, ledgerEntriesOfDecisions, ledgerLine,
  parseLedgerLine,
} from '../server/utils/sharedLedger'
import { deliveryRefusal } from '../server/utils/decisionDelivery'
import type { Decision } from '../server/utils/decisions'
import type { DigestDelivery } from '../server/utils/digestDelivery'

/**
 * A decision, carried to somebody who does not have this app open.
 *
 * Two readers, and the tests are split the way the transports are. Slack gets
 * the prose and is read by a person who may have no checkout, so every line has
 * to carry its own reason. The branch gets ids and counts and is read by a
 * colleague's *machine*, so the assertions there are about what must **not** be
 * in it.
 */

const NOW = Date.parse('2026-09-22T11:00:00Z')

function decision(over: Partial<Decision> = {}): Decision {
  return {
    id: 'd1',
    sessionId: 's1',
    at: NOW,
    source: 'ask_user_question',
    what: 'Which library should we use for date formatting?',
    alternatives: [
      { what: 'date-fns', detail: 'Tree-shakeable, no runtime dependency', chosen: true },
      { what: 'luxon', detail: 'Richer timezone handling' },
    ],
    files: [],
    ...over,
  }
}

describe('renderDecision', () => {
  it('carries the decision, the roads it had, and which was taken', () => {
    const card = renderDecision(decision())!

    expect(card).toContain('Which library should we use for date formatting?')
    expect(card).toContain('date-fns')
    expect(card).toContain('luxon')
    expect(card).toContain('Tree-shakeable, no runtime dependency')
    // The taken road is marked, not merely listed first.
    expect(card).toMatch(/:white_check_mark: date-fns/)
    expect(card).toMatch(/:heavy_minus_sign: luxon/)
  })

  /**
   * The sentence unit 40 defends, made visible. A reviewer seeing an
   * unexplained choice has learned something real; an empty field says nothing.
   */
  it('says "no reason given" rather than leaving the field empty', () => {
    const card = renderDecision(decision())!

    expect(card).toContain('_no reason given_')
    expect(card).not.toMatch(/\*Why:\*\s*$/m)
  })

  it('carries a reason when there is one, and drops the placeholder', () => {
    const card = renderDecision(decision({ reason: 'it has no runtime dependency' }))!

    expect(card).toContain('it has no runtime dependency')
    expect(card).not.toContain('no reason given')
  })

  /**
   * The reader may have no checkout at all — that is the whole audience
   * argument. A card that opens with the name of a tool in a harness they have
   * never heard of has spent its first line explaining this app.
   */
  it('names the occasion in words, never the source key', () => {
    expect(renderDecision(decision())).toContain('Asked, and answered')
    expect(renderDecision(decision())).not.toContain('ask_user_question')
    expect(renderDecision(decision({ source: 'denied' }))).toContain('Refused')
    expect(renderDecision(decision({ source: 'steer' }))).toContain('Corrected mid-work')
    expect(renderDecision(decision({ source: 'marker' }))).toContain('Decided while working')
  })

  it('says what to do with it, because a card cannot be clicked into', () => {
    expect(renderDecision(decision())).toContain('Reply in this thread')
  })

  it('names the session, so the reader knows what work this is about', () => {
    const card = renderDecision(decision(), { sessionTitle: 'Add the decision record' })!
    expect(card).toContain('Add the decision record')
  })

  /** Every title here was written by somebody else. `deploy <staging>` alone
   * swallows the rest of the line into a link Slack cannot resolve. */
  it('escapes the three characters mrkdwn reads as markup', () => {
    const card = renderDecision(decision({ what: 'ship <staging> & wait' }))!
    expect(card).toContain('ship &lt;staging&gt; &amp; wait')
  })

  it('names the files a decision named itself', () => {
    const card = renderDecision(decision({ files: ['server/utils/pool.ts'] }))!
    expect(card).toContain('`server/utils/pool.ts`')
  })

  it('counts the roads it did not print rather than dropping them', () => {
    const many = decision({
      alternatives: Array.from({ length: 7 }, (_, i) => ({ what: `Option ${i}` })),
    })
    const card = renderDecision(many)!

    expect(card).toContain('Option 0')
    expect(card).toContain('_and 3 more_')
    expect(card).not.toContain('Option 6')
  })

  it('renders a decision with no alternatives without an empty list', () => {
    const card = renderDecision(decision({ source: 'marker', alternatives: [] }))!

    expect(card).toContain('Decided while working')
    expect(card).not.toContain(':heavy_minus_sign:')
  })

  it('fits one glance', () => {
    const huge = decision({
      what: 'x'.repeat(4000),
      reason: 'y'.repeat(4000),
      files: Array.from({ length: 40 }, (_, i) => `file-${i}.ts`),
      alternatives: Array.from({ length: 40 }, (_, i) => ({ what: `Option ${i}`, detail: 'z'.repeat(400) })),
    })

    expect(renderDecision(huge)!.length).toBeLessThanOrEqual(CARD_LIMIT)
  })

  it('composes nothing out of a record it cannot describe', () => {
    expect(renderDecision(decision({ what: '   ' }))).toBeNull()
  })
})

describe('worthSending', () => {
  /**
   * A steer that interrupted nothing is an ordinary instruction wearing a
   * decision's clothes. Sending those would train the reader to ignore the
   * channel, which costs more than the one it would have been right about.
   */
  it('does not send a steer that overrode nothing', () => {
    expect(worthSending(decision({ source: 'steer', alternatives: [] }))).toBe(false)
    expect(worthSending(decision({ source: 'steer', alternatives: [{ what: 'Edited pool.ts' }] }))).toBe(true)
  })

  it('sends every other kind, reason or no reason', () => {
    expect(worthSending(decision())).toBe(true)
    expect(worthSending(decision({ source: 'marker', alternatives: [] }))).toBe(true)
    expect(worthSending(decision({ source: 'denied', alternatives: [] }))).toBe(true)
  })
})

/**
 * The branch is a record, not a message.
 *
 * `sharedLedger.ts`'s rule, applied to a new kind of line: these are written by
 * one machine, pushed, and read into a page on somebody else's, so a colleague's
 * prose must never travel this way. The test uses a decision whose every field
 * is hostile.
 */
describe('the line on the branch', () => {
  const nasty = decision({
    what: 'Used a queue\n<@here> `rm -rf /`',
    reason: 'because\n@channel',
    alternatives: [
      { what: 'a lock\n<!everyone>', detail: '`backticks`', chosen: true },
      { what: 'nothing' },
    ],
    files: ['server/utils/pool.ts'],
  })

  const [entry] = ledgerEntriesOfDecisions([{
    id: nasty.id,
    sessionId: nasty.sessionId,
    at: nasty.at,
    source: nasty.source,
    alternatives: nasty.alternatives,
    reason: nasty.reason,
    repoDir: '/w/agents-ui',
  }])

  it('carries no prose at all', () => {
    const line = ledgerLine(entry!)

    expect(line).not.toContain('Used a queue')
    expect(line).not.toContain('here')
    expect(line).not.toContain('rm -rf')
    expect(line).not.toContain('channel')
    expect(line).not.toContain('everyone')
    expect(line).not.toContain('backtick')
    expect(line).not.toContain('a lock')
    expect(line).not.toContain('pool.ts')
    expect(line).not.toContain('\\n')
  })

  it('carries what a colleague can count: ids, a kind, a number and a flag', () => {
    expect(entry).toMatchObject({
      event: 'decision',
      decisionId: 'd1',
      sessionId: 's1',
      source: 'ask_user_question',
      alternatives: 2,
      answered: true,
      repo: 'agents-ui',
    })
  })

  it('says nothing was answered when nothing was', () => {
    const [unanswered] = ledgerEntriesOfDecisions([{
      id: 'd2', sessionId: 's1', at: NOW, source: 'marker', alternatives: [],
    }])
    expect(unanswered!.answered).toBeUndefined()
  })

  it('reads back exactly what it wrote', () => {
    const read = parseLedgerLine(ledgerLine(entry!))
    expect('entry' in read && read.entry).toMatchObject({
      event: 'decision', decisionId: 'd1', source: 'ask_user_question', alternatives: 2,
    })
  })

  it('is keyed on the decision, so appending the same window twice adds nothing', () => {
    expect(entry!.id).toBe('decision:d1')
  })

  /**
   * A colleague who has not updated meets `v: 2`, counts it under `newer`, and
   * arrives at exactly the right totals — because nothing adds a decision up.
   * Bumping the counted lines with it would have cost them a person's spend.
   */
  it('is newer than the lines that carry the totals', () => {
    expect(DECISION_FORMAT).toBeGreaterThan(COUNTED_FORMAT)
    expect(LEDGER_FORMAT).toBeGreaterThanOrEqual(DECISION_FORMAT)
    expect(entry!.v).toBe(DECISION_FORMAT)
  })
})

describe('with no Slack configured', () => {
  const state = (over: Partial<DigestDelivery> = {}): DigestDelivery =>
    ({ enabled: false, destination: '', commands: false, ...over }) as DigestDelivery

  it('refuses in a sentence that says what to do about it', () => {
    const refusal = deliveryRefusal(state())

    expect(refusal!.error).toBe('not_configured')
    expect(refusal!.message).toContain('recorded here and sent nowhere')
    expect(refusal!.message).toContain('Settings')
  })

  it('refuses separately when the project it was set up from has gone', () => {
    const refusal = deliveryRefusal(state({ channelId: 'C1', userId: 'U1' }))
    expect(refusal!.error).toBe('no_project')
  })

  it('does not refuse once there is somewhere to send from', () => {
    expect(deliveryRefusal(state({ channelId: 'C1', userId: 'U1', projectDir: '/w/app' }))).toBeNull()
  })
})
