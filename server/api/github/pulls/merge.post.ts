import { getProjectDir } from '../../../utils/scope'
import { landPullRequest } from '../../../utils/prWatch'
import { readPulls, verdictFor } from '../../../utils/reviews'

/**
 * Merge one, from the page that told you it was ready.
 *
 * The only thing in this feature that other people can see, so it is the only
 * thing that is not simply a read wired to a button:
 *
 *   - **The page's word is not taken for it.** The verdict is read again here,
 *     from GitHub, at the moment of the merge. A page open in a tab since this
 *     morning is a claim about this morning, and "ready to merge" is exactly the
 *     kind of claim that stops being true when somebody pushes.
 *   - **It merges what the badge said.** Refused unless the fresh reading is
 *     still `ready` — approved, green and mergeable. Not "it was when you
 *     looked".
 *   - **Silence is still not success.** A pull request with nothing reporting
 *     never reaches `ready` with checks of `none`… except that it does, because
 *     a person pressing a button is allowed to merge a repository that has no
 *     CI. What is refused is doing it *unattended*, which is `prWatch`, and this
 *     is not that.
 *
 * `--merge` and not `--delete-branch`, both for the reasons `landPullRequest`
 * gives.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ number?: number }>(event)
  const repoDir = getProjectDir(event)

  if (!repoDir) {
    throw createError({ statusCode: 400, data: { error: 'no_project', message: 'Pick a project folder first.' } })
  }
  if (typeof body?.number !== 'number') {
    throw createError({ statusCode: 400, data: { error: 'no_number', message: 'Which pull request?' } })
  }

  const reading = await readPulls(repoDir)
  if (!reading.ok) {
    throw createError({ statusCode: 502, data: { error: 'github_unavailable', message: reading.reason } })
  }

  const pull = reading.mine.find(p => p.number === body.number)
  if (!pull) {
    throw createError({
      statusCode: 404,
      data: {
        error: 'not_listed',
        message: `#${body.number} is not one of your open pull requests any more.`,
      },
    })
  }

  const verdict = verdictFor(pull)
  if (verdict.state !== 'ready') {
    throw createError({
      statusCode: 409,
      data: {
        error: 'not_ready',
        message: `#${pull.number} is not ready any more — ${verdict.label.toLowerCase()}. ${verdict.detail}.`,
      },
    })
  }

  const result = await landPullRequest(repoDir, pull.number)
  if (!result.ok) {
    throw createError({ statusCode: 502, data: { error: 'merge_refused', message: result.message } })
  }

  return { merged: true, number: pull.number, url: pull.url }
})
