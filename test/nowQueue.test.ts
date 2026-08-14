import { describe, it, expect } from 'vitest'
import { buildNowQueue, type NowItem } from '~/utils/nowQueue'
import type { AttentionItem } from '~/composables/useAttention'
import type { Digest } from '~/composables/useDigest'
import type { Pull } from '~/composables/useGithubPulls'

function digest(over: Partial<Digest> = {}): Digest {
  return {
    since: 0, quiet: false, rituals: [], sessions: [], stopped: [],
    missed: [], gaps: [], costUsd: 0, needsYou: 0,
    ...over,
  }
}

/**
 * `verdict` and `intent` come from the server — the queue reads them rather than
 * re-deriving anything from the raw fields, so the fixture provides them.
 */
function pull(over: Partial<Pull> = {}): Pull {
  return {
    number: 1, title: 'A pull request', url: 'https://x/1', author: 'someone',
    mine: false, draft: false, headBranch: 'h', baseBranch: 'main', headSha: 'abc',
    createdAt: 0, updatedAt: 0, additions: 0, deletions: 0, changedFiles: 0,
    reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', checks: 'passing',
    verdict: { state: 'awaiting-review', label: 'Waiting on you', detail: 'someone is waiting', onYou: true },
    intent: 'review',
    ...over,
  } as Pull
}

const blockedSession = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  kind: 'blocked-session', id: 'b', title: 'blocked',
  because: 'It stopped to ask permission for something and is waiting.',
  ...over,
})

const failingRitual = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  kind: 'failing-ritual', id: 'brief', title: 'Morning brief',
  because: 'Its last 2 runs came to nothing.',
  ...over,
})

const kinds = (items: NowItem[]) => items.map(i => i.kind)

describe('buildNowQueue ranking', () => {
  it('leads with a blocked session — frozen now, and cheapest to fix', () => {
    const items = buildNowQueue({
      attention: [failingRitual(), blockedSession()],
      pulls: [pull()],
      digest: digest({
        sessions: [{ id: 'r', title: 'ready', behindBase: false, state: 'ready' }],
        missed: [{ id: 'm', title: 'missed', dueAt: 1 }],
        stopped: [{ id: 's', title: 'stopped', reason: 'gave up' }],
      }),
    })

    expect(kinds(items)).toEqual([
      'blocked-session',
      'stopped-ritual',
      'failing-ritual',
      'review',
      'ready-session',
      'missed-ritual',
    ])
  })

  it('ranks a ritual the scheduler abandoned above one that merely fails again', () => {
    const items = buildNowQueue({
      attention: [failingRitual()],
      pulls: [],
      digest: digest({ stopped: [{ id: 's', title: 'stopped', reason: 'gave up on it' }] }),
    })
    expect(kinds(items)).toEqual(['stopped-ritual', 'failing-ritual'])
  })

  it('treats a gap as permanent, not as a missed occurrence', () => {
    // A missed run comes round again; a gap does not, so it ranks with the
    // things that stay broken.
    const items = buildNowQueue({
      attention: [],
      pulls: [],
      digest: digest({
        gaps: [{ id: 'g', title: 'gap', at: 9 }],
        missed: [{ id: 'm', title: 'missed', dueAt: 1 }],
      }),
    })
    expect(kinds(items)).toEqual(['stopped-ritual', 'missed-ritual'])
  })

  it('puts the longest-stuck first within a rank', () => {
    const items = buildNowQueue({
      attention: [],
      pulls: [
        pull({ number: 2, title: 'newer', updatedAt: 900 }),
        pull({ number: 1, title: 'older', updatedAt: 100 }),
      ],
      digest: digest(),
    })
    expect(items.map(i => i.title)).toEqual(['older', 'newer'])
  })

  it('is empty when nothing wants you', () => {
    expect(buildNowQueue({ attention: [], pulls: [], digest: digest({ quiet: true }) })).toEqual([])
  })

  it('survives having no digest yet', () => {
    const items = buildNowQueue({ attention: [blockedSession()], pulls: [pull()], digest: null })
    expect(kinds(items)).toEqual(['blocked-session', 'review'])
  })
})

describe('buildNowQueue and the sidebar cannot disagree', () => {
  /**
   * The bug this shape exists to prevent. The queue was built from the digest,
   * which reports on a *window*; the badge counts current health. A ritual that
   * broke before the window began was counted by the badge and absent from the
   * queue — the sidebar said "3" over a screen saying "nothing is waiting on
   * you". Both now read the same current-state payload.
   */
  it('shows a ritual that broke before the digest window began', () => {
    const items = buildNowQueue({
      attention: [failingRitual()],
      pulls: [],
      // Quiet window: the failures are older than `since`.
      digest: digest({ quiet: true }),
    })

    expect(kinds(items)).toEqual(['failing-ritual'])
    expect(items[0]!.because).toBe('Its last 2 runs came to nothing.')
  })

  it('shows a blocked session the digest window missed', () => {
    const items = buildNowQueue({
      attention: [blockedSession({ id: 'old', title: 'blocked days ago' })],
      pulls: [],
      digest: digest({ quiet: true }),
    })
    expect(kinds(items)).toEqual(['blocked-session'])
    expect(items[0]!.to).toBe('/sessions/old')
  })

  it('counts each stuck thing once when the digest also knows about it', () => {
    const items = buildNowQueue({
      attention: [failingRitual({ id: 'brief' })],
      pulls: [],
      digest: digest({
        rituals: [{
          scheduleId: 'brief', title: 'Morning brief', outcome: 'blocked', at: 1,
          preview: '', problem: 'Refused Bash(gh issue edit:*)',
        }],
      }),
    })
    expect(items).toHaveLength(1)
  })
})

describe('buildNowQueue items', () => {
  it('offers the rules a blocked ritual needs, resolvable from here', () => {
    const [item] = buildNowQueue({
      attention: [failingRitual({ id: 'brief' })],
      pulls: [],
      digest: digest({
        rituals: [{
          scheduleId: 'brief', title: 'Morning brief', outcome: 'blocked', at: 1,
          preview: '', problem: 'Refused Bash(gh issue edit:*)',
          suggestedRules: ['Bash(gh issue edit:*)'],
        }],
      }),
    })
    expect(item!.action).toEqual({
      label: 'Allow this from now on',
      kind: 'allow-rules',
      target: 'brief',
      rules: ['Bash(gh issue edit:*)'],
    })
    // The digest's sentence is more specific than the streak count, so it wins.
    expect(item!.because).toBe('Refused Bash(gh issue edit:*)')
  })

  it('does not re-offer rules that have since been granted', () => {
    const [item] = buildNowQueue({
      attention: [failingRitual({ id: 'brief' })],
      pulls: [],
      digest: digest({
        rituals: [{
          scheduleId: 'brief', title: 'Morning brief', outcome: 'blocked', at: 1,
          preview: '', problem: 'Was refused something',
          suggestedRules: ['Bash(gh issue edit:*)'], alreadyAllowed: true,
        }],
      }),
    })
    expect(item!.action).toBeUndefined()
  })

  it('falls back to the streak when the digest has no sentence for it', () => {
    const [item] = buildNowQueue({
      attention: [failingRitual({ because: 'Its last 4 runs came to nothing.' })],
      pulls: [],
      digest: digest({ quiet: true }),
    })
    expect(item!.because).toBe('Its last 4 runs came to nothing.')
    expect(item!.action).toBeUndefined()
  })

  it('leaves out anything the server says moves without you', () => {
    // A draft, or a pull request waiting on somebody else. The queue does not
    // second-guess that judgement — `verdict.onYou` is the whole test, and it
    // is the same field the sidebar counts.
    const items = buildNowQueue({
      attention: [],
      pulls: [
        pull({ number: 1, draft: true, verdict: { state: 'draft', label: 'Draft', detail: '', onYou: false }, intent: null }),
        pull({ number: 2, verdict: { state: 'awaiting-review', label: 'Waiting on review', detail: '', onYou: false }, intent: null }),
      ],
      digest: null,
    })
    expect(items).toEqual([])
  })

  it('includes your own pull request when it is the one that is stuck', () => {
    // The case that produced the mismatch: `summary.onYou` counts these, and a
    // queue that only looked at review requests did not.
    const [item] = buildNowQueue({
      attention: [],
      pulls: [pull({
        number: 12, mine: true, title: 'my branch',
        verdict: { state: 'ready', label: 'Ready to merge', detail: 'Approved, nothing reported', onYou: true },
        intent: null,
      })],
      digest: null,
    })
    expect(item!.because).toBe('#12 · Approved, nothing reported')
    expect(item!.action).toBeUndefined()
  })

  it('takes the row action from the server intent, not from a guess', () => {
    const [item] = buildNowQueue({
      attention: [],
      pulls: [pull({ number: 9, intent: 'fix' })],
      digest: null,
    })
    expect(item!.action).toEqual({ label: 'Fix CI', kind: 'work-on-pull', target: 9 })
  })

  it('falls back to the verdict label when there is no detail', () => {
    const [item] = buildNowQueue({
      attention: [],
      pulls: [pull({ number: 3, verdict: { state: 'conflicted', label: 'Conflicts', detail: '', onYou: true } })],
      digest: null,
    })
    expect(item!.because).toBe('#3 · Conflicts')
  })

  it('says when a finished branch has gone stale rather than just "ready"', () => {
    const [item] = buildNowQueue({
      attention: [],
      pulls: [],
      digest: digest({
        sessions: [{ id: 'a', title: 'faceted search', behindBase: true, state: 'ready' }],
      }),
    })
    expect(item!.because).toBe('Done and checked, but the base branch has moved under it.')
  })

  it('prefers the session summary over boilerplate when there is one', () => {
    const [item] = buildNowQueue({
      attention: [],
      pulls: [],
      digest: digest({
        sessions: [{ id: 'a', title: 'x', behindBase: false, state: 'ready', summary: 'Added three tests.' }],
      }),
    })
    expect(item!.because).toBe('Added three tests.')
  })

  it('gives every item a stable unique key', () => {
    const items = buildNowQueue({
      attention: [blockedSession({ id: 'a', title: 'a' })],
      pulls: [pull({ number: 1 })],
      digest: digest({
        sessions: [{ id: 'a', title: 'a', behindBase: false, state: 'ready' }],
      }),
    })
    const keys = items.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('work waiting elsewhere', () => {
  const source = (over = {}) => ({
    key: 'notion', label: 'Notion', requires: ['notion'], icon: 'i-lucide-file-text',
    items: [{ id: 'https://n/1', title: 'Bank reconciliation', url: 'https://n/1', why: 'Assigned to you, still open.' }],
    ...over,
  })

  it('ranks a ticket below a review and above work waiting to land', () => {
    // Somebody's expectation of you, like a review — but nobody is blocked on it
    // this minute, so a person waiting outranks it.
    const items = buildNowQueue({
      attention: [],
      pulls: [pull()],
      digest: digest({ sessions: [{ id: 'r', title: 'ready', behindBase: false, state: 'ready' }] }),
      inbox: [source()],
    })
    expect(kinds(items)).toEqual(['review', 'inbox', 'ready-session'])
  })

  it('shows the reason the source gave, verbatim', () => {
    const [item] = buildNowQueue({ attention: [], pulls: [], digest: null, inbox: [source()] })
    expect(item!.because).toBe('Assigned to you, still open.')
    expect(item!.href).toBe('https://n/1')
  })

  it('offers to turn it into a session, which is the point of an inbox', () => {
    // Every other aggregator ends at "here is your notification".
    const [item] = buildNowQueue({ attention: [], pulls: [], digest: null, inbox: [source()] })
    expect(item!.action?.kind).toBe('work-on-inbox')
    expect(item!.action?.label).toBe('Work on it')
    expect(item!.action?.prompt).toContain('https://n/1')
    expect(item!.action?.prompt).toContain('Assigned to you, still open.')
  })

  it('keys rows by source and item, so two sources cannot collide', () => {
    const items = buildNowQueue({
      attention: [], pulls: [], digest: null,
      inbox: [source(), source({ key: 'slack', label: 'Slack' })],
    })
    expect(new Set(items.map(i => i.key)).size).toBe(2)
  })

  it('is absent entirely when no source has been asked yet', () => {
    expect(buildNowQueue({ attention: [], pulls: [], digest: null })).toEqual([])
    expect(buildNowQueue({ attention: [], pulls: [], digest: null, inbox: [] })).toEqual([])
  })

  it('shows nothing for a source that ran and found nothing', () => {
    const items = buildNowQueue({
      attention: [], pulls: [], digest: null,
      inbox: [source({ items: [], checkedAt: 123 })],
    })
    expect(items).toEqual([])
  })
})
