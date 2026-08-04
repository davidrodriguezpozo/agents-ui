import { getProjectDir } from '../../utils/scope'
import { startSession } from '../../utils/startSession'
import { titleFromPrompt } from '../../utils/sessions'
import { startTurn } from '../../utils/sessionTurn'

/**
 * Start a session: cut a branch and an isolated worktree from the repo, so this
 * conversation can change files without colliding with anything else running.
 *
 * Given a `prompt`, it also starts working immediately. Starting a session and
 * telling it what to do were two steps for no reason — the box asked what the
 * session should work on, took the answer as a name, and then left you on a
 * blank page to type the same intent again. Five parallel sessions meant
 * paying that five times, which is exactly the case sessions exist for.
 *
 * `title` is still accepted, for a session named without having anything to
 * say yet.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    title?: string
    prompt?: string
    repoDir?: string
    agentSlug?: string
    baseRef?: string
  }>(event)

  const repoDir = body?.repoDir || getProjectDir(event)
  if (!repoDir) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'no_project',
        message: 'Pick a project folder first — a session needs a repository to branch from.',
      },
    })
  }

  const prompt = body?.prompt?.trim() ?? ''

  const session = await startSession({
    repoDir,
    title: body?.title?.trim() || (prompt ? titleFromPrompt(prompt) : 'Untitled session'),
    agentSlug: body?.agentSlug,
    baseRef: body?.baseRef,
  })

  if (!prompt) return session

  // The worktree exists and is recorded by this point, so a turn that will not
  // start is still a session you have. Report it rather than rolling back:
  // destroying a real workspace to tidy up an error message loses more than it
  // saves, and the session is one Send away from being fine.
  try {
    return { ...session, runId: await startTurn(session, prompt) }
  } catch (e: any) {
    return {
      ...session,
      startError: e?.data?.message ?? e?.message ?? 'The session was created but could not start working.',
    }
  }
})
