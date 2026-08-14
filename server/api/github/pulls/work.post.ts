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

  const session = await startSessionFromRef({
    repoDir,
    ref: String(pull.number),
    agentSlug: body.agentSlug,
    title: `#${pull.number} ${pull.title}`,
  })

  // The opening turn is your own command for this action when you have set one,
  // and the built-in prompt otherwise. Read here rather than passed in so the
  // page cannot send a stale template, and so a command edited between loading
  // the page and pressing the button is the one that runs.
  const { pullActions } = await readPreferences()

  // The workspace exists and is recorded by this point, so a turn that will not
  // start is still a session you have. Reported rather than rolled back.
  try {
    return { ...session, intent, runId: await startTurn(session, turnForIntent(pull, intent, pullActions)) }
  } catch (e: any) {
    return {
      ...session,
      intent,
      startError: e?.data?.message ?? e?.message ?? 'The session was created but could not start working.',
    }
  }
})
