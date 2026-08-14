import { describe, expect, it } from 'vitest'
import {
  intentFor, parsePulls, renderPullCommand, sortPulls, summarizePulls, turnForIntent,
  verdictFor, workPrompt,
  type Pull,
} from '../server/utils/reviews'

/**
 * A reviews page gets two things badly wrong if nobody pins them down: it tells
 * you something is waiting on you when it is not — which is how a badge becomes
 * noise nobody looks at — or it quietly turns "we could not ask GitHub" into
 * "nothing is wrong". Both are decided by `verdictFor` and by what `parsePulls`
 * does with a field that is not there, so both are decided here.
 */

const pull = (over: Partial<Pull> = {}): Pull => ({
  number: 7,
  title: 'Make it faster',
  url: 'https://github.com/o/r/pull/7',
  author: 'someone',
  mine: false,
  draft: false,
  headBranch: 'feature',
  baseBranch: 'main',
  headSha: 'abc123',
  createdAt: 1_000,
  updatedAt: 2_000,
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  reviewDecision: 'REVIEW_REQUIRED',
  mergeable: 'MERGEABLE',
  checks: 'passing',
  failing: [],
  awaiting: [],
  labels: [],
  unresolved: 0,
  approvals: 0,
  changesRequested: 0,
  ...over,
})

describe('where a pull request has got to', () => {
  it('puts a person ahead of a robot', () => {
    // Red *and* a reviewer waiting. You will fix the build on the way to
    // answering them either way, and only one of the two is a human being sat
    // at the other end wondering whether you saw it.
    const verdict = verdictFor(pull({
      mine: true,
      reviewDecision: 'CHANGES_REQUESTED',
      checks: 'failing',
      failing: [{ name: 'build', url: '' }],
    }))

    expect(verdict.state).toBe('changes-requested')
  })

  it('puts a conflict ahead of everything but a draft', () => {
    // Approved and green, against a merge that cannot happen. The approval was
    // given for a diff that is about to change.
    const verdict = verdictFor(pull({
      mine: true,
      mergeable: 'CONFLICTING',
      reviewDecision: 'APPROVED',
      checks: 'passing',
    }))

    expect(verdict.state).toBe('conflicted')
  })

  it('says ready when it is approved with nothing reporting, and says so', () => {
    // A repository with no CI is a real repository, and a person pressing the
    // button themselves is entitled to the distinction rather than a refusal.
    // The unattended path refuses this; see `decideWatch`.
    const verdict = verdictFor(pull({ mine: true, reviewDecision: 'APPROVED', checks: 'none' }))

    expect(verdict.state).toBe('ready')
    expect(verdict.detail).toContain('no checks reporting')
  })

  it('never counts unanswered comments it could not read', () => {
    // Null is "GitHub was not asked", and reading it as a count would invent a
    // thread that nobody wrote.
    const verdict = verdictFor(pull({ mine: true, unresolved: null }))

    expect(verdict.state).not.toBe('unanswered')
  })
})

describe('whether the next move is yours', () => {
  it('is not yours while a reviewer has it', () => {
    expect(verdictFor(pull({ mine: true })).onYou).toBe(false)
  })

  it('is yours once it is approved and green', () => {
    // Nothing is stopping it except you, which is exactly the case people lose
    // pull requests to.
    expect(verdictFor(pull({ mine: true, reviewDecision: 'APPROVED' })).onYou).toBe(true)
  })

  it('is nobody while the checks are still running', () => {
    // Not on you and not on them: there is nothing to do but wait, and a badge
    // saying otherwise would be a badge that is wrong every few minutes.
    const verdict = verdictFor(pull({ mine: true, checks: 'pending' }))
    expect(verdict.onYou).toBe(false)
  })

  it('is yours when the review was asked of you', () => {
    expect(verdictFor(pull({ mine: false })).onYou).toBe(true)
  })

  it('is not yours when somebody else opened a draft', () => {
    expect(verdictFor(pull({ mine: false, draft: true })).onYou).toBe(false)
  })
})

describe('what the button does', () => {
  it('offers a review on somebody else\'s, and nothing on their draft', () => {
    expect(intentFor(pull())).toBe('review')
    expect(intentFor(pull({ draft: true }))).toBe(null)
  })

  it('offers CI on your red one and the review on your criticised one', () => {
    expect(intentFor(pull({ mine: true, checks: 'failing', failing: [{ name: 'build', url: '' }] }))).toBe('fix')
    expect(intentFor(pull({ mine: true, reviewDecision: 'CHANGES_REQUESTED' }))).toBe('address')
  })

  it('offers the merge on a conflicting one, which is the most actionable state there is', () => {
    // Caught by pointing it at a real repository: a conflicted pull request of
    // mine was the only thing on the page marked as needing me and the only
    // row with no button on it.
    expect(intentFor(pull({ mine: true, mergeable: 'CONFLICTING' }))).toBe('update')
  })

  it('offers nothing on one that is simply waiting for a reviewer', () => {
    // There is no useful turn to send. A button here would be an invitation to
    // spend a run on being told the pull request is fine.
    expect(intentFor(pull({ mine: true }))).toBe(null)
  })
})

describe('the turn each one sends', () => {
  it('never lets any of them post to GitHub', () => {
    // The single worst thing this feature could do is leave a review under your
    // name that you have not read.
    const review = workPrompt(pull(), 'review')
    const address = workPrompt(pull({ mine: true }), 'address')
    const update = workPrompt(pull({ mine: true, mergeable: 'CONFLICTING' }), 'update')

    expect(review).toContain('Do not post anything to GitHub')
    expect(address).toContain('Do not reply on GitHub')
    // A conflict resolution is a real change to a branch other people are
    // reading, so it stops at the commit like everything else here.
    expect(update).toContain('Do not push it')
  })

  it('hands the CI fix the commit the checks actually failed on', () => {
    const prompt = workPrompt(
      pull({ mine: true, headSha: 'deadbee', checks: 'failing', failing: [{ name: 'lint', url: 'https://ci/1' }] }),
      'fix',
    )

    expect(prompt).toContain('deadbee')
    expect(prompt).toContain('lint')
    // Inherited from `fixPrompt`, and the reason it is reused rather than
    // rewritten: the shortest path from a red suite to a green one is deleting
    // the test.
    expect(prompt).toContain('Fix the failure, not the check')
  })
})

describe('reading what gh printed', () => {
  it('keeps a team review request, which has no login at all', () => {
    // A person arrives as `{ login }` and a team as `{ name, slug }`, in the
    // same array. Reading only `login` drops every team request silently — and
    // a request that reaches you through your team is the common one.
    const [parsed] = parsePulls([{
      number: 3,
      url: 'https://github.com/o/r/pull/3',
      author: { login: 'someone' },
      reviewRequests: [{ login: 'ana' }, { name: 'Platform', slug: 'platform' }],
    }], 'me')

    expect(parsed!.awaiting).toEqual([
      { name: 'ana', team: false },
      { name: 'platform', team: true },
    ])
  })

  it('decides "mine" against your login and not against an empty string', () => {
    // A viewer that failed to resolve must not make every pull request in the
    // repository yours.
    const rows = [{ number: 1, url: 'u', author: { login: 'me' } }]

    expect(parsePulls(rows, 'me')[0]!.mine).toBe(true)
    expect(parsePulls(rows, '')[0]!.mine).toBe(false)
  })

  it('starts every count as unknown rather than as zero', () => {
    const [parsed] = parsePulls([{ number: 1, url: 'u' }], 'me')

    expect(parsed!.unresolved).toBe(null)
    expect(parsed!.approvals).toBe(null)
  })
})

describe('the order and the summary', () => {
  it('leads with what is on you, then with what has been sitting longest', () => {
    const waiting = pull({ number: 1, mine: true, createdAt: 5_000 })
    const oldOnYou = pull({ number: 2, mine: true, reviewDecision: 'APPROVED', createdAt: 1_000 })
    const newOnYou = pull({ number: 3, mine: true, reviewDecision: 'APPROVED', createdAt: 9_000 })

    expect(sortPulls([waiting, newOnYou, oldOnYou]).map(p => p.number)).toEqual([2, 3, 1])
  })

  it('counts the four things the header claims', () => {
    const summary = summarizePulls(
      [pull({ number: 1 })],
      [
        pull({ number: 2, mine: true, reviewDecision: 'APPROVED' }),
        pull({ number: 3, mine: true }),
      ],
    )

    expect(summary).toEqual({ onYou: 2, toReview: 1, toMerge: 1, waiting: 1 })
  })
})

/**
 * The setting's whole promise is that a quick action can run your own command
 * on the right pull request. Two ways it could quietly break: a placeholder
 * left unfilled, or a bare `/hd:review` arriving with nothing that says which
 * pull request. Both are decided here.
 */
describe('renderPullCommand', () => {
  const p = pull({
    number: 42,
    title: 'Add caching',
    url: 'https://github.com/o/r/pull/42',
    headBranch: 'feat/cache',
    baseBranch: 'main',
  })

  it('is empty for an empty or whitespace template, so the built-in prompt wins', () => {
    expect(renderPullCommand('', p)).toBe('')
    expect(renderPullCommand('   ', p)).toBe('')
  })

  it('fills every placeholder from the pull request', () => {
    expect(renderPullCommand('/hd:review {url} #{number} "{title}" {branch}->{base}', p))
      .toBe('/hd:review https://github.com/o/r/pull/42 #42 "Add caching" feat/cache->main')
  })

  it('replaces a placeholder used more than once', () => {
    expect(renderPullCommand('{number} and again {number}', p)).toBe('42 and again 42')
  })

  it('appends the url when the template names no placeholder', () => {
    expect(renderPullCommand('/hd:review', p)).toBe('/hd:review https://github.com/o/r/pull/42')
  })

  it('does not append when a placeholder is present, even if it is not the url', () => {
    expect(renderPullCommand('/hd:review #{number}', p)).toBe('/hd:review #42')
  })
})

describe('turnForIntent', () => {
  const p = pull({ number: 9, url: 'https://github.com/o/r/pull/9', mine: false })

  it('uses the custom command when one is set for that intent', () => {
    expect(turnForIntent(p, 'review', { review: '/hd:review {url}' }))
      .toBe('/hd:review https://github.com/o/r/pull/9')
  })

  it('falls back to the built-in prompt when the intent has no command', () => {
    expect(turnForIntent(p, 'review', { address: '/hd:address {url}' }))
      .toBe(workPrompt(p, 'review'))
  })

  it('falls back to the built-in prompt when nothing is configured at all', () => {
    expect(turnForIntent(p, 'review')).toBe(workPrompt(p, 'review'))
    expect(turnForIntent(p, 'review', { review: '   ' })).toBe(workPrompt(p, 'review'))
  })
})
