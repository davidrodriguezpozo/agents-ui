import { findSession } from '../../../utils/sessions'
import { diffBase, worktreeDiff } from '../../../utils/worktrees'
import {
  commitsBetween,
  defaultRemote,
  existingPullRequest,
  ghReady,
  suggestBody,
  suggestTitle,
  type PullRequestPreview,
} from '../../../utils/pullRequest'

/**
 * What opening a pull request would do. Read-only: nothing is pushed, and
 * asking GitHub whether one already exists changes nothing there either.
 */
export default defineEventHandler(async (event): Promise<PullRequestPreview> => {
  const id = getRouterParam(event, 'id')!
  const session = await findSession(id)

  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const cwd = session.worktreePath
  // The base branch wherever naming it is safe, so a session that has caught
  // up with its base does not propose a pull request listing its base's commits.
  const baseRef = await diffBase(session)

  const [commits, diff, remote, gh] = await Promise.all([
    commitsBetween(cwd, baseRef, 'HEAD'),
    worktreeDiff(cwd, baseRef),
    defaultRemote(cwd),
    ghReady(cwd),
  ])

  const uncommittedFiles = diff.files.filter(f => !f.staged).map(f => f.path)
  const files = [...new Set(diff.files.map(f => f.path))]

  const blockedReason = !remote
    ? 'This repository has no remote, so there is nowhere to push the branch.'
    : !gh.ready
      ? gh.reason
      : !commits.length
        ? 'There are no commits on this branch yet. Commit the work first — a pull request needs something to review.'
        : undefined

  return {
    canOpen: !blockedReason,
    blockedReason,
    baseBranch: session.baseBranch,
    branch: session.branch,
    commits,
    uncommittedFiles,
    files,
    remote,
    existingUrl: (await existingPullRequest(cwd, session.branch)) ?? undefined,
    suggestedTitle: suggestTitle(session.title, commits),
    suggestedBody: suggestBody(commits, files),
  }
})
