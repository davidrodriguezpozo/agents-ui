import { findSession } from '../../../../utils/sessions'
import { composeDraft, findDraft, latestReport, saveDraft } from '../../../../utils/reviewDraft'
import { parseReviewReport } from '../../../../utils/reviewReport'
import { buildReview } from '../../../../utils/reviewPost'

/**
 * Read the session's newest report again and rebuild the draft from it.
 *
 * Wanted after a follow-up turn — you asked the reviewer about the migration and
 * it found two more things. Edits are carried across by `composeDraft`; a body
 * somebody rewrote survives, which is what makes pressing this safe.
 *
 * A session whose newest turn produced no report leaves the existing draft
 * alone and says so, rather than replacing a review with nothing. Answering
 * "yes, that is a fair point" is a perfectly ordinary turn for a review session
 * to take, and it should not cost you the review.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  if (!session.reviewOf) {
    throw createError({
      statusCode: 400,
      data: { error: 'not_a_review', message: 'This session is not reading a pull request.' },
    })
  }

  const previous = await findDraft(id)

  if (previous?.posted) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'already_posted',
        message: `The review for #${previous.pr} has already been sent — ${previous.posted.url}.`,
      },
    })
  }

  const report = await latestReport(session)
  if (!report) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'no_report',
        message: previous
          ? 'This session has not said anything that reads as a review report since, so the draft is unchanged.'
          : 'Nothing this session said reads as a review report.',
      },
    })
  }

  const parsed = parseReviewReport(report.text)!
  const draft = await saveDraft(
    await composeDraft({ session, report: parsed, runId: report.runId, previous }),
  )

  return { draft, preview: buildReview(draft) }
})
