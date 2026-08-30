import { getProjectDir } from '../../../utils/scope'
import { startSessionFromRef } from '../../../utils/sessionFromRef'
import { startTurn } from '../../../utils/sessionTurn'
import { checkBudget } from '../../../utils/budget'
import { readPulls, turnForIntent } from '../../../utils/reviews'
import { readPreferences } from '../../../utils/preferences'
import { asProviderId } from '../../../utils/providers'
import { providerForProject } from '../../../utils/projectProvider'
import type { Session } from '../../../utils/sessions'
import { MAX_AT_ONCE } from '../../sessions/batch.post'

/**
 * Review every pull request waiting on you, with one press.
 *
 * Twenty-six of the sessions on this machine are reviews of somebody else's
 * branch, and every one of them was started the same way: read the row, press,
 * wait for a worktree, go back, do it again. Every part of doing that N times
 * already existed — `pulls/work` does exactly one of them, `sessions/batch`
 * already knows how to do many of anything — and nothing composed them. This is
 * that composition and nothing else.
 *
 * Three things it takes from the two endpoints it stands on:
 *
 *   - **The cap is `sessions/batch`'s**, not a second one. Refused rather than
 *     truncated, for the reason that file gives: quietly doing some of what was
 *     asked is worse than doing none of it.
 *   - **One budget check for the press.** Five sessions started and the sixth
 *     refused for spend is the worst of both — you pay for five workspaces and
 *     still have to go and finish the job by hand.
 *   - **A partial result rather than an exception.** One pull request that will
 *     not check out must not cost the other four, so it comes back in `failed`
 *     with its number and the reason, exactly as a bad prompt does in a batch.
 *
 * What it does *not* do is send anything. `turnForIntent` produces the same
 * review turn a single press produces, and that prompt's most important line is
 * that nothing is posted to GitHub. Starting N reviews is a saving of clicks;
 * finishing one is still a person reading it.
 */

export interface ReviewAllResult {
  started: (Session & { runId?: string; startError?: string })[]
  /**
   * Never made it as far as a workspace, and why.
   *
   * The pull request's number rather than `sessions/batch`'s `prompt`, for the
   * reason `sessions/race` names the agent: the shape is the same, and the
   * thing that identifies a failed item is whatever the caller asked for.
   */
  failed: { number: number; reason: string }[]
}

export default defineEventHandler(async (event): Promise<ReviewAllResult> => {
  const body = await readBody<{
    numbers?: number[]
    agentSlug?: string
    /** Which agent runs the turns. Omitted falls back to the repository's default. */
    provider?: string
  }>(event)
  const repoDir = getProjectDir(event)

  if (!repoDir) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_project', message: 'Pick a project folder first.' },
    })
  }

  // Deduplicated because the same pull request twice is one review, and the
  // second workspace would be an identical detached checkout nobody asked for.
  const numbers = [...new Set(
    (Array.isArray(body?.numbers) ? body.numbers : [])
      .filter(n => typeof n === 'number' && Number.isInteger(n) && n > 0),
  )]

  if (!numbers.length) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_numbers', message: 'Which pull requests? Send the numbers to review.' },
    })
  }

  if (numbers.length > MAX_AT_ONCE) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'too_many',
        message: `That is ${numbers.length} reviews, and ${MAX_AT_ONCE} is the most at once. `
          + 'Each one is a full checkout of the repository.',
      },
    })
  }

  // Once, for the whole press, and before anything is cut. A refusal here has
  // started nothing and there is nothing to clean up — which is the only
  // version of being told you are over budget that is worth having.
  const budget = await checkBudget()
  if (!budget.allowed) {
    throw createError({ statusCode: 429, data: { error: 'over_budget', message: budget.reason! } })
  }

  // Re-read rather than taken from the request, for the reason `work.post`
  // gives: the review prompt names the commit and the file count, and the
  // page's copy is however many seconds old.
  const reading = await readPulls(repoDir)
  if (!reading.ok) {
    throw createError({ statusCode: 502, data: { error: 'github_unavailable', message: reading.reason } })
  }

  const listed = [...reading.reviewing, ...reading.mine]

  /*
   * Both resolved once, before the loop, for the reason `sessions/batch` gives:
   * several sessions started together are one decision, and neither file can
   * change in between.
   */
  const provider = asProviderId(body?.provider) ?? await providerForProject(repoDir)
  const { pullActions } = await readPreferences()

  const started: ReviewAllResult['started'] = []
  const failed: ReviewAllResult['failed'] = []

  // Deliberately sequential, again from `sessions/batch`: every one of these
  // runs `git worktree add` against the same repository, and concurrent ones
  // contend on the index lock in ways that read like nothing in particular. The
  // turns are detached, so each review is already working while the next
  // worktree is still being cut.
  for (const number of numbers) {
    const pull = listed.find(p => p.number === number)

    if (!pull) {
      failed.push({
        number,
        reason: `#${number} is no longer in either list — it may have been merged, closed, or reviewed since this page loaded.`,
      })
      continue
    }

    try {
      // `detach` is what makes this safe to do N times: a review reads, so the
      // workspace holds the commit rather than the branch, and no two of these
      // — nor a session fixing one of the same branches — collide over a ref.
      const { session } = await startSessionFromRef({
        repoDir,
        ref: String(pull.number),
        agentSlug: body?.agentSlug,
        title: `#${pull.number} ${pull.title}`,
        detach: true,
        provider,
      })

      // The commit that actually landed in the workspace, which is the one the
      // prompt should name. GitHub's answer and the checkout can differ by a
      // push that happened in between.
      const reviewing = session.detached && session.baseSha ? { ...pull, headSha: session.baseSha } : pull

      try {
        started.push({ ...session, runId: await startTurn(session, turnForIntent(reviewing, 'review', pullActions)) })
      } catch (e: any) {
        // The workspace exists and is recorded, so this is a session you have.
        // Reported rather than rolled back.
        started.push({
          ...session,
          startError: e?.data?.message ?? e?.message ?? 'The session was created but could not start working.',
        })
      }
    } catch (e: any) {
      failed.push({ number, reason: e?.data?.message ?? e?.message ?? 'Could not start a review.' })
    }
  }

  return { started, failed }
})
