import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * The one comment this app writes to a tracker.
 *
 * Every case here is a way it could be the wrong comment rather than a way it
 * could be a missing one, because those are the two failures with different
 * costs: an unposted comment is a person not being told something they can read
 * on GitHub anyway, and a wrongly posted one lands on somebody else's issue under
 * your name.
 *
 * `gh` is replaced rather than run, and what replaces it records every call. That
 * is the only way to prove the claim that actually matters — that a Notion ticket
 * and a setting left off produce **no attempt**, not a failed one.
 */

/** Every `gh` invocation the code under test made, with what it put on stdin. */
const spawned = vi.hoisted(() => [] as { command: string; args: string[]; stdin: string }[])

/** What the next fake `gh` prints, and how it exits. */
const reply = vi.hoisted(() => ({ stdout: '', code: 0, stderr: '' }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()

  return {
    ...actual,
    spawn: (command: string, args: string[]) => {
      const child: any = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()

      /*
       * The whole exchange happens on `stdin.end`, which is deliberate rather
       * than lazy: `postComment` attaches its listeners synchronously and ends
       * stdin last, so emitting from here means no timers and no ordering to get
       * wrong. It also puts the body in front of the assertions, which is the
       * thing being checked.
       */
      child.stdin = {
        end: (stdin: string) => {
          spawned.push({ command, args, stdin })
          if (reply.stderr) child.stderr.emit('data', reply.stderr)
          if (reply.stdout) child.stdout.emit('data', reply.stdout)
          child.emit('close', reply.code)
        },
      }

      return child
    },
  }
})

let dir: string
let work: string
let issueReply: typeof import('../server/utils/issueReply')
let preferences: typeof import('../server/utils/preferences')
let sessions: typeof import('../server/utils/sessions')

const ISSUE = { number: 42, url: 'https://github.com/acme/app/issues/42', title: 'Totals are wrong' }
const PR = 'https://github.com/acme/app/pull/57'
const COMMENT = 'https://github.com/acme/app/issues/42#issuecomment-9001'

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-issue-reply-'))
  // Never the real one: this store holds live sessions.
  process.env.CLAUDE_DIR = dir
  // A directory that exists, because `replyToIssue` refuses to ask GitHub from a
  // workspace that is gone.
  work = await mkdtemp(join(tmpdir(), 'agents-ui-issue-reply-work-'))

  issueReply = await import('../server/utils/issueReply')
  preferences = await import('../server/utils/preferences')
  sessions = await import('../server/utils/sessions')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
})

beforeEach(async () => {
  spawned.length = 0
  reply.stdout = JSON.stringify({ html_url: COMMENT })
  reply.code = 0
  reply.stderr = ''
  await sessions.writeSessions([])
  await preferences.savePreferences({ issueWriteback: true })
})

/** A session on record, in the shape the endpoint would have patched it into. */
async function record(patch: Partial<import('../server/utils/sessions').Session> = {}) {
  return sessions.saveSession({
    id: 'sess-1',
    title: '#42 Totals are wrong',
    repoDir: work,
    worktreePath: work,
    branch: '42-totals-are-wrong',
    baseBranch: 'main',
    baseSha: 'abc',
    status: 'idle',
    runIds: [],
    createdAt: 1,
    updatedAt: 1,
    prUrl: PR,
    issueOf: ISSUE,
    summary: { text: 'Rounded tax to whole cents in the invoice total', fingerprint: 'f', costUsd: 0, at: 1 },
    ...patch,
  })
}

describe('what the comment says', () => {
  it('names the pull request, says what was done, and admits nobody has read it', () => {
    const body = issueReply.issueCommentBody(PR, 'Rounded tax to whole cents in the invoice total')

    // The number as well as the link: a notification email shows the text, and
    // "#57" is what somebody types back at you.
    expect(body).toContain('#57')
    expect(body).toContain(PR)
    expect(body).toContain('Rounded tax to whole cents in the invoice total')
    expect(body).toContain('No person has reviewed it yet')
  })

  it('goes out without the sentence when there is no summary', () => {
    // `summariseSessions` is a preference and can be off. A comment that talks
    // about the absence of a summary is worse than one that does not mention it.
    const body = issueReply.issueCommentBody(PR, undefined)

    expect(body).toContain(PR)
    expect(body).toContain('No person has reviewed it yet')
    expect(body).not.toMatch(/summary|unavailable/i)
  })

  it('still links the pull request when the URL is not one it can read a number from', () => {
    const body = issueReply.issueCommentBody('https://example.test/somewhere-else')

    expect(body).toContain('https://example.test/somewhere-else')
  })
})

describe('whether the pull request already said it', () => {
  it('counts a closing keyword and a bare mention', () => {
    expect(issueReply.mentionsIssue('Closes #42', 42, ISSUE.url)).toBe(true)
    expect(issueReply.mentionsIssue('Part of the work on #42, see there', 42, ISSUE.url)).toBe(true)
  })

  it('counts the full URL, and a cross-repository mention', () => {
    expect(issueReply.mentionsIssue(`Fixes ${ISSUE.url}`, 42, ISSUE.url)).toBe(true)
    expect(issueReply.mentionsIssue('Fixes acme/app#42', 42, ISSUE.url)).toBe(true)
  })

  it('does not read #42 out of a longer number', () => {
    // The failure this exists for: a body about #420 silencing the comment on
    // #42, or the URL of #420 doing it — the second is a prefix of the first as
    // plain text, so a substring check gets it wrong.
    expect(issueReply.mentionsIssue('Closes #420', 42, ISSUE.url)).toBe(false)
    expect(issueReply.mentionsIssue('Closes #142', 42, ISSUE.url)).toBe(false)
    expect(issueReply.mentionsIssue('See https://github.com/acme/app/issues/420', 42, ISSUE.url)).toBe(false)
  })

  it('says nothing about an empty description', () => {
    expect(issueReply.mentionsIssue('', 42, ISSUE.url)).toBe(false)
  })
})

describe('whether there is an issue to tell', () => {
  const on = { enabled: true }

  it('tells the issue a session was started from', () => {
    const decision = issueReply.issueToTell({ issueOf: ISSUE }, 'Round the tax', on)

    expect(decision.tell).toBe(true)
    expect(decision.tell && decision.number).toBe(42)
  })

  it('says nothing when the setting is off', () => {
    const decision = issueReply.issueToTell({ issueOf: ISSUE }, 'Round the tax', { enabled: false })

    expect(decision.tell).toBe(false)
    expect(!decision.tell && decision.reason).toBe('off')
    // The switch is checked before anything else, so the reason somebody reads is
    // the one they can act on rather than a technicality behind it.
    expect(!decision.tell && decision.because).toContain('Settings')
  })

  it('refuses a Notion ticket, and says it is Notion it is refusing', () => {
    const decision = issueReply.issueToTell(
      { ticketOf: { id: 'a'.repeat(32), url: 'https://notion.so/x', title: 'Totals' } },
      'Round the tax',
      on,
    )

    expect(!decision.tell && decision.reason).toBe('notion')
    expect(!decision.tell && decision.because).toContain('Notion')
  })

  it('says nothing for a session that came from neither', () => {
    const decision = issueReply.issueToTell({}, 'Round the tax', on)

    expect(!decision.tell && decision.reason).toBe('no_issue')
  })

  it('says nothing twice — one comment per session per issue', () => {
    const decision = issueReply.issueToTell(
      { issueOf: ISSUE, issueReply: { at: 1, issue: 42, url: COMMENT, prUrl: PR } },
      'Round the tax',
      on,
    )

    expect(!decision.tell && decision.reason).toBe('already')
    // The refusal points at what was said, so a second press is answerable
    // without going to look.
    expect(!decision.tell && decision.because).toContain(COMMENT)
  })

  it('says nothing when the pull request links the issue itself', () => {
    const decision = issueReply.issueToTell({ issueOf: ISSUE }, 'Round the tax\n\nCloses #42', on)

    expect(!decision.tell && decision.reason).toBe('linked')
  })

  it('reads the title as well as the body', () => {
    const decision = issueReply.issueToTell({ issueOf: ISSUE }, 'Fix #42 rounding\n\nNo description', on)

    expect(!decision.tell && decision.reason).toBe('linked')
  })
})

describe('posting it, once', () => {
  it('posts one comment on the issue and records what it said', async () => {
    const session = await record()
    const outcome = await issueReply.replyToIssue(session, { url: PR, title: 'Round the tax', body: '' })

    expect(outcome.posted).toBe(true)
    expect(outcome.posted && outcome.url).toBe(COMMENT)

    // One call, to the issue's own comments collection, with the body on stdin.
    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.command).toBe('gh')
    expect(spawned[0]!.args).toContain('repos/{owner}/{repo}/issues/42/comments')

    // Composed here, sent verbatim: the bytes on stdin are the bytes
    // `issueCommentBody` wrote, so nothing between the two can edit them.
    expect(JSON.parse(spawned[0]!.stdin).body).toBe(
      issueReply.issueCommentBody(PR, 'Rounded tax to whole cents in the invoice total'),
    )

    // On the record, or a second pull request from this session would say it all
    // again — which is the whole of what stops this happening twice.
    const stored = await sessions.findSession('sess-1')
    expect(stored?.issueReply?.issue).toBe(42)
    expect(stored?.issueReply?.url).toBe(COMMENT)
  })

  it('refuses the second time, having posted the first', async () => {
    const session = await record()
    await issueReply.replyToIssue(session, { url: PR, title: 'Round the tax', body: '' })

    // What the endpoint would hand a second pull request: the record as it now
    // stands, which is the thing carrying the refusal.
    const again = await sessions.findSession('sess-1')
    const outcome = await issueReply.replyToIssue(again!, {
      url: 'https://github.com/acme/app/pull/58',
      title: 'Round the tax again',
      body: '',
    })

    expect(outcome.posted).toBe(false)
    expect(!outcome.posted && outcome.reason).toBe('already')
    expect(spawned).toHaveLength(1)
  })

  it('makes no attempt at all for a Notion ticket', async () => {
    // The claim this file exists to prove. Not a refused write, not a failed
    // one — `gh` is never reached, so there is nothing to be wrong about.
    const session = await record({
      issueOf: undefined,
      ticketOf: { id: 'b'.repeat(32), url: 'https://notion.so/b', title: 'Totals are wrong' },
    })

    const outcome = await issueReply.replyToIssue(session, { url: PR, title: 'Round the tax', body: '' })

    expect(!outcome.posted && outcome.reason).toBe('notion')
    expect(spawned).toEqual([])
    expect((await sessions.findSession('sess-1'))?.issueReply).toBeUndefined()
  })

  it('makes no attempt at all while the setting is off', async () => {
    await preferences.savePreferences({ issueWriteback: false })
    const session = await record()

    const outcome = await issueReply.replyToIssue(session, { url: PR, title: 'Round the tax', body: '' })

    expect(!outcome.posted && outcome.reason).toBe('off')
    expect(spawned).toEqual([])
  })

  it('makes no attempt when the pull request already links the issue', async () => {
    const session = await record()

    const outcome = await issueReply.replyToIssue(session, {
      url: PR,
      title: 'Round the tax',
      body: 'Closes #42',
    })

    expect(!outcome.posted && outcome.reason).toBe('linked')
    expect(spawned).toEqual([])
  })

  it('reports a failed post rather than throwing, and records nothing', async () => {
    // The pull request is already open by the time this runs. Reporting the whole
    // thing as failed would send somebody to undo a pull request that is fine —
    // and recording the attempt would silence the only retry there is, which is
    // opening another one.
    reply.code = 1
    reply.stdout = ''
    reply.stderr = 'gh: HTTP 403: Resource not accessible by integration'

    const session = await record()
    const outcome = await issueReply.replyToIssue(session, { url: PR, title: 'Round the tax', body: '' })

    expect(!outcome.posted && outcome.reason).toBe('failed')
    expect(!outcome.posted && outcome.because).toContain('403')
    expect((await sessions.findSession('sess-1'))?.issueReply).toBeUndefined()
  })

  it('refuses when the workspace it would ask from is gone', async () => {
    const session = await record({ worktreePath: join(work, 'not-here'), repoDir: join(work, 'not-here') })

    const outcome = await issueReply.replyToIssue(session, { url: PR, title: 'Round the tax', body: '' })

    expect(!outcome.posted && outcome.reason).toBe('failed')
    expect(spawned).toEqual([])
  })
})
