import { acceptProposal, rejectLesson, type Proposal } from '../../utils/lessonProposals'

/**
 * Accept a proposal, or decline a lesson.
 *
 * Accepting takes the whole proposal back rather than a key, and that is
 * deliberate: what gets written is the line that was *shown*. Re-deriving it
 * here would mean a second model call, and a second model call means the diff
 * somebody read is not necessarily the line that lands.
 *
 * There is no third caller. Nothing schedules this, no setting enables it, and
 * the only path into `acceptProposal` is a person pressing accept.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ accept?: Proposal; reject?: string }>(event)
    .catch(() => ({} as { accept?: Proposal; reject?: string }))

  if (body?.reject) {
    return { rejected: await rejectLesson(body.reject) }
  }

  if (!body?.accept?.key || !body.accept.line || !body.accept.path) {
    throw createError({
      statusCode: 400,
      data: { error: 'nothing_to_accept', message: 'Accepting needs the proposal that was shown.' },
    })
  }

  const result = await acceptProposal(body.accept)
  if (!result.ok) throw createError({ statusCode: 400, data: { error: 'write_failed', message: result.message } })

  return result
})
