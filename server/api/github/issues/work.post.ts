import { getProjectDir } from '../../../utils/scope'
import { startSession } from '../../../utils/startSession'
import { startTurn, isTurnRunning } from '../../../utils/sessionTurn'
import { checkBudget } from '../../../utils/budget'
import { findSession, readSessions, type Session } from '../../../utils/sessions'
import { findTicket, notionIntakeStore } from '../../../utils/notionIntake'
import { resolveRef } from '../../../utils/worktrees'
import {
  issueBranchName, issuePrompt, parseIssueKey, readIssueDetail, sanitiseIssueIntent,
  sessionOnIssue, sessionOnTicket, ticketBranchName, ticketDetail,
  type IssueDetail,
} from '../../../utils/issues'

/**
 * Turn a row on the band into a session that is already working on it.
 *
 * The other end of `pulls/work.post.ts`, and the point of the band rather than a
 * decoration on it. A pull request row gets you into work that exists; this gets
 * you into work that does not, which is where most of a piece of work is actually
 * lost — reading the ticket, cutting a branch, and typing the ask out again in
 * your own words for something that could have read it itself.
 *
 * **Two sources, one press.** A GitHub issue is re-read here rather than taken
 * from the request body, exactly as the pull request path re-reads GitHub: the
 * drawn row carries no body at all and is however many seconds old, and an issue
 * edited or answered since produces a session working from an ask nobody is
 * making. A Notion ticket cannot be re-read that cheaply — it is a model run, not
 * a `gh` call — so it comes out of the store the last refresh filled, and the
 * prompt says when that was. See `notionIntake.ts` for why that trade is the
 * right way round.
 *
 * Everything after the two readings is shared, because it has to be the same:
 * one budget check, one session, one `issuePrompt`.
 *
 * Pressing the same row twice does not make two workspaces. A session already on
 * this issue or ticket takes the instruction instead, which is the same answer the
 * band's **Has a session already** badge gives.
 *
 * **Nothing is written to either tracker.** No comment, no label, no assignment,
 * no property moved, and nothing is ever closed. See `issuePrompt`, which says so
 * to the session too.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    key?: string
    number?: number
    intent?: string
    agentSlug?: string
  }>(event)

  const repoDir = getProjectDir(event)

  if (!repoDir) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_project', message: 'Pick a project folder first.' },
    })
  }

  // `key` is what the band's rows carry — `github:42`, `notion:<page id>` — and
  // it is the only thing that can name a row now the band has two sources. A bare
  // `number` is still accepted because that is what this route took when GitHub
  // was the only one, and a page open across the change should not break.
  const target = parseIssueKey(body?.key)
    ?? (typeof body?.number === 'number' ? { source: 'github' as const, number: body.number } : null)

  if (!target) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_target', message: 'Which issue or ticket?' },
    })
  }

  const intent = sanitiseIssueIntent(body.intent)
  const all = await readSessions().catch(() => [] as Session[])

  /**
   * What the two sources have in common by the time the work starts: the text to
   * quote, the session that already has it, and how to cut one if there is not.
   */
  const prepared = target.source === 'notion'
    ? await prepareTicket(target.ticketId, all)
    : await prepareIssue(repoDir, target.number, all)

  // Checked before the worktree is cut, for the reason `sessions/index.post`
  // gives: a session that cannot spend anything is an empty workspace you then
  // have to clean up to be told the same thing.
  const budget = await checkBudget()
  if (!budget.allowed) {
    throw createError({ statusCode: 429, data: { error: 'over_budget', message: budget.reason! } })
  }

  const { session, how } = prepared.existing
    ? { session: await continueOn(prepared.existing.id), how: 'continued' as const }
    : { session: await prepared.cut(repoDir, body.agentSlug), how: 'created' as const }

  const prompt = issuePrompt(prepared.detail, intent, { branch: session.branch })

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

/** The text to quote, who already has it, and how to cut a workspace for it. */
interface Prepared {
  detail: IssueDetail
  existing: { id: string; title: string } | null
  cut: (repoDir: string, agentSlug?: string) => Promise<Session>
}

/** A GitHub issue, read again at the moment of the press. */
async function prepareIssue(repoDir: string, number: number, all: Session[]): Promise<Prepared> {
  const reading = await readIssueDetail(repoDir, number)
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

  return {
    detail: issue,
    // This repository's sessions only. #42 exists in every project on the
    // machine, and matching across them would hand the work to somebody else's.
    existing: sessionOnIssue(number, all.filter(s => s.repoDir === repoDir)),
    cut: (dir, agentSlug) => cutForIssue(dir, issue, agentSlug),
  }
}

/**
 * A Notion ticket, as the last refresh read it.
 *
 * Missing is a real case rather than an error to swallow: the band is drawn from
 * the store, and a refresh between the draw and the press can drop a ticket whose
 * status somebody has moved on. Refused with the reason, because starting work on
 * a ticket the team has taken out of the queue is the one thing this must not do
 * quietly.
 */
async function prepareTicket(ticketId: string, all: Session[]): Promise<Prepared> {
  const state = await notionIntakeStore.read()
  const ticket = findTicket(state, ticketId)

  if (!ticket) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'ticket_gone',
        message: 'That ticket is not in the last reading from Notion — its status has probably moved. '
          + 'Read Notion again from the band and see whether it is still there.',
      },
    })
  }

  return {
    detail: ticketDetail(ticket, state.checkedAt ?? 0),
    // Every project's sessions — see `sessionOnTicket` for why a page id does not
    // need the restriction an issue number does.
    existing: sessionOnTicket(ticket.id, all),
    cut: (dir, agentSlug) => cutForTicket(dir, ticket, agentSlug),
  }
}

/**
 * The session that already has this work, if it will take an instruction.
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
      data: { error: 'no_session', message: 'The session on this is no longer on record. Refresh and try again.' },
    })
  }

  if (session.status === 'running' || await isTurnRunning(session)) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'session_running',
        sessionId: session.id,
        message: `A session on this is working right now — "${session.title}". `
          + 'Open it and say what you need there, rather than starting a second one on the same work.',
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
async function cutForIssue(
  repoDir: string,
  issue: { number: number | null; title: string; url: string },
  agentSlug?: string,
): Promise<Session> {
  const preferred = issueBranchName(issue.number!, issue.title)
  const taken = Boolean(await resolveRef(repoDir, `refs/heads/${preferred}`))

  return startSession({
    repoDir,
    title: `#${issue.number} ${issue.title}`,
    branch: taken ? undefined : preferred,
    agentSlug,
    issueOf: { number: issue.number!, url: issue.url, title: issue.title },
  })
}

/**
 * The same, for a ticket. The title carries no number, so the session is named
 * after the ticket and the branch after its slug — see `ticketBranchName`.
 */
async function cutForTicket(
  repoDir: string,
  ticket: { id: string; title: string; url: string },
  agentSlug?: string,
): Promise<Session> {
  const preferred = ticketBranchName(ticket)
  const taken = Boolean(await resolveRef(repoDir, `refs/heads/${preferred}`))

  return startSession({
    repoDir,
    title: ticket.title,
    branch: taken ? undefined : preferred,
    agentSlug,
    ticketOf: { id: ticket.id, url: ticket.url, title: ticket.title },
  })
}
