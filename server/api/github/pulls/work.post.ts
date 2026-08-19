import { getProjectDir } from '../../../utils/scope'
import { startSessionFromRef } from '../../../utils/sessionFromRef'
import { startTurn } from '../../../utils/sessionTurn'
import { checkBudget } from '../../../utils/budget'
import { intentFor, readPulls, turnForIntent, type WorkIntent } from '../../../utils/reviews'
import { readPreferences } from '../../../utils/preferences'

/**
 * Turn a pull request into a session that is already working on it.
 *
 * The point of the reviews page, rather than a decoration on it. A list of pull
 * requests you can only click through to GitHub is a worse GitHub; what makes
 * this worth having is that the row is one press away from a workspace with the
 * branch checked out and a turn in flight that knows why it is there.
 *
 * Pressing the same row again does not fail and does not duplicate anything. A
 * review is a detached checkout of the head commit, so any number of them can
 * coexist; the three intents that change the branch land in the workspace that
 * already has it, which `startSessionFromRef` reports back as `how`.
 *
 * The pull request is re-read here rather than taken from the request body. The
 * page's copy is however many seconds old, and every prompt this builds names
 * specific facts — which checks failed, which commit they failed on. Sending an
 * agent off to fix a check that went green two minutes ago is a wasted run and
 * a confusing transcript.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ number?: number; intent?: WorkIntent; agentSlug?: string }>(event)
  const repoDir = getProjectDir(event)

  if (!repoDir) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_project', message: 'Pick a project folder first.' },
    })
  }

  if (typeof body?.number !== 'number') {
    throw createError({ statusCode: 400, data: { error: 'no_number', message: 'Which pull request?' } })
  }

  const reading = await readPulls(repoDir)
  if (!reading.ok) {
    throw createError({ statusCode: 502, data: { error: 'github_unavailable', message: reading.reason } })
  }

  const pull = [...reading.reviewing, ...reading.mine].find(p => p.number === body.number)
  if (!pull) {
    throw createError({
      statusCode: 404,
      data: {
        error: 'not_listed',
        message: `#${body.number} is no longer in either list — it may have been merged, closed, or reviewed since this page loaded.`,
      },
    })
  }

  // The row's own suggestion is the default; an explicit intent still wins, so
  // "review it" stays available on a pull request whose badge says something
  // else. Refused rather than guessed when neither yields one: a session with
  // no prompt is a workspace nobody asked for.
  const intent = body.intent ?? intentFor(pull)
  if (!intent) {
    throw createError({
      statusCode: 400,
      data: { error: 'nothing_to_do', message: `There is nothing waiting on you in #${pull.number}.` },
    })
  }

  // Checked before the worktree is cut, for the reason `sessions/index.post`
  // gives: a session that cannot spend anything is an empty workspace you then
  // have to clean up to be told the same thing.
  const budget = await checkBudget()
  if (!budget.allowed) {
    throw createError({ statusCode: 429, data: { error: 'over_budget', message: budget.reason! } })
  }

  // A review reads; the other three change the branch. That difference decides
  // whether this workspace holds the branch or just the commit, and holding it
  // for a review was what made reviewing the same pull request twice — or
  // reviewing one while a session fixes it — fail with git's "already checked
  // out" and nothing to do about it.
  const { session, how, note } = await startSessionFromRef({
    repoDir,
    ref: String(pull.number),
    agentSlug: body.agentSlug,
    title: `#${pull.number} ${pull.title}`,
    detach: intent === 'review',
  })

  // The opening turn is your own command for this action when you have set one,
  // and the built-in prompt otherwise. Read here rather than passed in so the
  // page cannot send a stale template, and so a command edited between loading
  // the page and pressing the button is the one that runs.
  const { pullActions } = await readPreferences()

  // The workspace exists and is recorded by this point, so a turn that will not
  // start is still a session you have. Reported rather than rolled back.
  // The commit that is actually in the workspace, which is the one the review
  // prompt should name. The fetch happens after the list was read, so a push in
  // between makes GitHub's answer a commit older than what got checked out.
  const reviewing = session.detached && session.baseSha ? { ...pull, headSha: session.baseSha } : pull

  try {
    return { ...session, intent, how, note, runId: await startTurn(session, turnForIntent(reviewing, intent, pullActions)) }
  } catch (e: any) {
    return {
      ...session,
      intent,
      how,
      note,
      startError: e?.data?.message ?? e?.message ?? 'The session was created but could not start working.',
    }
  }
})
