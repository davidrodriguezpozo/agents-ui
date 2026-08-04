import { findSession, patchSession } from '../../../utils/sessions'
import { commitsBetween, defaultRemote, ghReady, openPullRequest } from '../../../utils/pullRequest'

/**
 * Push the branch and open the pull request.
 *
 * The one thing this app does that other people can see, so it refuses on
 * anything unclear rather than guessing: no remote, no sign-in, or nothing
 * committed all stop here instead of producing half a pull request.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{
    title?: string
    body?: string
    commitFirst?: boolean
    draft?: boolean
  }>(event)

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  if (!body?.title?.trim()) {
    throw createError({ statusCode: 400, message: 'A pull request needs a title' })
  }

  const cwd = session.worktreePath
  const remote = await defaultRemote(cwd)
  if (!remote) {
    throw createError({
      statusCode: 409,
      data: { error: 'no_remote', message: 'This repository has no remote to push to.' },
    })
  }

  const gh = await ghReady(cwd)
  if (!gh.ready) {
    throw createError({ statusCode: 409, data: { error: 'gh_unavailable', message: gh.reason } })
  }

  // Checked again here rather than trusted from the preview: the preview may
  // be minutes old, and pushing a branch with nothing on it helps nobody.
  const commits = await commitsBetween(cwd, session.baseSha || session.baseBranch, 'HEAD')
  if (!commits.length && !body.commitFirst) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'nothing_to_review',
        message: 'There are no commits on this branch. Commit the work first, or tick the box to commit it now.',
      },
    })
  }

  try {
    const result = await openPullRequest({
      cwd,
      branch: session.branch,
      baseBranch: session.baseBranch,
      remote,
      title: body.title.trim(),
      body: body.body ?? '',
      commitFirst: body.commitFirst,
      draft: body.draft,
    })

    await patchSession(id, { prUrl: result.url })
    return result
  } catch (e) {
    // `gh` and `git push` say useful things when they fail — a rejected push,
    // a protected branch, a missing upstream — and swallowing that would leave
    // someone guessing.
    throw createError({
      statusCode: 500,
      data: {
        error: 'pr_failed',
        message: (e as { stderr?: string; message?: string }).stderr
          || (e as Error).message
          || 'Could not open the pull request.',
      },
    })
  }
})
