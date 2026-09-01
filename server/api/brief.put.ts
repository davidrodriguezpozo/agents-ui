import { briefIsEmpty, briefStore, PINNED_LIMIT, renderBrief } from '../utils/brief'
import { getProjectDir } from '../utils/scope'

/**
 * Change what you have told it to remember, or stop handing it to runs.
 *
 * Only the two things that are yours. The derived half is not writable here and
 * should not be: it is read off sessions and rituals, and a hand-edited copy of
 * those would be a second answer to a question that already has one — stale
 * within the minute and impossible to tell from the real thing.
 *
 * The pinned note is capped, and the cap is a boundary rather than tidiness. It
 * goes into the system prompt of every cold-started run on this machine, so its
 * size is a cost paid on every ritual and every session.
 */
export default defineEventHandler(async (event) => {
  interface Patch { pinned?: string; enabled?: boolean }

  const body = await readBody<Patch>(event).catch(() => ({} as Patch))

  if (body?.pinned !== undefined && String(body.pinned).length > PINNED_LIMIT) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'too_long',
        message: `That is longer than ${PINNED_LIMIT} characters. It is added to every run that `
          + 'starts cold, so it has to stay the size of a note rather than a document — put the '
          + 'long version in a file the run can read.',
      },
    })
  }

  const brief = await briefStore.update((current) => {
    if (body?.pinned !== undefined) current.pinned = String(body.pinned)
    if (body?.enabled !== undefined) current.enabled = body.enabled === true
    return { ...current }
  })

  const projectDir = getProjectDir(event) ?? undefined

  return {
    ...brief,
    projectDir,
    text: briefIsEmpty(brief) ? '' : renderBrief(brief, { projectDir }),
  }
})
