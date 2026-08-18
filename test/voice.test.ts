import { describe, expect, it } from 'vitest'
import { describe as say, matchProject, needsConfirmation, parseCommand } from '../app/utils/voice'

/**
 * The grammar, and — more importantly — its edges.
 *
 * Voice is the least authenticated input this app has: anything audible in the
 * room can speak it. So most of what is tested here is what the parser *will not
 * do*, and the case that matters most is the one that hides a refused verb inside
 * an allowed one.
 */

describe('what it no longer answers', () => {
  /**
   * The rotation went with cinema mode, and its phrases went with it. Asserted
   * rather than deleted, because the important half is what these must *not*
   * become: a phrase that used to move a screen and now falls through to the
   * rest of the grammar is one that could land somewhere that acts.
   */
  it('reports a request to look at something as not understood', () => {
    for (const said of ['show me the fleet', 'show the night', 'next', 'go back', 'carry on']) {
      expect(parseCommand(said).kind, said).toBe('unknown')
    }
  })

  it('does not ask a hand to confirm something it will not do anyway', () => {
    expect(needsConfirmation(parseCommand('show the fleet'))).toBe(false)
    expect(needsConfirmation(parseCommand('next'))).toBe(false)
  })
})

describe('starting a session', () => {
  it('takes the instruction as spoken', () => {
    expect(parseCommand('start a session that fixes the failing checks')).toEqual({
      kind: 'session',
      instruction: 'fixes the failing checks',
      project: undefined,
    })
  })

  it('understands the several ways of asking', () => {
    for (const opener of ['start a session to', 'begin a session which', 'new session', 'create a session for']) {
      const command = parseCommand(`${opener} update the changelog`)
      expect(command.kind).toBe('session')
      expect((command as { instruction: string }).instruction).toBe('update the changelog')
    }
  })

  it('picks the project off the end of the sentence', () => {
    expect(parseCommand('start a session that rate limits search in billing')).toEqual({
      kind: 'session',
      instruction: 'rate limits search',
      project: 'billing',
    })

    expect(parseCommand('start a session that fixes the tests on the storefront repo')).toEqual({
      kind: 'session',
      instruction: 'fixes the tests',
      project: 'storefront',
    })
  })

  it('refuses a session with nothing to do', () => {
    // Far more likely to be half a sentence than a request for an empty
    // worktree somebody then has to tidy up.
    expect(parseCommand('start a session').kind).toBe('unknown')
    expect(parseCommand('start a new session that').kind).toBe('unknown')
  })

  it('always wants a hand before it runs', () => {
    expect(needsConfirmation(parseCommand('start a session that fixes the build'))).toBe(true)
  })
})

describe('stopping', () => {
  it('is the one broad verb, because a brake should be easy to reach', () => {
    expect(parseCommand('stop')).toEqual({ kind: 'stop', project: undefined })
    expect(parseCommand('stop everything')).toEqual({ kind: 'stop', project: undefined })
    expect(parseCommand('stop what is running in billing')).toEqual({ kind: 'stop', project: 'billing' })
  })

  it('is still confirmed, since it ends a turn somebody started', () => {
    expect(needsConfirmation(parseCommand('stop'))).toBe(true)
  })
})

describe('what it will not do', () => {
  it('refuses the irreversible verbs by name', () => {
    for (const phrase of ['merge the billing branch', 'ship it', 'push that branch', 'open a pr for it']) {
      const command = parseCommand(phrase)
      expect(command.kind).toBe('refused')
      expect((command as { verb: string }).verb).toBe('merge')
    }
  })

  it('refuses deletions and permission answers', () => {
    expect((parseCommand('delete that worktree') as { verb: string }).verb).toBe('delete')
    expect((parseCommand('approve the permission request') as { verb: string }).verb).toBe('approve')
    expect((parseCommand('allow it') as { verb: string }).verb).toBe('approve')
  })

  it('refuses to be talked into raising a spending cap', () => {
    expect((parseCommand('raise the daily cap') as { verb: string }).verb).toBe('settings')
    expect((parseCommand('turn off the sandbox') as { verb: string }).verb).toBe('settings')
  })

  it('does not let a refused verb ride in on an allowed one', () => {
    // The case this ordering exists for: read as a session, this would launch an
    // agent whose entire instruction is the thing that was just refused.
    const command = parseCommand('start a session that merges the billing branch')
    expect(command.kind).toBe('refused')
  })

  it('tells a question about landing apart from an order to land', () => {
    // The past tense is how people ask, and asking is not refused — which is why
    // `landed` is deliberately missing from the merge pattern. Nothing answers the
    // question any more, so "not understood" is the honest outcome; being *refused*
    // would not be, and that is what this guards.
    expect(parseCommand('what landed today').kind).not.toBe('refused')
    expect(parseCommand('land it').kind).toBe('refused')
    expect(parseCommand('land the billing branch').kind).toBe('refused')
  })

  it('says why, in words worth putting on a wall', () => {
    expect(say(parseCommand('merge it'))).toMatch(/not something a voice can do/)
    expect(say(parseCommand('approve it'))).toMatch(/anything in the room/)
  })

  it('reports what it heard rather than guessing', () => {
    const command = parseCommand('the coffee machine is broken again')
    expect(command.kind).toBe('unknown')
    expect(say(command)).toContain('the coffee machine is broken again')
  })

  it('has nothing to say about silence', () => {
    expect(parseCommand('   ')).toEqual({ kind: 'unknown', heard: '' })
    expect(say(parseCommand(''))).toBe('Nothing heard')
  })
})

describe('naming a project out loud', () => {
  const projects = [
    { path: '/code/billing-service', name: 'billing-service' },
    { path: '/code/storefront', name: 'storefront' },
    { path: '/code/docs', name: 'docs' },
  ]

  it('matches the folder exactly, then by prefix, then by any word in it', () => {
    expect(matchProject('storefront', projects)?.name).toBe('storefront')
    expect(matchProject('billing', projects)?.name).toBe('billing-service')
    expect(matchProject('service', projects)?.name).toBe('billing-service')
  })

  it('hears a two-word name as the hyphenated folder', () => {
    expect(matchProject('billing service', projects)?.name).toBe('billing-service')
  })

  it('answers nothing rather than the wrong repository', () => {
    // The caller falls back to the project you are already in, which is a far
    // better wrong answer than somebody else's repo.
    expect(matchProject('marketing', projects)).toBeNull()
    expect(matchProject(undefined, projects)).toBeNull()
  })
})
