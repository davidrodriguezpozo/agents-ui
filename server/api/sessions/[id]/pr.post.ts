import { findSession, patchSession } from '../../../utils/sessions'
import { commitsBetween, defaultRemote, ghReady, openPullRequest } from '../../../utils/pullRequest'
import { replyToIssue } from '../../../utils/issueReply'
import { diffBase } from '../../../utils/worktrees'

/**
 * Push the branch and open the pull request.
 *
 * The one thing this app does that other people can see, so it refuses on
 * anything unclear rather than guessing: no remote, no sign-in, or nothing
 * committed all stop here instead of producing half a pull request.
 *
 * It is also the one moment a session started from an issue tells that issue
 * anything — `replyToIssue`, once, and only when somebody has turned it on. This
 * is the only caller, which is what makes "never on a later push, never twice"
 * true of the whole app rather than of a flag it checks.
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
  // Measured from the same place the preview measured from, so the body it
  // suggested and the body it opens with describe the same set of commits.
  const commits = await commitsBetween(cwd, await diffBase(session), 'HEAD')
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

    const updated = await patchSession(id, { prUrl: result.url }) ?? session

    /*
     * Then, and only then, tell the issue.
     *
     * After the record rather than before, and outside nothing: the pull request
     * exists by this point, and `replyToIssue` never throws for that reason — a
     * comment that could not be posted must not report an open pull request as a
     * failure. What it says comes back beside the URL so the page can say the
     * issue was told, or say why it was not.
     *
     * The title and body are handed over so the same text a reviewer will read
     * decides whether a comment is needed at all: one saying `Closes #42` has
     * already told the issue, and GitHub said it better.
     */
    const issue = await replyToIssue(updated, {
      url: result.url,
      title: body.title.trim(),
      body: body.body ?? '',
    })

    return { ...result, issue }
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
