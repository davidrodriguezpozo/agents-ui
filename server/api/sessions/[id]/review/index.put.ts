import { findSession } from '../../../../utils/sessions'
import { findDraft, saveDraft, type ReviewDraft } from '../../../../utils/reviewDraft'
import { buildReview } from '../../../../utils/reviewPost'

/**
 * Your edits to the draft.
 *
 * Only the fields a person can actually change are read from the body, and the
 * anchors are not among them. An anchor is a fact about the diff, computed here;
 * accepting one from the client would let a stale page — or a mistake — post a
 * comment onto a line nobody checked was in the diff.
 *
 * `edited` is set from the comparison rather than sent, so a recompose knows to
 * leave a rewritten body alone without trusting the page to have said so.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const existing = await findDraft(id)
  if (!existing) {
    throw createError({
      statusCode: 404,
      data: { error: 'no_draft', message: 'There is no composed review for this session yet.' },
    })
  }

  if (existing.posted) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'already_posted',
        message: `This review was already sent — ${existing.posted.url}. Editing it here would change nothing.`,
      },
    })
  }

  const body = await readBody<{
    event?: ReviewDraft['event']
    summary?: string
    includeContext?: boolean
    findings?: { id: string; body?: string; include?: boolean; useSuggestion?: boolean }[]
  }>(event)

  const next: ReviewDraft = {
    ...existing,
    event: body?.event ?? existing.event,
    summary: body?.summary ?? existing.summary,
    summaryEdited:
      body?.summary !== undefined && body.summary !== existing.summary ? true : existing.summaryEdited,
    includeContext: body?.includeContext ?? existing.includeContext,
    findings: existing.findings.map((finding) => {
      const patch = body?.findings?.find(f => f.id === finding.id)
      if (!patch) return finding

      const changed = patch.body !== undefined && patch.body !== finding.body
      return {
        ...finding,
        body: patch.body ?? finding.body,
        edited: changed ? (true as const) : finding.edited,
        include: patch.include ?? finding.include,
        useSuggestion: patch.useSuggestion ?? finding.useSuggestion,
      }
    }),
  }

  const saved = await saveDraft(next)
  return { draft: saved, preview: buildReview(saved) }
})
