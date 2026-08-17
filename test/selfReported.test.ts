import { describe, expect, it } from 'vitest'
import { describeSkipped, parseSkipped, withoutSkipped } from '../server/utils/selfReported'

/**
 * A run that came back half-done without anything having gone wrong.
 *
 * Every other kind of incomplete run is visible from outside it: a tool was
 * denied, a host was refused, the turns ran out. This one is not. The connector
 * answered with an authorization error, the workspace hit a usage limit, and
 * the run wrote a line about it and carried on — which is the right thing to do
 * and leaves the only record of it in prose.
 *
 * The block below is the real output of `Morning brief`, 17 August 2026,
 * verbatim from `~/.claude/agents-ui/runs`. It completed, cost $1.67, and the
 * digest filed it under "1 scheduled run went through without trouble" — over a
 * briefing written without a calendar, without mail, and with the Notion tasks
 * table cut off partway. Priority 4 of its 6 came from Notion.
 */
const BRIEF = `No focus note given, so this is a straight read across GitHub, Notion, and Slack.

# goodmorning, David — Monday, August 17, 2026

\`[SKIP]\` **Google Calendar** — connector not authorized in this session, so I have no meeting data. The plan below assumes a full open day; re-shape it against your real calendar.
\`[SKIP]\` **Gmail** — connector not authorized.
\`[SKIP]\` **Notion tasks DB** — workspace hit its Query Data Source usage limit mid-pull. Support tickets came through; the "Tickets for the Product Team" tasks table did not.

## The shape of today

You come back to one genuinely urgent thing: **PR #5288** has been sitting unmerged for 10 days.

## Next step

Rebase PR #5288 onto master and resolve the conflicts:

\`\`\`
gh pr checkout 5288 && git fetch origin && git rebase origin/master
\`\`\`
`

describe('parseSkipped', () => {
  it('reads the three sources this morning\'s brief was written without', () => {
    expect(parseSkipped(BRIEF)).toEqual([
      {
        source: 'Google Calendar',
        reason: 'connector not authorized in this session, so I have no meeting data. '
          + 'The plan below assumes a full open day; re-shape it against your real calendar.',
      },
      { source: 'Gmail', reason: 'connector not authorized.' },
      {
        source: 'Notion tasks DB',
        reason: 'workspace hit its Query Data Source usage limit mid-pull. Support tickets '
          + 'came through; the "Tickets for the Product Team" tasks table did not.',
      },
    ])
  })

  it('costs nothing on the ordinary output, which has no marker in it', () => {
    expect(parseSkipped('# goodmorning\n\nEverything was reachable.')).toEqual([])
    expect(parseSkipped(undefined)).toEqual([])
  })

  /*
   * The skill is told to "note it as a one-line `[SKIP]`" and nothing more, so
   * the decoration around it is whatever the model reached for that morning.
   * Being strict about it would mean reading three sources one day and none the
   * next, for a reason no person could see from the page.
   */
  it('takes the marker however it was dressed', () => {
    expect(parseSkipped('- [SKIP] Slack: rate limited')).toEqual([
      { source: 'Slack', reason: 'rate limited' },
    ])
    expect(parseSkipped('**[SKIP]** Linear – workspace not connected')).toEqual([
      { source: 'Linear', reason: 'workspace not connected' },
    ])
    expect(parseSkipped('`[SKIP]`: Gmail - token expired')).toEqual([
      { source: 'Gmail', reason: 'token expired' },
    ])
  })

  it('takes a bare source with no reason given', () => {
    expect(parseSkipped('[SKIP] Google Drive')).toEqual([
      { source: 'Google Drive', reason: '' },
    ])
  })

  /*
   * A reason is a sentence, and sentences contain dashes. Splitting on the last
   * separator rather than the first put half the explanation into the name of
   * the service.
   */
  it('splits at the first separator, not inside the reason', () => {
    expect(parseSkipped('[SKIP] Notion — usage limit — retried twice, still capped')).toEqual([
      { source: 'Notion', reason: 'usage limit — retried twice, still capped' },
    ])
  })

  it('ignores the marker in prose and in fenced code', () => {
    // Documentation of the convention is not a source that failed, and the
    // skill's own SKILL.md is the most likely thing to be quoted at it.
    expect(parseSkipped('Sources that error get a `[SKIP]` line and the brief continues.'))
      .toEqual([])
    expect(parseSkipped('```\n[SKIP] Example — from the docs\n```')).toEqual([])
  })

  it('reports a source skipped twice once', () => {
    expect(parseSkipped('[SKIP] Gmail — not authorized\n[SKIP] gmail — not authorized'))
      .toHaveLength(1)
  })

  it('stops after eight, because that is a broken output rather than a report', () => {
    const many = Array.from({ length: 20 }, (_, i) => `[SKIP] Source ${i} — gone`).join('\n')
    expect(parseSkipped(many)).toHaveLength(8)
  })
})

/**
 * The sentence says the consequence, not the count. Three things failed is not
 * actionable; "what it did not mention is missing rather than empty" is the
 * whole reason to read the list, and it is the difference between "Slack is
 * quiet" and never having asked Slack.
 */
describe('describeSkipped', () => {
  it('names them and says what it means for the rest of the brief', () => {
    expect(describeSkipped(parseSkipped(BRIEF))).toBe(
      'Ran without Google Calendar, Gmail and Notion tasks DB, so anything it did not '
      + 'mention from those sources is missing rather than empty.',
    )
  })

  it('reads as one thing when it is one thing', () => {
    expect(describeSkipped([{ source: 'Gmail', reason: '' }])).toBe(
      'Ran without Gmail, so anything it did not mention from that source is missing '
      + 'rather than empty.',
    )
  })

  it('names three, then counts', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map(source => ({ source, reason: '' }))
    expect(describeSkipped(five)).toContain('a, b, c and 2 more')
  })

  it('says nothing when there is nothing to say', () => {
    expect(describeSkipped([])).toBe('')
  })
})

/**
 * The caveats are written first, which is right in the document and wrong in a
 * list row. The 160 characters this morning's brief got on the Now page were
 * mostly an apology for a connector, cut off mid-word, and the briefing itself
 * did not appear in them at all.
 */
describe('withoutSkipped', () => {
  it('leaves the preview showing what the run actually produced', () => {
    const preview = withoutSkipped(BRIEF).replace(/[\s#*`>-]+/g, ' ').trim().slice(0, 160)

    expect(preview).not.toContain('[SKIP]')
    // It gets as far as the brief beginning, which the caveats used to spend
    // the whole row on reaching.
    expect(preview).toContain('The shape of today')
    expect(preview).toContain('You come back')
  })

  it('changes nothing when there is nothing to take out', () => {
    const plain = '# goodmorning\n\nAll six sources answered.'
    expect(withoutSkipped(plain)).toBe(plain)
  })

  it('leaves fenced code alone, marker and all', () => {
    const fenced = 'Ran.\n\n```\n[SKIP] Example — from the docs\n```'
    expect(withoutSkipped(fenced)).toBe(fenced)
  })
})
