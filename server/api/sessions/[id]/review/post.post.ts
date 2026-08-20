import { findSession } from '../../../../utils/sessions'
import { findDraft, saveDraft } from '../../../../utils/reviewDraft'
import { guard, postReview } from '../../../../utils/reviewPost'

/**
 * Send the review.
 *
 * The only route in this app that writes to somebody else's pull request. It
 * takes no content: everything posted comes from the stored draft, which is
 * what a person read and edited. A body full of comments would make this
 * endpoint a way to post arbitrary text under your name — reachable by any page
 * that can reach the app — which is exactly the door the reviewing agent is
 * kept away from.
 *
 * The repository is the session's own, because that is where `gh` resolves the
 * remote from, and it is the repository the pull request is in by construction.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const draft = await findDraft(id)
  if (!draft) {
    throw createError({
      statusCode: 404,
      data: { error: 'no_draft', message: 'There is no composed review for this session.' },
    })
  }

  const allowed = await guard(draft, session.repoDir)
  if (!allowed.ok) {
    throw createError({ statusCode: 409, data: { error: allowed.error, message: allowed.message } })
  }

  let posted
  try {
    posted = await postReview(draft, session.repoDir)
  } catch (e: any) {
    throw createError({
      statusCode: 502,
      data: {
        error: 'post_failed',
        message:
          `GitHub refused the review: ${e?.message ?? e}. Nothing was posted — `
          + 'a review is sent whole, so there are no half-arrived comments to clean up.',
      },
    })
  }

  // Recorded after the fact and never before it. A draft marked sent by a call
  // that then failed would leave the review unpostable and looking posted,
  // which is the worse of the two ways to get this wrong.
  await saveDraft({
    ...draft,
    posted: { at: Date.now(), url: posted.url, event: posted.event, comments: posted.comments },
  })

  return posted
})
