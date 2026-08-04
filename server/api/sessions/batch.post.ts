import { getProjectDir } from '../../utils/scope'
import { startSession } from '../../utils/startSession'
import { titleFromPrompt, type Session } from '../../utils/sessions'
import { startTurn } from '../../utils/sessionTurn'
import { checkBudget } from '../../utils/budget'

/**
 * Start several sessions at once, one per instruction.
 *
 * The thing this app is for is doing several pieces of work at the same time,
 * and until now that meant starting them one at a time — name it, wait for the
 * worktree, land on a blank page, type the instruction, go back, repeat. The
 * work was parallel; setting it up was not.
 */

/**
 * Enough for a morning's work, few enough that a fat-fingered paste cannot
 * quietly cut fifty branches. Refused rather than truncated: silently doing
 * some of what was asked is worse than doing none of it.
 */
const MAX_AT_ONCE = 20

export interface BatchResult {
  started: (Session & { runId?: string; startError?: string })[]
  failed: { prompt: string; reason: string }[]
}

export default defineEventHandler(async (event): Promise<BatchResult> => {
  const body = await readBody<{ prompts?: string[]; repoDir?: string; agentSlug?: string; baseRef?: string }>(event)

  const repoDir = body?.repoDir || getProjectDir(event)
  if (!repoDir) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'no_project',
        message: 'Pick a project folder first — sessions need a repository to branch from.',
      },
    })
  }

  const prompts = (body?.prompts ?? [])
    .map(p => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)

  if (!prompts.length) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_prompts', message: 'Give each session a line saying what it should do.' },
    })
  }

  if (prompts.length > MAX_AT_ONCE) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'too_many',
        message: `That is ${prompts.length} sessions, and ${MAX_AT_ONCE} is the most at once. Each one is a full checkout of the repository.`,
      },
    })
  }

  // Checked once, before any of them: starting twenty workspaces that are all
  // going to refuse their first turn is twenty checkouts to clean up.
  const budget = await checkBudget()
  if (!budget.allowed) {
    throw createError({ statusCode: 429, data: { error: 'over_budget', message: budget.reason! } })
  }

  const started: BatchResult['started'] = []
  const failed: BatchResult['failed'] = []

  // Deliberately sequential. Every one of these runs `git worktree add` against
  // the same repository, and concurrent ones contend on the index lock — the
  // failures are intermittent and read like nothing in particular. The turns
  // themselves are detached, so each session is already working while the next
  // worktree is still being cut; only the setup is serialised.
  for (const prompt of prompts) {
    try {
      const session = await startSession({
        repoDir,
        title: titleFromPrompt(prompt),
        agentSlug: body?.agentSlug,
        baseRef: body?.baseRef,
      })

      try {
        started.push({ ...session, runId: await startTurn(session, prompt) })
      } catch (e: any) {
        // The workspace exists and is usable; only the first turn did not go.
        started.push({
          ...session,
          startError: e?.data?.message ?? e?.message ?? 'Created, but could not start working.',
        })
      }
    } catch (e: any) {
      // One bad branch name or a locked repo should not cost the other four.
      failed.push({ prompt, reason: e?.data?.message ?? e?.message ?? 'Could not start.' })
    }
  }

  return { started, failed }
})
