import { findSession } from '../../../../utils/sessions'
import { composeDraft, findDraft, latestReport, saveDraft } from '../../../../utils/reviewDraft'
import { parseReviewReport } from '../../../../utils/reviewReport'
import { buildReview } from '../../../../utils/reviewPost'

/**
 * The review this session composed, ready to be read and edited.
 *
 * Composed on demand rather than after the turn, and the reason is that it costs
 * nothing: this is a parser over text the run already produced, not a model. So
 * there is no saving in doing it eagerly, and doing it lazily means a session
 * whose review was never opened never pays for one.
 *
 * A draft that exists is returned as it stands — it may hold edits, and
 * recomposing over those on every page load would be the one behaviour that
 * makes the pane untrustworthy. Recomposing is `compose.post.ts`, on purpose.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  if (!session.reviewOf) {
    return { reviewable: false as const, reason: 'This session is not reading a pull request.' }
  }

  const existing = await findDraft(id)
  if (existing) {
    return { reviewable: true as const, draft: existing, preview: buildReview(existing) }
  }

  const report = await latestReport(session)
  if (!report) {
    return {
      reviewable: true as const,
      draft: null,
      reason:
        'Nothing this session said reads as a review report yet. When the review finishes, its findings '
        + 'will show up here.',
    }
  }

  const parsed = parseReviewReport(report.text)!
  const draft = await saveDraft(await composeDraft({ session, report: parsed, runId: report.runId }))

  return { reviewable: true as const, draft, preview: buildReview(draft) }
})
