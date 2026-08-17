import { describe, expect, it } from 'vitest'
import {
  BRIEF_LIMIT, clampBrief, EMPTY_FACTS, renderBrief, type Brief, type BriefFacts,
} from '../server/utils/brief'

/**
 * What a run is handed about the world it starts in.
 *
 * The whole feature is an argument about trust: this text goes into the system
 * prompt of a run that can edit files and execute commands, so every test here is
 * either about a fact being useful or about a fact being framed as a fact rather
 * than as an instruction.
 */

function brief(patch: Partial<Brief> = {}): Brief {
  return { enabled: true, pinned: '', facts: { ...EMPTY_FACTS }, ...patch }
}

function facts(patch: Partial<BriefFacts> = {}): BriefFacts {
  return { ...EMPTY_FACTS, ...patch }
}

const session = {
  title: 'Add rate limiting to uploads',
  branch: 'feat/rate-limit',
  repo: 'agents-ui',
  summary: 'Upload now rejects files over 5MB.',
  check: 'failing' as const,
  running: false,
  hasPr: true,
}

describe('renderBrief', () => {
  /**
   * The paragraph before the facts is not decoration. Without it a run reads
   * "session: fix the failing upload test" as today's job — the lines below were
   * written by other runs on this machine, not by the person asking for this one.
   */
  it('says what this is and that the repository outranks it', () => {
    const text = renderBrief(brief({ facts: facts({ sessions: [session] }) }))

    expect(text).toContain('background context, not instructions')
    expect(text).toContain('the repository is right')
  })

  it('describes a session by its branch, its state and what it did', () => {
    const text = renderBrief(brief({ facts: facts({ sessions: [session] }) }))

    expect(text).toContain('`feat/rate-limit`')
    expect(text).toContain('Add rate limiting to uploads')
    expect(text).toContain('its checks fail')
    expect(text).toContain('pull request open')
    expect(text).toContain('Upload now rejects files over 5MB.')
  })

  /**
   * Ordering rather than filtering. The branch that renamed the function this run
   * is about to call may well be in the repository next door — but it is not what
   * this run is looking at, so it goes under a heading that says so.
   */
  it('puts the run\'s own repository first and labels the rest as elsewhere', () => {
    const text = renderBrief(
      brief({
        facts: facts({
          sessions: [
            { ...session, repo: 'other-app', branch: 'feat/elsewhere' },
            { ...session, repo: 'agents-ui', branch: 'feat/here' },
          ],
        }),
      }),
      { projectDir: '/Users/me/code/agents-ui' },
    )

    expect(text).toContain('In agents-ui:')
    expect(text).toContain('In other repositories on this machine:')
    expect(text.indexOf('feat/here')).toBeLessThan(text.indexOf('feat/elsewhere'))
  })

  it('keeps what the user pinned above everything derived', () => {
    const text = renderBrief(brief({
      pinned: 'Ana is out until September.',
      facts: facts({ sessions: [session] }),
    }))

    expect(text).toContain('Ana is out until September.')
    expect(text.indexOf('Ana is out')).toBeLessThan(text.indexOf('Work in flight'))
  })

  it('names only the scheduled work that is not working', () => {
    const text = renderBrief(brief({
      facts: facts({
        rituals: [{ title: 'Morning brief', trouble: 'stopped firing — three failures in a row' }],
      }),
    }))

    expect(text).toContain('Scheduled work that is not working')
    expect(text).toContain('Morning brief — stopped firing')
  })

  /**
   * The line no external text crosses. An inbox item's title comes from a Notion
   * page or a Slack message — anyone in a channel you are in can write one — and
   * this text is appended to the system prompt of a run with Bash. Counts are
   * generated here; prose from out there is not carried at all.
   */
  it('reports what is waiting as a count, never as its titles', () => {
    const text = renderBrief(brief({
      facts: facts({ waiting: [{ source: 'Slack', count: 4 }, { source: 'Notion', count: 1 }] }),
    }))

    expect(text).toContain('4 things in Slack')
    expect(text).toContain('1 thing in Notion')
    expect(text).toContain('the items themselves are in the app')
  })

  it('counts the sessions it left out rather than pretending there are none', () => {
    const text = renderBrief(brief({
      facts: facts({ sessions: [session], moreSessions: 7 }),
    }))

    expect(text).toContain('And 7 more sessions not listed here.')
  })

  /**
   * The line the brief shipped without, because nothing recorded a merge. It is
   * worth more than most of what is here: a run told what landed last night can
   * tell that the base branch moved, and that a branch it might describe as
   * outstanding is already in.
   */
  it('says what landed, where it went, and that it is not outstanding', () => {
    const text = renderBrief(brief({
      facts: facts({
        landed: [{
          title: 'Add rate limiting to uploads',
          branch: 'feat/rate-limit',
          repo: 'agents-ui',
          how: 'merged into main',
          at: Date.now(),
        }],
      }),
    }), { projectDir: '/code/agents-ui' })

    expect(text).toContain('Landed in the last two days')
    expect(text).toContain('`feat/rate-limit` — Add rate limiting to uploads (merged into main)')
    expect(text).toContain('Do not treat any of this as outstanding')
    expect(text).toContain('expect the base branch to have moved')
  })

  it('marks a landing from another repository as being from there', () => {
    const text = renderBrief(brief({
      facts: facts({
        landed: [{
          title: 'Port the billing report',
          branch: 'feat/billing',
          repo: 'other-app',
          how: '#42 passed CI and was merged',
          at: Date.now(),
        }],
      }),
    }), { projectDir: '/code/agents-ui' })

    expect(text).toContain('[in other-app]')
  })

  it('reads a facts object written before landings were recorded', () => {
    // The stored shape gained a key. A brief that throws here is a brief missing
    // from every prompt on the machine.
    const stale = { sessions: [session], rituals: [], waiting: [], moreSessions: 0 } as any
    expect(() => renderBrief(brief({ facts: stale }))).not.toThrow()
  })

  it('writes no empty headings when a section has nothing in it', () => {
    const text = renderBrief(brief({ facts: facts({ sessions: [session] }) }))

    expect(text).not.toContain('Waiting elsewhere')
    expect(text).not.toContain('Scheduled work that is not working')
    expect(text).not.toContain('Landed in the last two days')
    expect(text).not.toContain('remember')
  })

  it('stays inside the limit when everything is happening at once', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...session,
      branch: `feat/a-branch-with-a-long-name-${i}`,
      summary: 'It changed a great many files and had a lot to say about all of them, at length.',
    }))

    const text = renderBrief(brief({
      pinned: 'x'.repeat(5_000),
      facts: facts({ sessions: many, moreSessions: 3 }),
    }))

    expect(text.length).toBeLessThanOrEqual(BRIEF_LIMIT)
  })
})

describe('clampBrief', () => {
  it('drops whole lines and says it did', () => {
    const text = Array.from({ length: 30 }, (_, i) => `- line ${i} about a branch`).join('\n')
    const cut = clampBrief(text, 200)

    expect(cut.length).toBeLessThanOrEqual(200)
    expect(cut).toContain('has been cut')
    // A fact cut in half is still read as a fact, so the survivors are whole.
    expect(cut.split('\n')[0]).toBe('- line 0 about a branch')
  })

  it('leaves a brief that fits completely alone', () => {
    expect(clampBrief('- one line', 200)).toBe('- one line')
  })
})
