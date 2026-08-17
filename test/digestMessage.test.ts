import { describe, expect, it } from 'vitest'
import {
  clamp, escapeMrkdwn, MESSAGE_LIMIT, oneLine, renderDigest, shouldSend, windowLabel,
} from '../server/utils/digestMessage'
import type { Digest } from '../server/utils/digest'

/**
 * The morning report as a message somewhere else.
 *
 * Everything here is about a reader who cannot click into a row: the text is all
 * there is, so a line that does not carry its own reason is a line that wasted
 * its place. The other half is the money — this is the one thing in the app that
 * posts without being asked, so "is it worth sending" is a tested judgement
 * rather than a timer.
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

function digest(patch: Partial<Digest> = {}): Digest {
  return {
    since: NOW - DAY,
    quiet: false,
    rituals: [],
    sessions: [],
    stopped: [],
    missed: [],
    gaps: [],
    costUsd: 0,
    needsYou: 0,
    ...patch,
  }
}

describe('windowLabel', () => {
  it('says how long a stretch it covers without naming a clock time', () => {
    expect(windowLabel(NOW - DAY, NOW)).toBe('the last 24 hours')
    expect(windowLabel(NOW - 3 * DAY, NOW)).toBe('the last 3 days')
    expect(windowLabel(NOW - 30 * 60_000, NOW)).toBe('the last hour')
  })

  it('does not go negative when a stored timestamp is in the future', () => {
    expect(windowLabel(NOW + DAY, NOW)).toBe('the last hour')
  })
})

describe('escapeMrkdwn', () => {
  /**
   * Every title in a digest was written by something else. A ritual called
   * `deploy <staging>` left alone swallows the rest of the line into a link
   * Slack cannot resolve.
   */
  it('escapes the three characters mrkdwn reads as markup', () => {
    expect(escapeMrkdwn('deploy <staging> & wait')).toBe('deploy &lt;staging&gt; &amp; wait')
  })

  it('escapes the ampersand before the brackets, not after', () => {
    // The other order double-escapes what it has just written.
    expect(escapeMrkdwn('<a>')).toBe('&lt;a&gt;')
  })
})

describe('oneLine', () => {
  it('flattens whitespace and keeps short text intact', () => {
    expect(oneLine('two\n\nlines   here')).toBe('two lines here')
  })

  it('cuts at a word boundary when there is one late enough to use', () => {
    const cut = oneLine('the quick brown fox jumps over the lazy dog and keeps going', 20)
    expect(cut).toBe('the quick brown fox…')
  })

  it('cuts mid-word rather than losing most of the line', () => {
    expect(oneLine('supercalifragilistic', 10)).toBe('supercalif…')
  })
})

describe('renderDigest', () => {
  it('leads with what needs you, and says why in the same line', () => {
    const text = renderDigest(digest({
      rituals: [{
        scheduleId: 's1',
        title: 'Morning brief',
        outcome: 'blocked',
        at: NOW,
        preview: '',
        problem: 'Refused Notion, so the job is half done.',
        suggestedRules: ['mcp__notion__notion-search'],
      }],
      costUsd: 0.42,
    }), { now: NOW })

    expect(text).toContain('*Needs you (1)*')
    expect(text).toContain('*Morning brief* — Refused Notion, so the job is half done.')
    // The offer, counted rather than listed — six rule strings is not a message.
    expect(text).toContain('1 rule would fix it')
    expect(text).not.toContain('mcp__notion__notion-search')
    expect(text).toContain('$0.42 spent')
  })

  it('puts a session that produced something in the second band with its verdict', () => {
    const text = renderDigest(digest({
      sessions: [{
        id: 'a',
        title: 'Add rate limiting',
        summary: 'Upload now rejects files over 5MB.',
        check: 'passing',
        behindBase: true,
        state: 'ready',
      }],
    }), { now: NOW })

    expect(text).toContain('*Came out of it (1)*')
    expect(text).toContain('Upload now rejects files over 5MB.')
    expect(text).toContain('_checks pass_')
    expect(text).toContain('_behind its base_')
  })

  it('counts a failing session as needing you rather than as an outcome', () => {
    const text = renderDigest(digest({
      sessions: [{
        id: 'a', title: 'Broken thing', check: 'failing', behindBase: false, state: 'needs-you',
      }],
    }), { now: NOW })

    expect(text).toContain('*Needs you (1)*')
    expect(text).not.toContain('*Came out of it')
  })

  /**
   * Visible the first time a real message went out: one line led by `:no_entry:`
   * and the next by `•` reads as two kinds of thing rather than as one list.
   */
  it('marks every line in the first band with a symbol, and none with a bullet', () => {
    const text = renderDigest(digest({
      rituals: [{
        scheduleId: 's1', title: 'Morning brief', outcome: 'failed', at: NOW, preview: '',
        problem: 'It ended early.',
      }],
      stopped: [{ id: 's2', title: 'Issue triage', reason: 'Three in a row came to nothing.' }],
      sessions: [{
        id: 'a', title: 'Broken thing', check: 'failing', behindBase: false, state: 'needs-you',
      }],
    }), { now: NOW })

    const band = text.split('\n').filter(line => line.includes('*Morning brief*')
      || line.includes('*Issue triage*') || line.includes('*Broken thing*'))

    expect(band).toHaveLength(3)
    for (const line of band) expect(line.startsWith(':')).toBe(true)
  })

  it('reports a ritual the scheduler switched off, which is the thing you must undo', () => {
    const text = renderDigest(digest({
      stopped: [{ id: 's2', title: 'Issue triage', reason: 'Three runs in a row came to nothing.' }],
    }), { now: NOW })

    expect(text).toContain('*Issue triage* — stopped firing.')
    expect(text).toContain('Three runs in a row came to nothing.')
  })

  it('names what did not happen, in its own band and not as a problem to solve', () => {
    const text = renderDigest(digest({
      missed: [{ id: 's3', title: 'Nightly sweep', dueAt: NOW - DAY }],
      gaps: [{ id: 's4', title: 'PR triage', at: NOW }],
    }), { now: NOW })

    expect(text).toContain('*Did not happen*')
    expect(text).toContain('its turn came round while nothing was running')
    expect(text).toContain('events went by unseen')
    expect(text).not.toContain('*Needs you')
  })

  it('counts the tail of a long band instead of dropping it silently', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      scheduleId: `s${i}`,
      title: `Ritual ${i}`,
      outcome: 'failed' as const,
      at: NOW,
      preview: '',
      problem: 'It ended early.',
    }))

    const text = renderDigest(digest({ rituals: many }), { now: NOW })

    expect(text).toContain('*Needs you (9)*')
    expect(text).toContain('_and 4 more_')
  })

  it('says something on a quiet morning, for the send somebody asked for', () => {
    const text = renderDigest(digest({ quiet: true }), { now: NOW })

    expect(text).toContain('Nothing ran and nothing is waiting on you.')
  })

  it('links back once, at the bottom, and only when given a url', () => {
    const linked = renderDigest(digest(), { now: NOW, url: 'http://localhost:3000/' })
    expect(linked).toContain('<http://localhost:3000/|Open Agents Studio>')

    expect(renderDigest(digest(), { now: NOW })).not.toContain('Open Agents Studio')
  })

  it('escapes titles that would otherwise eat the line', () => {
    const text = renderDigest(digest({
      sessions: [{ id: 'a', title: 'deploy <staging>', behindBase: false, state: 'ready' }],
    }), { now: NOW })

    expect(text).toContain('deploy &lt;staging&gt;')
  })

  it('stays inside the message limit however much happened', () => {
    const rituals = Array.from({ length: 40 }, (_, i) => ({
      scheduleId: `s${i}`,
      title: `A ritual with a fairly long name number ${i}`,
      outcome: 'ok' as const,
      at: NOW,
      preview: 'It said a great deal about what it had been doing all night, at length.',
    }))

    const text = renderDigest(digest({ rituals }), { now: NOW })
    expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT)
  })
})

describe('clamp', () => {
  /**
   * Whole lines, or a report ends up claiming something it does not mean. A
   * sentence cut in half is still read as a sentence.
   */
  it('drops whole lines and admits the count', () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i} with some words on it`).join('\n')
    const cut = clamp(text, 120)

    expect(cut.length).toBeLessThanOrEqual(120)
    expect(cut).toContain('more lines — the rest is in the app.')
    expect(cut.split('\n')[0]).toBe('line 0 with some words on it')
  })

  it('leaves anything that already fits completely alone', () => {
    expect(clamp('short', 120)).toBe('short')
  })
})

describe('shouldSend', () => {
  /**
   * The one judgement that spends money. A daily "nothing happened" is how a
   * channel gets muted, and a muted channel is the whole feature lost.
   */
  it('refuses a genuinely quiet window, with a reason worth showing', () => {
    const verdict = shouldSend(digest({ quiet: true }))

    expect(verdict.send).toBe(false)
    expect(verdict.send === false && verdict.because).toContain('Nothing happened')
  })

  it('sends when anything at all is in it', () => {
    expect(shouldSend(digest({
      missed: [{ id: 's', title: 'Nightly sweep', dueAt: NOW }],
    })).send).toBe(true)
  })
})
