import { describe, expect, it } from 'vitest'
import {
  MAX_EVENTS_PER_POLL, describeTrigger, issueEventsFrom, promptFor, selectNew, titleFor,
  type IssueEventRow, type TriggerEvent,
} from '../server/utils/eventTriggers'

/**
 * A trigger that fires twice for the same pull request spends real money on
 * work that was already done, and one that fires for everything already open
 * the moment it is switched on is worse — it is the first thing somebody sees
 * of the feature. Both are decided here rather than by GitHub.
 */

const event = (key: number): TriggerEvent => ({
  key,
  summary: `pull request #${key}`,
  url: `https://github.com/o/r/pull/${key}`,
})

describe('the first time a trigger is polled', () => {
  it('fires nothing, and records where it came in', () => {
    // Turning on "when a pull request is opened" must not start work on every
    // pull request that was already open.
    const result = selectNew([event(7), event(5), event(9)], undefined)

    expect(result.fire).toEqual([])
    expect(result.cursor).toBe(9)
  })

  it('records a baseline even when nothing is open yet', () => {
    expect(selectNew([], undefined)).toMatchObject({ fire: [], cursor: 0 })
  })
})

describe('afterwards', () => {
  it('fires only what is new', () => {
    const result = selectNew([event(9), event(10), event(11)], 9)

    expect(result.fire.map(e => e.key)).toEqual([10, 11])
    expect(result.cursor).toBe(11)
  })

  it('fires nothing when nothing has happened', () => {
    const result = selectNew([event(9)], 9)

    expect(result.fire).toEqual([])
    // Unchanged, so the caller writes nothing.
    expect(result.cursor).toBe(9)
  })

  it('fires oldest first, so a queue is worked in the order it arrived', () => {
    const result = selectNew([event(12), event(10), event(11)], 9)

    expect(result.fire.map(e => e.key)).toEqual([10, 11, 12])
  })

  it('never goes backwards on an old item reappearing', () => {
    // A closed pull request dropping out and back into the listing must not
    // look like news.
    expect(selectNew([event(3)], 9).fire).toEqual([])
  })
})

describe('when a lot happened at once', () => {
  const many = Array.from({ length: 8 }, (_, i) => event(10 + i))

  it('starts a few rather than a stampede', () => {
    // Ten pull requests appearing while a laptop was shut should not become
    // ten agents the moment it wakes.
    expect(selectNew(many, 9).fire).toHaveLength(MAX_EVENTS_PER_POLL)
  })

  it('leaves the rest for the next poll instead of dropping them', () => {
    const result = selectNew(many, 9)

    expect(result.deferred).toBe(8 - MAX_EVENTS_PER_POLL)
    // The cursor stops at what actually fired, which is what makes the
    // remainder survive to be picked up again.
    expect(result.cursor).toBe(result.fire[result.fire.length - 1]!.key)
  })

  it('picks the deferred ones up next time, with none skipped', () => {
    const first = selectNew(many, 9)
    const second = selectNew(many, first.cursor)

    const fired = [...first.fire, ...second.fire].map(e => e.key)
    expect(fired).toEqual([10, 11, 12, 13, 14, 15])
  })
})

describe('telling the ritual what it is about', () => {
  it('appends the event, leaving the written instruction first', () => {
    const prompt = promptFor('Review it and comment.', event(42))

    expect(prompt.startsWith('Review it and comment.')).toBe(true)
    expect(prompt).toContain('pull request #42')
    expect(prompt).toContain('https://github.com/o/r/pull/42')
  })
})

describe('saying what it waits for', () => {
  it('reads as a sentence, with and without a branch', () => {
    expect(describeTrigger({ kind: 'pr_opened' })).toBe('When a pull request is opened')
    expect(describeTrigger({ kind: 'check_failed', branch: 'main' }))
      .toBe('When a workflow run fails on main')
  })
})

/**
 * Telling one firing from another.
 *
 * A ritual that fires on five pull requests produced five rows in Activity
 * carrying its own name on each, so working out which was which meant opening
 * one and reading its prompt. The ritual's name says what the work is; the
 * event says which one it was about.
 */
describe('naming the run an event produced', () => {
  it('keeps the ritual name and adds what set it off', () => {
    expect(titleFor('Look into red CI', event(42)))
      .toBe('Look into red CI · pull request #42')
  })

  it('gives two firings of the same ritual different names', () => {
    const a = titleFor('Review it', event(1))
    const b = titleFor('Review it', event(2))

    expect(a).not.toBe(b)
  })

  it('trims a summary long enough to swamp the row', () => {
    const long: TriggerEvent = {
      key: 7,
      summary: `pull request #7: ${'a very long title '.repeat(10)}`,
      url: 'https://example.com/7',
    }

    const title = titleFor('Review it', long)
    expect(title.length).toBeLessThan(80)
    expect(title.startsWith('Review it · ')).toBe(true)
    expect(title.endsWith('…')).toBe(true)
  })
})

/**
 * Things that happened *to* an issue, rather than issues that exist.
 *
 * The shapes below are taken from real `repos/{owner}/{repo}/issues/events`
 * responses, because the reason this trigger reads an event log rather than a
 * list of issues is a payload fact: "labelled" is something done to an issue,
 * possibly long after it was opened, and nothing on the issue itself records
 * it in a way a high-water mark could follow.
 */
describe('events on issues and pull requests', () => {
  const labelled = (over: Partial<IssueEventRow> = {}): IssueEventRow => ({
    id: 29215043072,
    event: 'labeled',
    label: { name: 'gh-skill' },
    issue: {
      number: 14118,
      title: '`gh skill` ignores the coding agent dir',
      html_url: 'https://github.com/cli/cli/issues/14118',
    },
    ...over,
  })

  const reviewRequested = (over: Partial<IssueEventRow> = {}): IssueEventRow => ({
    id: 29209653834,
    event: 'review_requested',
    requested_reviewer: { login: 'Copilot' },
    issue: {
      number: 14117,
      title: 'fix(ssh-key): allow deleting signing keys',
      html_url: 'https://github.com/cli/cli/pull/14117',
      pull_request: {},
    },
    ...over,
  })

  it('takes only the kind asked for, out of a log that mixes them all', () => {
    // A real response is mostly other things — referenced, subscribed, closed,
    // merged. Firing a triage ritual on a `subscribed` event would be absurd.
    const rows = [
      labelled(),
      reviewRequested(),
      { id: 1, event: 'subscribed', issue: { number: 1, html_url: 'https://x/1' } },
      { id: 2, event: 'referenced', issue: { number: 1, html_url: 'https://x/1' } },
    ]

    expect(issueEventsFrom(rows, { kind: 'issue_labelled' }).map(e => e.key))
      .toEqual([29215043072])
    expect(issueEventsFrom(rows, { kind: 'review_requested' }).map(e => e.key))
      .toEqual([29209653834])
  })

  it('is keyed by the event, not by the issue', () => {
    // An issue labelled today can have a lower number than one labelled last
    // week, so a cursor over issue numbers would step straight past it. The
    // event id is the thing that only ever increases.
    expect(issueEventsFrom([labelled()], { kind: 'issue_labelled' })[0]!.key)
      .toBe(29215043072)
  })

  it('narrows to one label when asked, and ignores case', () => {
    const rows = [labelled(), labelled({ id: 2, label: { name: 'bug' } })]

    expect(issueEventsFrom(rows, { kind: 'issue_labelled', label: 'BUG' }).map(e => e.key))
      .toEqual([2])
  })

  it('takes every label when none is named', () => {
    const rows = [labelled(), labelled({ id: 2, label: { name: 'bug' } })]

    expect(issueEventsFrom(rows, { kind: 'issue_labelled' })).toHaveLength(2)
  })

  it('says which label, and which issue', () => {
    const [event] = issueEventsFrom([labelled()], { kind: 'issue_labelled' })

    expect(event!.summary).toContain('issue #14118')
    expect(event!.summary).toContain('gh-skill')
    expect(event!.url).toBe('https://github.com/cli/cli/issues/14118')
  })

  it('does not call a labelled pull request an issue', () => {
    // Pull requests are issues to this endpoint and can be labelled too.
    // Sending somebody to "issue #14117" points them at the wrong thing.
    const [event] = issueEventsFrom(
      [labelled({ issue: { number: 14117, title: 'a fix', html_url: 'https://x/p', pull_request: {} } })],
      { kind: 'issue_labelled' },
    )

    expect(event!.summary).toContain('pull request #14117')
  })

  it('narrows a review request to one person', () => {
    const rows = [reviewRequested(), reviewRequested({ id: 2, requested_reviewer: { login: 'someone' } })]

    expect(issueEventsFrom(rows, { kind: 'review_requested', reviewer: 'someone' }).map(e => e.key))
      .toEqual([2])
  })

  it('counts a request of your team as a request of you', () => {
    // Filtering by your own login and being told nothing when your team was
    // asked would be the wrong answer to the question people mean.
    const rows = [reviewRequested({
      requested_reviewer: undefined,
      requested_team: { name: 'reviewers' },
    })]

    expect(issueEventsFrom(rows, { kind: 'review_requested', reviewer: 'reviewers' }))
      .toHaveLength(1)
  })

  it('calls a pull request a pull request, and an issue an issue', () => {
    // The same endpoint reports both, under a field called `issue` either way.
    const onPull = issueEventsFrom([reviewRequested()], { kind: 'review_requested' })
    const onIssue = issueEventsFrom(
      [reviewRequested({ issue: { number: 9, title: 'a', html_url: 'https://x/9' } })],
      { kind: 'review_requested' },
    )

    expect(onPull[0]!.summary).toContain('pull request #14117')
    expect(onIssue[0]!.summary).toContain('issue #9')
  })

  it('drops a row with nothing to link to rather than firing at nowhere', () => {
    expect(issueEventsFrom([labelled({ issue: { number: 1 } })], { kind: 'issue_labelled' }))
      .toEqual([])
  })

  it('survives a label event that named no label', () => {
    const [event] = issueEventsFrom([labelled({ label: undefined })], { kind: 'issue_labelled' })

    expect(event?.summary).toContain('#14118')
  })
})

describe('saying what the new kinds wait for', () => {
  it('names the label rather than pretending it is a branch', () => {
    expect(describeTrigger({ kind: 'issue_labelled', label: 'bug' }))
      .toBe('When an issue is labelled bug')
  })

  it('names the reviewer', () => {
    expect(describeTrigger({ kind: 'review_requested', reviewer: 'me' }))
      .toBe('When a review is requested from me')
  })

  it('reads sensibly with no narrowing at all', () => {
    expect(describeTrigger({ kind: 'issue_labelled' })).toBe('When an issue is labelled')
    expect(describeTrigger({ kind: 'review_requested' })).toBe('When a review is requested')
  })
})
