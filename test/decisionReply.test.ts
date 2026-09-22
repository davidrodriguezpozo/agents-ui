import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  decisionFinding, orderByDecision, quoteReply, routeFor, withDecisionSpine, type SessionShape,
} from '../server/utils/decisionReply'
import { decisionsStore, recordDecision } from '../server/utils/decisions'
import type { DiffPositions } from '../server/utils/reviewAnchors'
import type { Decision, DecisionReply } from '../server/utils/decisions'
import type { DraftFinding } from '../server/utils/reviewDraft'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Where a reviewer's reply lands.
 *
 * 47 drafts on this machine hold 529 findings and `posted` is set on none. 22 of
 * the 45 retirements are `head_moved` or `pr_closed` — the world moved before
 * anybody sent the opinion. So the tests here are about *when*, not about what:
 * the same sentence has four prices, and picking the cheapest road still open is
 * the entire job.
 *
 * The other half is the one that would do real damage if it broke. A reviewer
 * saying "I'd worry about the queue" must never reach a session as this app
 * telling it to remove the queue.
 */

const NOW = Date.parse('2026-09-22T11:00:00Z')

function decision(over: Partial<Decision> = {}): Decision {
  return {
    id: 'd1', sessionId: 's1', at: NOW, source: 'marker',
    what: 'Used a queue rather than a lock', alternatives: [], files: [],
    ...over,
  }
}

function reply(over: Partial<DecisionReply> = {}): DecisionReply {
  return { ts: '2.0', author: 'U9', text: "I'd worry about the queue", readAt: NOW, ...over }
}

function shape(over: Partial<SessionShape> = {}): SessionShape {
  return { exists: true, turnRunning: false, ended: false, ...over }
}

describe('routeFor', () => {
  /** The only road where the reply changes the code before it is written. */
  it('races a running turn, above everything', () => {
    const choice = routeFor(shape({ turnRunning: true, ended: true, pullNumber: 42 }))

    expect(choice.route).toBe('steered')
    expect(choice.detail).toContain('running turn')
    // The page has to be able to say which of the roads it took, not "sent".
    expect(choice.detail).toContain('quoted words')
  })

  it('queues as the next turn when the session is open and idle', () => {
    expect(routeFor(shape()).route).toBe('queued')
  })

  it('takes the draft when the session is over and no pull request is open', () => {
    const choice = routeFor(shape({ ended: true }))

    expect(choice.route).toBe('draft')
    expect(choice.detail).toContain('review draft')
  })

  /** The dearest road, and therefore the last one tried. */
  it('falls to a pull request comment only when nothing cheaper is open', () => {
    const choice = routeFor(shape({ ended: true, pullNumber: 5442 }))

    expect(choice.route).toBe('comment')
    expect(choice.detail).toContain('#5442')
  })

  it('prefers a turn over a pull request that is already open', () => {
    expect(routeFor(shape({ pullNumber: 5442 })).route).toBe('queued')
  })

  /**
   * The retirement table is what happens when this case is left implicit: 20 of
   * 45 retired drafts were `session_closed`.
   */
  it('drops a reply to a session that is gone, and says why', () => {
    const choice = routeFor(shape({ exists: false, ended: true }))

    expect(choice.route).toBe('dropped')
    expect(choice.detail).toContain('no longer exists')
    expect(choice.detail).toContain('kept on the decision')
  })

  it('reads the four roads in order of what they cost', () => {
    const routes = [
      routeFor(shape({ turnRunning: true })).route,
      routeFor(shape()).route,
      routeFor(shape({ ended: true })).route,
      routeFor(shape({ ended: true, pullNumber: 1 })).route,
      routeFor(shape({ exists: false })).route,
    ]

    expect(routes).toEqual(['steered', 'queued', 'draft', 'comment', 'dropped'])
  })
})

describe('quoteReply', () => {
  const text = quoteReply(decision(), reply(), 'Sam')

  it('attributes it to a person', () => {
    expect(text).toContain('Sam replied')
  })

  it('names the decision it is about', () => {
    expect(text).toContain('Used a queue rather than a lock')
  })

  /**
   * The property that matters most in this file. Handed to a session bare, at
   * the top of a turn, in the app's own voice, "I'd worry about the queue"
   * reads as "remove the queue". The difference is a day of somebody's work.
   */
  it('marks it as somebody\'s opinion and not as an instruction', () => {
    expect(text).toContain("> I'd worry about the queue")
    expect(text).toContain('not an instruction from this app')
    expect(text).toContain('nothing here obliges you to change anything')
  })

  it('quotes every line, so nothing escapes the quotation', () => {
    const many = quoteReply(decision(), reply({ text: 'first\nsecond\nthird' }))

    expect(many).toContain('> first')
    expect(many).toContain('> second')
    expect(many).toContain('> third')
  })

  it('says "a reviewer" rather than inventing a name', () => {
    expect(quoteReply(decision(), reply())).toContain('A reviewer replied')
    expect(quoteReply(decision(), reply(), '  ')).toContain('A reviewer replied')
  })

  it('cuts a reply that would fill a turn, rather than refusing it', () => {
    const huge = quoteReply(decision(), reply({ text: 'x'.repeat(5000) }))
    expect(huge.length).toBeLessThan(3000)
    expect(huge).toContain('…')
  })
})

describe('decisionFinding', () => {
  function positions(files: Record<string, number[]> = {}): DiffPositions {
    return {
      right: new Map(Object.entries(files).map(([path, lines]) => [path, new Set(lines)])),
      left: new Map(),
      files: new Set(Object.keys(files)),
    }
  }

  it('anchors to the file when the decision named one the diff touched', () => {
    const finding = decisionFinding(
      decision({ files: ['server/utils/pool.ts'], replies: [reply()] }),
      positions({ 'server/utils/pool.ts': [12, 13] }),
    )

    expect(finding.anchor.kind).toBe('file')
    expect(finding.anchor.path).toBe('server/utils/pool.ts')
  })

  /**
   * A decision's files are paths a session *mentioned*, which is not the same
   * as paths this diff touched. `reviewDraft.ts` already refuses to invent a
   * position because a bad one costs a 422 and the 422 loses the whole review.
   */
  it('becomes body text when the file is not in the diff, never a guessed line', () => {
    const finding = decisionFinding(
      decision({ files: ['docs/plan/42.md'], replies: [reply()] }),
      positions({ 'server/utils/pool.ts': [12] }),
    )

    expect(finding.anchor.kind).toBe('summary')
    expect(finding.anchor.line).toBeUndefined()
    expect(finding.anchor.reason).toContain('not in this diff')
  })

  it('becomes body text when the decision named no file at all', () => {
    const finding = decisionFinding(decision({ replies: [reply()] }), positions())

    expect(finding.anchor.kind).toBe('summary')
    expect(finding.anchor.line).toBeUndefined()
  })

  /**
   * `BLOCKING` feeds `suggestedEvent`, which would turn somebody's sentence in
   * Slack into this app requesting changes on their behalf.
   */
  it('raises a concern rather than a verdict', () => {
    expect(decisionFinding(decision({ replies: [reply()] }), positions()).severity).toBe('WARN')
  })

  it('carries the decision and the reply, quoted', () => {
    const finding = decisionFinding(decision({ replies: [reply()] }), positions(), 'Sam')

    expect(finding.body).toContain('Used a queue rather than a lock')
    expect(finding.body).toContain('Sam said')
    expect(finding.body).toContain("> I'd worry about the queue")
    expect(finding.decisionId).toBe('d1')
  })

  it('is keyed on the decision, so a second reply changes one heading', () => {
    const once = decisionFinding(decision({ replies: [reply()] }), positions())
    const twice = decisionFinding(
      decision({ replies: [reply(), reply({ ts: '3.0', text: 'and the lock?' })] }),
      positions(),
    )

    expect(once.id).toBe(twice.id)
    expect(once.id).toBe('decision:d1')
    expect(twice.body).toContain("I'd worry about the queue")
    expect(twice.body).toContain('and the lock?')
  })

  /**
   * Shown, and not sent. A choice nobody commented on is still a choice
   * somebody made — but posting "nobody said anything about this" as a comment
   * on somebody's pull request is noise. The `alreadyRaised` precedent.
   */
  it('keeps an unanswered decision, unchecked', () => {
    const finding = decisionFinding(decision(), positions())

    expect(finding.include).toBe(false)
    expect(finding.body).toContain('Nobody replied to this')
    expect(decisionFinding(decision({ replies: [reply()] }), positions()).include).toBe(true)
  })

  it('carries the roads and the reason, or says there was none', () => {
    const rich = decisionFinding(decision({
      alternatives: [{ what: 'a queue', chosen: true }, { what: 'a lock' }],
      reason: 'it serialises by path',
    }), positions())

    expect(rich.body).toContain('**a queue** (taken)')
    expect(rich.body).toContain('- a lock')
    expect(rich.body).toContain('**Why:** it serialises by path')
    expect(decisionFinding(decision(), positions()).body).toContain('_no reason given_')
  })
})

/**
 * The payoff of all four units: a draft whose spine is the decisions.
 *
 * A reviewer opening a pull request does not start at a blank diff and go
 * looking for where a choice was made. Every choice is already a heading, with
 * whatever was said about it underneath — and the ones nobody said anything
 * about are still there, because a choice nobody commented on is still a choice
 * somebody made.
 */
describe('a draft ordered by decision', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'decision-reply-'))
    process.env.CLAUDE_DIR = dir
  })

  afterAll(async () => {
    delete process.env.CLAUDE_DIR
    await rm(dir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await decisionsStore.write({ decisions: [] })
  })

  function finding(over: Partial<DraftFinding> = {}): DraftFinding {
    return {
      id: 'f', location: 'a.ts:1', severity: 'WARN', category: 'correctness',
      body: 'something', useSuggestion: false, include: true,
      anchor: { kind: 'summary' }, ...over,
    }
  }

  async function file(what: string, at: number) {
    return (await recordDecision({
      sessionId: 's1', at, source: 'marker', what, alternatives: [], files: [],
    }))!
  }

  it('leads with the decisions, in the order they were taken', async () => {
    const first = await file('Used a queue', NOW)
    const second = await file('Kept the store flat', NOW + 1000)

    const ordered = await orderByDecision([
      finding({ id: 'mechanical' }),
      finding({ id: 'b', decisionId: second.id }),
      finding({ id: 'a', decisionId: first.id }),
    ], 's1')

    expect(ordered.map(f => f.id)).toEqual(['a', 'b', 'mechanical'])
  })

  it('leaves the mechanical findings in the order the report gave them', async () => {
    await file('Used a queue', NOW)

    const ordered = await orderByDecision([
      finding({ id: 'one' }), finding({ id: 'two' }), finding({ id: 'three' }),
    ], 's1')

    expect(ordered.map(f => f.id)).toEqual(['one', 'two', 'three'])
  })

  it('changes nothing for a session that took no decisions', async () => {
    const findings = [finding({ id: 'one' }), finding({ id: 'two' })]
    expect((await orderByDecision(findings, 's1')).map(f => f.id)).toEqual(['one', 'two'])
  })

  /**
   * A finding pointing at a decision from another session, or one deleted since,
   * sorts with the mechanical findings rather than to the front. It is still
   * shown — a finding that vanished because its decision did would be the worst
   * of the outcomes.
   */
  it('keeps a finding whose decision it cannot place', async () => {
    await file('Used a queue', NOW)

    const ordered = await orderByDecision([
      finding({ id: 'orphan', decisionId: 'gone' }),
      finding({ id: 'mechanical' }),
    ], 's1')

    expect(ordered.map(f => f.id)).toHaveLength(2)
    expect(ordered.map(f => f.id)).toContain('orphan')
  })
})
