import { getProjectDir } from '../../utils/scope'
import { startSession } from '../../utils/startSession'
import type { TrustLevel } from '../../utils/trust'
import { asProviderId, providerFor, PROVIDER_IDS, type ProviderId } from '../../utils/providers'
import { findCursorAgent } from '../../utils/cursorAgentExecutable'
import { findClaude } from '../../utils/cli'
import { newSessionId, titleFromPrompt, type Session } from '../../utils/sessions'
import { startTurn } from '../../utils/sessionTurn'
import { checkBudget } from '../../utils/budget'
import { sanitiseAttachments } from '~/utils/imageAttachments'

/**
 * Race the agents: one instruction, one session per agent, all at once.
 *
 * This is what the provider seam was cut for. Three agents on the same brief, in
 * three worktrees, gated on the same `make check`, and whichever one passed is
 * the one that lands. None of the CLIs can do that for itself, and every hard
 * half of it was already here — the worktrees, the branch naming, the checks that
 * run themselves after a turn, the merge train.
 *
 * Which is why this endpoint is so small. It is `batch.post.ts` with the axes
 * swapped: that one is N instructions on one agent, this one is one instruction
 * on N agents. Nothing coordinates the entrants afterwards and nothing needs to —
 * they are ordinary sessions that happen to share a `raceId`, so every mechanism
 * that already works on a session works on each of them without knowing it is in
 * a race. See the note on `Session.raceId`.
 *
 * **The cost is stated rather than hidden.** N agents on one instruction is N
 * times the tokens for one piece of work, and that is the trade being made
 * deliberately: it is cheap against an afternoon spent on a diff that was never
 * going to pass. The caller is the one that has to say so, and the page does.
 */

/**
 * Which agents this machine can actually race.
 *
 * Asked of the same lookups the runs use, so a race cannot be started against a
 * binary that is not here — the failure that would otherwise happen after the
 * worktree was cut, once per missing agent, leaving checkouts to clean up.
 */
async function installedProviders(): Promise<ProviderId[]> {
  const claude = await findClaude()
  const cursor = findCursorAgent()

  return PROVIDER_IDS.filter(id => (id === 'cursor' ? Boolean(cursor) : Boolean(claude)))
}

export interface RaceResult {
  raceId: string
  started: (Session & { runId?: string; startError?: string })[]
  failed: { provider: string; reason: string }[]
}

export default defineEventHandler(async (event): Promise<RaceResult> => {
  const body = await readBody<{
    prompt?: string
    repoDir?: string
    baseRef?: string
    trust?: TrustLevel
    agentSlug?: string
    /** Which agents to race. Omitted races every one installed. */
    providers?: string[]
    /**
     * Images for each entrant's first turn. Every agent gets the same ones —
     * they are being asked the same question, and a race where one of them
     * could not see the screenshot is not a comparison.
     */
    attachments?: unknown
  }>(event)

  const repoDir = body?.repoDir || getProjectDir(event)
  if (!repoDir) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'no_project',
        message: 'Pick a project folder first — a race needs a repository to branch from.',
      },
    })
  }

  const prompt = body?.prompt?.trim() ?? ''
  const images = sanitiseAttachments(body?.attachments)
  if (!prompt && !images.length) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_prompt', message: 'Say what the agents should each do.' },
    })
  }

  const available = await installedProviders()

  /*
   * Asked for, narrowed to what is installed — rather than refused for naming
   * one that is not. A race of the two you have is worth running; a 400 saying
   * one of the three is missing is a dialog to dismiss before getting the same
   * two anyway.
   */
  const asked = (body?.providers ?? [])
    .map(asProviderId)
    .filter((id): id is ProviderId => Boolean(id))

  const providers = [...new Set(asked.length ? asked.filter(id => available.includes(id)) : available)]

  if (providers.length < 2) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'nothing_to_race',
        message: available.length < 2
          ? 'A race needs two agents on this machine and there is one. '
            + 'Install another and it becomes available here.'
          : 'Pick at least two agents to race.',
      },
    })
  }

  // Checked once, before any worktree: N sessions that are all going to refuse
  // their first turn is N checkouts to clean up. Worth stating that this is the
  // *same* check a single session gets — a race is N times the spend and the
  // limit does not know that, which is why the page says so before you press it.
  const budget = await checkBudget()
  if (!budget.allowed) {
    throw createError({ statusCode: 429, data: { error: 'over_budget', message: budget.reason! } })
  }

  // Reusing the session id generator: it is already the thing in this codebase
  // that makes a short, unique, sortable id, and a race needs exactly that.
  const raceId = newSessionId()
  // A race started from a screenshot alone is named after the file, the same way
  // a single session is — a list of rows called "Untitled session · Cursor" is
  // one nobody can navigate.
  const base = prompt ? titleFromPrompt(prompt) : images[0]?.name ?? 'Untitled race'

  const started: RaceResult['started'] = []
  const failed: RaceResult['failed'] = []

  /*
   * Sequential, for the reason `batch.post.ts` gives: every one of these runs
   * `git worktree add` against the same repository, and concurrent ones contend
   * on the index lock with failures that read like nothing in particular. The
   * turns are detached, so the first agent is already working while the second
   * worktree is still being cut — which is the whole point, and is unaffected.
   */
  for (const provider of providers) {
    const label = providerFor(provider).label
    try {
      const session = await startSession({
        repoDir,
        // Named for the agent, because the alternative is N rows with identical
        // titles and no way to tell from a list which one you are opening. The
        // branch already differs — `branchNameFor` appends the session id — so
        // this is for reading rather than for uniqueness.
        title: `${base} · ${label}`,
        trust: body?.trust,
        agentSlug: body?.agentSlug,
        baseRef: body?.baseRef,
        provider,
        raceId,
      })

      try {
        started.push({ ...session, runId: await startTurn(session, prompt, { images }) })
      } catch (e: any) {
        // The workspace exists and is usable; only the first turn did not go.
        started.push({
          ...session,
          startError: e?.data?.message ?? e?.message ?? 'Created, but could not start working.',
        })
      }
    } catch (e: any) {
      // One agent failing to get a worktree should not cost the others theirs.
      failed.push({ provider: label, reason: e?.data?.message ?? e?.message ?? 'Could not start.' })
    }
  }

  return { raceId, started, failed }
})
