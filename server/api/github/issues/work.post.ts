import { getProjectDir } from '../../../utils/scope'
import { startSession } from '../../../utils/startSession'
import { startTurn, isTurnRunning } from '../../../utils/sessionTurn'
import { checkBudget } from '../../../utils/budget'
import { findSession, readSessions, type Session } from '../../../utils/sessions'
import { resolveRef } from '../../../utils/worktrees'
import {
  issueBranchName, issuePrompt, readIssueDetail, sanitiseIssueIntent, sessionOnIssue,
} from '../../../utils/issues'

/**
 * Turn an issue into a session that is already working on it.
 *
 * The other end of `pulls/work.post.ts`, and the point of the issue band rather
 * than a decoration on it. A pull request row gets you into work that exists;
 * this gets you into work that does not, which is where most of a piece of work
 * is actually lost — reading the ticket, cutting a branch, and typing the ask
 * out again in your own words for something that could have read it itself.
 *
 * The issue is re-read here rather than taken from the request body, exactly as
 * the pull request path re-reads GitHub. The drawn row carries no body at all —
 * the band deliberately does not fetch thirty of them — and the body is most of
 * what the prompt is. It is also however many seconds old: an issue edited or
 * answered since produces a session working from an ask nobody is making.
 *
 * Pressing the same row twice does not make two workspaces. A session already on
 * this issue takes the instruction instead, which is the same answer the band's
 * **Has a session already** badge gives.
 *
 * **Nothing is written to GitHub.** No comment, no label, no assignment, and the
 * issue is never closed. See `issuePrompt`, which says so to the session too.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ number?: number; intent?: string; agentSlug?: string }>(event)
  const repoDir = getProjectDir(event)

  if (!repoDir) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_project', message: 'Pick a project folder first.' },
    })
  }

  if (typeof body?.number !== 'number') {
    throw createError({ statusCode: 400, data: { error: 'no_number', message: 'Which issue?' } })
  }

  const intent = sanitiseIssueIntent(body.intent)

  const reading = await readIssueDetail(repoDir, body.number)
  if (!reading.ok || !reading.issue) {
    throw createError({ statusCode: 502, data: { error: 'github_unavailable', message: reading.reason } })
  }

  const issue = reading.issue

  // Closed between the band being drawn and the press. Refused rather than
  // worked on: the answer to a closed issue is to read why it was closed, and
  // starting a session on one is a workspace you then have to clean up.
  if (issue.state === 'CLOSED') {
    throw createError({
      statusCode: 409,
      data: {
        error: 'issue_closed',
        message: `#${issue.number} has been closed since this page was drawn. Read it on GitHub before starting anything.`,
      },
    })
  }

  // Checked before the worktree is cut, for the reason `sessions/index.post`
  // gives: a session that cannot spend anything is an empty workspace you then
  // have to clean up to be told the same thing.
  const budget = await checkBudget()
  if (!budget.allowed) {
    throw createError({ statusCode: 429, data: { error: 'over_budget', message: budget.reason! } })
  }

  const all = await readSessions().catch(() => [] as Session[])
  const existing = sessionOnIssue(issue.number, all.filter(s => s.repoDir === repoDir))

  const { session, how } = existing
    ? { session: await continueOn(existing.id), how: 'continued' as const }
    : { session: await cutOne(repoDir, issue, body.agentSlug), how: 'created' as const }

  const prompt = issuePrompt(issue, intent, { branch: session.branch })

  // The workspace exists and is recorded by this point, so a turn that will not
  // start is still a session you have. Reported rather than rolled back.
  try {
    return { ...session, intent, how, runId: await startTurn(session, prompt) }
  } catch (e: any) {
    return {
      ...session,
      intent,
      how,
      startError: e?.data?.message ?? e?.message ?? 'The session was created but could not start working.',
    }
  }
})

/**
 * The session that already has this issue, if it will take an instruction.
 *
 * A session mid-turn will not: two agents in one worktree is the exact problem
 * sessions exist to prevent, and `startTurn` would refuse anyway. The refusal
 * names the session, which the page reads as "go and look at it" rather than as
 * an error — the same shape `startSessionFromRef` uses for a held branch.
 */
async function continueOn(id: string): Promise<Session> {
  const session = await findSession(id)
  if (!session) {
    throw createError({
      statusCode: 404,
      data: { error: 'no_session', message: 'The session on this issue is no longer on record. Refresh and try again.' },
    })
  }

  if (session.status === 'running' || await isTurnRunning(session)) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'session_running',
        sessionId: session.id,
        message: `A session on this issue is working right now — "${session.title}". `
          + 'Open it and say what you need there, rather than starting a second one on the same issue.',
      },
    })
  }

  return session
}

/**
 * A branch and a workspace for an issue nobody has started.
 *
 * The branch is named from the number and the slug, which is what people
 * already call the work. It can collide — with a branch from a session that has
 * since been closed, or one somebody cut by hand — and the fallback is the
 * ordinary session naming, which is the same slug with the session id after it.
 * Falling back rather than refusing: a name being taken is not a reason to
 * refuse to start work, and git would fail with a sentence about refs.
 */
async function cutOne(
  repoDir: string,
  issue: { number: number; title: string; url: string },
  agentSlug?: string,
): Promise<Session> {
  const preferred = issueBranchName(issue.number, issue.title)
  const taken = Boolean(await resolveRef(repoDir, `refs/heads/${preferred}`))

  return startSession({
    repoDir,
    title: `#${issue.number} ${issue.title}`,
    branch: taken ? undefined : preferred,
    agentSlug,
    issueOf: { number: issue.number, url: issue.url, title: issue.title },
  })
}
