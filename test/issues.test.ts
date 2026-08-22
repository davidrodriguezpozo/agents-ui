import { describe, expect, it } from 'vitest'
import {
  branchNamesIssue, conversationsIn, decorateIssue, isReallyAPull, issueVerdict, parseIssues,
  sessionOnIssue, sortIssues, withConversation,
  type Issue, type IssueSession, type RawIssue,
} from '../server/utils/issues'

/**
 * An issue band gets three things badly wrong if nobody pins them down.
 *
 * It shows a pull request as an issue — GitHub keeps both in one table and hands
 * back both from anything that searches it — which offers work on a ticket
 * number that means something else entirely. It claims somebody is waiting on
 * you because the last comment happens not to be yours, which turns a band of
 * two real obligations into a band of forty. Or it says "has a session already"
 * about a branch belonging to another repository, or to an issue whose number
 * merely shares digits with this one.
 *
 * All three are decided by the pure half of `issues.ts`, so all three are
 * decided here.
 */

const issue = (over: Partial<Issue> = {}): Issue => ({
  number: 42,
  title: 'Drop the cache',
  url: 'https://github.com/o/r/issues/42',
  author: 'marta',
  assignees: [],
  labels: [],
  createdAt: 1_000,
  updatedAt: 2_000,
  assignedToYou: false,
  youAuthored: false,
  lastCommenter: null,
  youCommented: false,
  comments: 0,
  session: null,
  ...over,
})

const session = (over: Partial<IssueSession> = {}): IssueSession => ({
  id: 's1',
  title: 'Drop the cache',
  branch: '42-drop-the-cache',
  status: 'idle' as IssueSession['status'],
  updatedAt: 5_000,
  ...over,
})

describe('an issue that is really a pull request', () => {
  it('is dropped whichever way GitHub said so', () => {
    const rows: RawIssue[] = [
      { number: 1, title: 'A real issue', url: 'https://github.com/o/r/issues/1' },
      // The REST list marks it with an object.
      { number: 2, title: 'A pull', url: 'https://github.com/o/r/issues/2', pull_request: { url: 'x' } },
      // The GraphQL search marks it with a type.
      { number: 3, title: 'Another pull', url: 'https://github.com/o/r/issues/3', isPullRequest: true },
      // And the URL says it outright whichever of them answered.
      { number: 4, title: 'A third pull', url: 'https://github.com/o/r/pull/4' },
    ]

    expect(parseIssues(rows, 'you').map(i => i.number)).toEqual([1])
  })

  it('does not mistake an issue whose title mentions a pull request', () => {
    expect(isReallyAPull({
      number: 9,
      title: 'Reviewing /pull/12 is slow',
      url: 'https://github.com/o/r/issues/9',
    })).toBe(false)
  })

  it('keeps a row whose pull_request field is explicitly null', () => {
    // Some GitHub responses carry the key with nothing in it. Testing for the
    // key alone would drop every issue in the list.
    expect(isReallyAPull({
      number: 9,
      url: 'https://github.com/o/r/issues/9',
      pull_request: null,
    })).toBe(false)
  })
})

describe('reading what gh said', () => {
  it('decides assigned-to-you and authored-by-you against the viewer', () => {
    const [parsed] = parseIssues([{
      number: 42,
      title: 'Drop the cache',
      url: 'https://github.com/o/r/issues/42',
      author: { login: 'you' },
      assignees: [{ login: 'marta' }, { login: 'you' }],
      labels: [{ name: 'studio', color: 'ff0000' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    }], 'you')

    expect(parsed?.assignedToYou).toBe(true)
    expect(parsed?.youAuthored).toBe(true)
    expect(parsed?.assignees).toEqual(['marta', 'you'])
    expect(parsed?.labels).toEqual([{ name: 'studio', color: 'ff0000' }])
    expect(parsed?.createdAt).toBe(Date.parse('2026-01-01T00:00:00Z'))
  })

  it('claims nothing when nobody is signed in', () => {
    // An empty viewer must not make every issue yours.
    const [parsed] = parseIssues([{
      number: 42,
      url: 'https://github.com/o/r/issues/42',
      author: { login: '' },
      assignees: [{ login: '' }],
    }], '')

    expect(parsed?.assignedToYou).toBe(false)
    expect(parsed?.youAuthored).toBe(false)
  })

  it('survives a row with nothing on it but a number and a url', () => {
    const [parsed] = parseIssues([{ number: 42, url: 'https://github.com/o/r/issues/42' }], 'you')

    expect(parsed?.title).toBe('(untitled)')
    expect(parsed?.author).toBe('someone')
    expect(parsed?.createdAt).toBe(0)
    expect(parsed?.labels).toEqual([])
  })
})

describe('reading the conversation query back', () => {
  it('keeps the aliases that resolved when one of them did not', () => {
    // What GitHub really answers when a number in the batch has been
    // transferred away, cut down from a live reply. `gh` exits non-zero on the
    // `errors` array having already printed this, so throwing the batch away
    // would cost every other issue its conversation for one bad neighbour.
    const stdout = JSON.stringify({
      data: {
        repository: {
          i14223: { number: 14223, comments: { totalCount: 3, nodes: [{ author: { login: 'favilo' } }] } },
          i1: null,
        },
      },
      errors: [{ type: 'NOT_FOUND', path: ['repository', 'i1'] }],
    })

    const map = conversationsIn(stdout)

    expect([...map.keys()]).toEqual([14223])
    expect(map.get(14223)).toEqual({ commenters: ['favilo'], total: 3 })
  })

  it('drops a comment whose author has deleted their account', () => {
    const stdout = JSON.stringify({
      data: {
        repository: {
          i7: { number: 7, comments: { totalCount: 2, nodes: [{ author: null }, { author: { login: 'marta' } }] } },
        },
      },
    })

    // Two comments happened; only one of them has somebody at the other end.
    expect(conversationsIn(stdout).get(7)).toEqual({ commenters: ['marta'], total: 2 })
  })

  it('is an empty map rather than a throw when there is nothing to read', () => {
    expect(conversationsIn('').size).toBe(0)
    expect(conversationsIn('not json').size).toBe(0)
    expect(conversationsIn('{"errors":[{"message":"Bad credentials"}]}').size).toBe(0)
  })
})

describe('folding in what was said', () => {
  it('leaves the last commenter null when the last word was yours', () => {
    const folded = withConversation(issue(), { commenters: ['marta', 'you'], total: 2 }, 'you')

    expect(folded.lastCommenter).toBeNull()
    expect(folded.youCommented).toBe(true)
    expect(folded.comments).toBe(2)
  })

  it('names the last commenter when it was somebody else', () => {
    const folded = withConversation(issue(), { commenters: ['you', 'marta'], total: 2 }, 'you')

    expect(folded.lastCommenter).toBe('marta')
    expect(folded.youCommented).toBe(true)
  })

  it('changes nothing when GitHub was not asked', () => {
    // A missing entry is "we did not check", and must not read as "nobody
    // commented" — the verdict below turns on exactly that difference.
    const folded = withConversation(issue({ comments: 0 }), undefined, 'you')

    expect(folded.lastCommenter).toBeNull()
    expect(folded.comments).toBe(0)
  })
})

describe('where an issue has got to', () => {
  it('puts a person waiting ahead of a session already running', () => {
    // Same rule the pull requests keep: somebody is sat at the other end of one
    // of these wondering whether you saw it, and a running session does not
    // answer them.
    const verdict = issueVerdict(issue({
      assignedToYou: true,
      assignees: ['you'],
      lastCommenter: 'marta',
      session: { id: 's1', title: 'Drop the cache' },
    }))

    expect(verdict.state).toBe('awaiting-reply')
    expect(verdict.onYou).toBe(true)
  })

  it('does not call an issue you have never touched a reply you owe', () => {
    // Labelled `studio`, filed by somebody else, commented on by somebody else.
    // Read literally, "the last comment is not yours" would make this yours.
    const verdict = issueVerdict(issue({ lastCommenter: 'marta', comments: 3 }))

    expect(verdict.state).toBe('unassigned')
    expect(verdict.onYou).toBe(false)
  })

  it('does owe a reply on one you have spoken on', () => {
    const verdict = issueVerdict(issue({ youCommented: true, lastCommenter: 'marta' }))

    expect(verdict.state).toBe('awaiting-reply')
  })

  it('does owe a reply on one you filed', () => {
    const verdict = issueVerdict(issue({ youAuthored: true, lastCommenter: 'marta' }))

    expect(verdict.state).toBe('awaiting-reply')
  })

  it('says a session has it rather than inviting you to start again', () => {
    const verdict = issueVerdict(issue({
      assignedToYou: true,
      assignees: ['you'],
      session: { id: 's1', title: 'Drop the cache' },
    }))

    expect(verdict.state).toBe('has-session')
    // Nothing is asked of you until the session reports, so it must not be
    // sorted up among the things that are.
    expect(verdict.onYou).toBe(false)
    expect(verdict.detail).toBe('Drop the cache')
  })

  it('separates assigned to you from assigned to somebody else', () => {
    expect(issueVerdict(issue({ assignedToYou: true, assignees: ['you'] })).state).toBe('assigned')

    // Here because of its label. Calling this "Unassigned" would be false, and a
    // false badge is worse than a fifth one.
    const theirs = issueVerdict(issue({ assignees: ['marta'] }))
    expect(theirs.state).toBe('assigned-elsewhere')
    expect(theirs.label).toBe('Assigned to marta')
    expect(theirs.onYou).toBe(false)
  })

  it('counts the people when more than one has it', () => {
    expect(issueVerdict(issue({ assignees: ['marta', 'sam'] })).label).toBe('Assigned to 2 people')
  })

  it('calls nobody-has-it unassigned, and does not put it on you', () => {
    const verdict = issueVerdict(issue())

    expect(verdict.state).toBe('unassigned')
    // An invitation, not an obligation. A band that reads the two as the same
    // thing is a band whose ordering means nothing.
    expect(verdict.onYou).toBe(false)
  })
})

describe('the order the band draws them in', () => {
  it('puts what is on you first, then the oldest', () => {
    const sorted = sortIssues([
      issue({ number: 1, createdAt: 5_000 }),
      issue({ number: 2, assignedToYou: true, assignees: ['you'], createdAt: 9_000 }),
      issue({ number: 3, createdAt: 1_000 }),
      issue({ number: 4, assignedToYou: true, assignees: ['you'], createdAt: 2_000 }),
    ])

    expect(sorted.map(i => i.number)).toEqual([4, 2, 3, 1])
  })
})

describe('the session already on it', () => {
  it('matches the number as written, not as a number', () => {
    expect(branchNamesIssue('42-drop-the-cache', 42)).toBe(true)
    expect(branchNamesIssue('fix/issue-42', 42)).toBe(true)
    expect(branchNamesIssue('feat/42', 42)).toBe(true)

    // `Number('06') === 6` would say this branch is work on issue #6. It is not.
    expect(branchNamesIssue('plan-06-issue-band', 6)).toBe(false)
    // And a longer number is a different issue.
    expect(branchNamesIssue('420-something-else', 42)).toBe(false)
    expect(branchNamesIssue('', 42)).toBe(false)
  })

  it('prefers the drifted branch, which is where the commits are', () => {
    const found = sessionOnIssue(42, [session({ branch: 'main', driftedTo: '42-drop-the-cache' })])

    expect(found?.id).toBe('s1')
  })

  it('leaves archived sessions out', () => {
    const archived = session({ status: 'archived' as IssueSession['status'] })

    expect(sessionOnIssue(42, [archived])).toBeNull()
  })

  it('shows the one you were last in when two match', () => {
    const found = sessionOnIssue(42, [
      session({ id: 'old', updatedAt: 1_000 }),
      session({ id: 'new', updatedAt: 9_000 }),
    ])

    expect(found?.id).toBe('new')
  })
})

describe('what the page is handed', () => {
  it('carries the verdict rather than leaving it to be decided again', () => {
    const decorated = decorateIssue(issue({ assignedToYou: true, assignees: ['you'] }))

    expect(decorated.verdict.state).toBe('assigned')
    expect(decorated.number).toBe(42)
  })
})
