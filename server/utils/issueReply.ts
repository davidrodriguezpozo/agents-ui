import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { patchSession, type Session } from './sessions'
import { readPreferences } from './preferences'

/**
 * One comment back on the issue, and nothing else.
 *
 * The band on Land turns an issue into a session, and until this existed that
 * was the end of the conversation: the work got done, a pull request got opened,
 * and the person who filed the issue found out because somebody told them in
 * Slack. An issue with a session on it looked exactly like an issue nobody had
 * read. So this is the reply — one comment, at one moment, saying what was done,
 * naming the pull request, and admitting nobody has reviewed it.
 *
 * It is the first thing in this app that writes to a tracker, so it is built to
 * the rule the Slack delivery already follows — **composed here, sent verbatim,
 * denied every other way of writing**:
 *
 *   - **No agent reaches this.** Not a run, not a tool, not an MCP server. It is
 *     `gh api` with a body this file wrote, called from the endpoint that opened
 *     the pull request. `digestSend` needs a run because Slack has no CLI; GitHub
 *     has one, and a run with one tool is still a run that can be talked into
 *     using it wrongly.
 *   - **One comment per session per issue.** `SessionIssueReply` is written on
 *     the session record and `issueToTell` refuses when it is there. A second
 *     pull request from the same session says nothing, and neither does a later
 *     push — nothing else in the app calls this.
 *   - **GitHub only.** A session started from a Notion ticket is refused before
 *     anything is attempted, and the refusal says why. Nothing is ever written to
 *     Notion, which is the promise `notionIntake.ts` and the Settings copy both
 *     make out loud.
 *   - **Off by default.** A wrong comment on somebody else's issue is the kind of
 *     mistake that gets a tool banned, so `issueWriteback` has to be turned on by
 *     hand. Off, `issueToTell` refuses first and reads nothing.
 *
 * The decision is a pure function on purpose: the pull request dialog says what
 * pressing the button will do by asking the same question the post asks, so a
 * preview built by different code cannot promise something different from what
 * happens. Same rule `reviewPost.ts` gives for a review's preview.
 */

/** What was said, and where, once. */
export interface SessionIssueReply {
  at: number
  /** The issue that was told. */
  issue: number
  /** The comment itself, so the record points at the words rather than implying them. */
  url: string
  /** The pull request it named. */
  prUrl: string
}

/**
 * Why nothing was said. Each of these is a specific way a comment would be
 * wrong rather than merely unnecessary — see `issueToTell` for the order.
 */
export type IssueReplySkip =
  /** The setting is off, which is the default. */
  | 'off'
  /** This session did not come from an issue. */
  | 'no_issue'
  /** It came from a Notion ticket, and nothing is ever written to Notion. */
  | 'notion'
  /** This session has already told this issue. */
  | 'already'
  /** The pull request names the issue itself, so GitHub has already said it. */
  | 'linked'

export type IssueToTell =
  | { tell: true; number: number; url: string }
  | { tell: false; reason: IssueReplySkip; because: string }

/** What the decision needs of a session, so a test can hand it four fields. */
export type ReplyingSession = Pick<Session, 'issueOf' | 'ticketOf' | 'issueReply'>

/** `.` and `/` in a URL are regex, and a URL is the thing being matched. */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether a pull request already points at the issue.
 *
 * The load-bearing half of "no comment when the pull request already links the
 * issue". A body saying `Closes #42` puts a cross-reference on the issue's own
 * timeline the moment it is opened, so a comment beside it is a second
 * notification saying the same thing — and the second one is the one that reads
 * as a bot talking to itself.
 *
 * Both spellings, because both are ordinary: `#42` and the issue's full URL. The
 * trailing digit is refused in both, so #42 is not found inside #420. A leading
 * word is not, because `owner/repo#42` is a link too.
 *
 * Deliberately blind to code fences, which GitHub is not. `#42` inside a fenced
 * block is not a link there and this counts it as one, so a pull request whose
 * description quotes a shell comment loses its issue comment. That is the error
 * worth making: the cost is a comment that was not posted, and the other way
 * round is a comment nobody wanted.
 */
export function mentionsIssue(text: string, number: number, issueUrl: string): boolean {
  if (!text) return false
  if (new RegExp(`#${number}(?![0-9])`).test(text)) return true
  return Boolean(issueUrl) && new RegExp(`${escaped(issueUrl)}(?![0-9])`).test(text)
}

/**
 * Which issue this pull request should tell, if any.
 *
 * Ordered so the answer is the most important true thing rather than the first
 * one found. The setting comes first because off means nothing is ever written,
 * whatever else is set — the same shape the notification master switch has. The
 * source comes next, so a Notion ticket is refused on being a Notion ticket
 * rather than on some later technicality, and the refusal is the one somebody
 * reads.
 */
export function issueToTell(
  session: ReplyingSession,
  prText: string,
  opts: { enabled: boolean },
): IssueToTell {
  if (!opts.enabled) {
    return {
      tell: false,
      reason: 'off',
      because: 'Commenting back on issues is off. Turn it on in Settings if you want it.',
    }
  }

  if (!session.issueOf) {
    // A ticket is named specifically. "This session did not come from an issue"
    // is true of it and tells nobody why a Notion row will never get a comment.
    if (session.ticketOf) {
      return {
        tell: false,
        reason: 'notion',
        because: 'This session came from a Notion ticket. Nothing is ever written back to Notion — '
          + 'write-back is GitHub only.',
      }
    }

    return {
      tell: false,
      reason: 'no_issue',
      because: 'This session was not started from an issue, so there is nobody to tell.',
    }
  }

  if (session.issueReply) {
    return {
      tell: false,
      reason: 'already',
      because: `#${session.issueReply.issue} was already told — ${session.issueReply.url}. `
        + 'One comment per session is the whole of it.',
    }
  }

  const { number, url } = session.issueOf

  if (mentionsIssue(prText, number, url)) {
    return {
      tell: false,
      reason: 'linked',
      because: `The pull request names #${number} itself, so GitHub has already put it on the issue. `
        + 'A comment would say the same thing twice.',
    }
  }

  return { tell: true, number, url }
}

/**
 * The comment, in full.
 *
 * Three things, in the order somebody skim-reading a notification needs them:
 * that there is a pull request and where, what it did, and that no person has
 * looked at it. The last line is not a disclaimer — it is the difference between
 * a reader treating this as work that is finished and one treating it as work
 * that is proposed.
 *
 * The sentence comes from `sessionSummary.ts`, which is a preference and can be
 * off. When it is there is no sentence to write and the comment goes out without
 * one: the pull request has a title, and a comment saying "no summary is
 * available" is worse than a comment that does not mention summaries.
 */
export function issueCommentBody(prUrl: string, summary?: string): string {
  const number = /\/pull\/(\d+)/.exec(prUrl)?.[1]
  const named = number ? `#${number} — ${prUrl}` : prUrl
  const said = summary?.trim()

  return [
    `A pull request for this is open: ${named}`,
    ...(said ? [said] : []),
    'It was written by an agent in a Claude Code session started from this issue. '
      + 'No person has reviewed it yet.',
  ].join('\n\n')
}

/**
 * `gh api` with the comment on stdin.
 *
 * On stdin rather than in an argument for the reason `reviewPost.ts` gives about
 * a review body: the text carries newlines and whatever the summary model wrote
 * about a shell command, and argv is the wrong place for both. `{owner}/{repo}`
 * is left to `gh` to fill from the directory's remote, which is the same
 * repository the issue was read from.
 */
async function postComment(cwd: string, number: number, body: string): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn('gh', [
      'api', `repos/{owner}/{repo}/issues/${number}/comments`,
      '--method', 'POST',
      '--input', '-',
    ], { cwd })

    let out = ''
    let err = ''

    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(err.trim() || `gh exited ${code}`))
    })

    child.stdin.end(JSON.stringify({ body }))
  })

  const parsed = JSON.parse(raw || '{}') as { html_url?: string }
  return parsed.html_url ?? ''
}

export type IssueReplyOutcome =
  | { posted: true; issue: number; url: string }
  | { posted: false; reason: IssueReplySkip | 'failed'; because: string }

/**
 * Tell the issue, once, that this session opened a pull request.
 *
 * Called from the endpoint that opens one and from nowhere else, which is what
 * "the session's first pull request, once" means in code: there is no tick, no
 * watcher and no tool that can reach this, so a later push cannot trigger it.
 *
 * Never throws. The pull request is already open by the time this runs, and a
 * caller told the whole thing failed because a comment did would send somebody
 * to undo a pull request that is fine. A failure comes back as a value and is
 * reported beside the pull request's URL.
 *
 * A failed post is deliberately *not* recorded. `issueReply` means "this issue
 * has been told", and writing it on a failure would silence the retry somebody
 * gets by opening the request again — which is the only retry there is.
 */
export async function replyToIssue(
  session: Session,
  pr: { url: string; title?: string; body?: string },
): Promise<IssueReplyOutcome> {
  const prefs = await readPreferences()
  const decision = issueToTell(session, `${pr.title ?? ''}\n${pr.body ?? ''}`, {
    enabled: prefs.issueWriteback,
  })

  if (!decision.tell) return { posted: false, reason: decision.reason, because: decision.because }

  // The worktree, which is where `gh` was read from; the repository when the
  // worktree has been removed and the record kept. Both resolve to the same
  // remote, and neither existing is a comment that cannot be posted at all.
  const cwd = existsSync(session.worktreePath)
    ? session.worktreePath
    : existsSync(session.repoDir) ? session.repoDir : null

  if (!cwd) {
    return {
      posted: false,
      reason: 'failed',
      because: `#${decision.number} was not told: this session's workspace is no longer on disk, `
        + 'so there is nowhere to ask GitHub from.',
    }
  }

  let url: string
  try {
    url = await postComment(cwd, decision.number, issueCommentBody(pr.url, session.summary?.text))
  } catch (e: any) {
    return {
      posted: false,
      reason: 'failed',
      because: `#${decision.number} could not be commented on: ${e?.message ?? e}`,
    }
  }

  const reply: SessionIssueReply = {
    at: Date.now(),
    issue: decision.number,
    url,
    prUrl: pr.url,
  }

  try {
    await patchSession(session.id, { issueReply: reply })
  } catch (e: any) {
    // The comment is on the issue. Losing the record means a second pull request
    // from this session would comment again, which is worth a line in the log
    // and is not worth reporting the posted comment as a failure.
    console.log(`[issue-reply] posted on #${reply.issue} but could not record it: ${e?.message ?? e}`)
  }

  return { posted: true, issue: reply.issue, url }
}
