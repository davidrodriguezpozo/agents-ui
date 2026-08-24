import { getProjectDir } from '../../utils/scope'
import { startSession } from '../../utils/startSession'
import { asProviderId } from '../../utils/providers'
import { providerForProject } from '../../utils/projectProvider'
import type { TrustLevel } from '../../utils/trust'
import { titleFromPrompt } from '../../utils/sessions'
import { startTurn } from '../../utils/sessionTurn'
import { checkBudget } from '../../utils/budget'
import { sanitiseAttachments } from '~/utils/imageAttachments'

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
    /** Images for the first turn — a bug report is usually a screenshot. */
    attachments?: unknown
    repoDir?: string
    agentSlug?: string
    baseRef?: string
    trust?: TrustLevel
    /** Which agent runs the turns. Omitted falls back to the repository's default. */
    provider?: string
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
  const images = sanitiseAttachments(body?.attachments)

  // Checked before the worktree is cut, not after: a session that is over the
  // limit cannot do anything, and leaving an empty workspace behind to explain
  // that is clutter you would then have to clean up. A session named but not
  // told anything spends nothing, so it is never refused — and an image with no
  // words under it is being told something.
  if (prompt || images.length) {
    const budget = await checkBudget()
    if (!budget.allowed) {
      throw createError({ statusCode: 429, data: { error: 'over_budget', message: budget.reason! } })
    }
  }

  const session = await startSession({
    repoDir,
    // A session started with a screenshot and no sentence is named after the
    // file. It is not much, but it is the difference between finding it in the
    // list and reading five rows called Untitled session.
    title: body?.title?.trim()
      || (prompt ? titleFromPrompt(prompt) : images[0]?.name)
      || 'Untitled session',
    agentSlug: body?.agentSlug,
    baseRef: body?.baseRef,
    trust: body?.trust,
    // What was picked for this session, then what the repository was set to.
    // Anything unrecognised reads as nothing chosen rather than as an error —
    // the answer is Claude Code either way, and refusing to cut a worktree over
    // a bad provider name would lose more than it protects.
    provider: asProviderId(body?.provider) ?? await providerForProject(repoDir),
  })

  if (!prompt && !images.length) return session

  // The worktree exists and is recorded by this point, so a turn that will not
  // start is still a session you have. Report it rather than rolling back:
  // destroying a real workspace to tidy up an error message loses more than it
  // saves, and the session is one Send away from being fine.
  try {
    return { ...session, runId: await startTurn(session, prompt, { images }) }
  } catch (e: any) {
    return {
      ...session,
      startError: e?.data?.message ?? e?.message ?? 'The session was created but could not start working.',
    }
  }
})
