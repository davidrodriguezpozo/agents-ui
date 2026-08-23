import { existsSync } from 'node:fs'
import { gitIdentity } from './identity'
import { findSession, patchSession, type Session } from './sessions'
import { resolveRunOptionsFor } from './runOptions'
import { createRun, getActive, readRun, type Run } from './runStore'
import { executeRun } from './runner'
import { notify } from './notify'
import { rulesForProject } from './projectRules'
import { contextDirsFor } from './projects'
import { permissionModeFor } from './trust'
import { ensureTranscriptFor } from './transcripts'
import { checkBudget } from './budget'
import { withRunSlot } from './runQueue'
import {
  clearQueue, queueMessage, requeueMessage, takeQueuedMessage, type QueuedMessage,
} from './sessionQueue'
import { dropQueuedAttachments, loadQueuedAttachments } from './queuedAttachments'
import { steerRun } from './liveSteer'
import { worktreeFingerprint } from './checks'
import { verifySessionAfterTurn } from './sessionChecks'
import { summariseAfterTurn } from './sessionSummary'
import { composeAfterTurn } from './reviewDraft'
import { clearRepair, planRepair } from './sessionRepair'
import type { SessionCheck } from './checks'
import { base64Bytes } from '~/utils/base64'
import type { ModelImage } from '~/utils/imageAttachments'
import type { ChatAttachmentRef } from '~/types'

/**
 * Sending a turn to a session.
 *
 * Lives here rather than in the endpoint because a turn is now started from
 * two places: someone typing into a session, and a session being created with
 * something to do. Those must behave identically — the same permissions, the
 * same resume, the same checks afterwards — and the surest way to get that is
 * for there to be one of them.
 */

/**
 * A turn short enough that you never looked away does not warrant a banner —
 * you watched it happen. Past about half a minute you have gone to do
 * something else, which is the moment being told is worth anything.
 */
const WORTH_INTERRUPTING_MS = 30_000

async function announceTurn(
  sessionId: string,
  title: string,
  run: Run | null,
  elapsedMs: number,
): Promise<void> {
  if (!run) return

  const link = `/sessions/${sessionId}`

  if (run.status === 'failed') {
    await notify('failed', `${title} failed`, run.error || 'The turn ended early.', link)
    return
  }

  // A stopped turn was stopped by you, a moment ago, on purpose.
  if (run.status === 'cancelled' || elapsedMs < WORTH_INTERRUPTING_MS) return

  await notify('finished', title, run.output || 'Finished with nothing to report.', link)
}

/**
 * Refuse a turn this session cannot take, in words that say what to do about
 * it. Returns null when there is no objection.
 */
export function turnRefusal(session: Session): { error: string; message: string } | null {
  if (session.status === 'archived') {
    return {
      error: 'session_closed',
      message: 'This session has been closed. Start a new one to keep working.',
    }
  }

  // Running with a cwd that does not exist silently produces nothing, so
  // refuse rather than appear to work.
  if (!existsSync(session.worktreePath)) {
    return {
      error: 'worktree_missing',
      message: 'This session\'s workspace is no longer on disk. Close the session and start a new one.',
    }
  }

  return null
}

/**
 * Whether this session's last turn is still going.
 *
 * Read from the run rather than from `session.status`, because the status is a
 * field somebody has to remember to write and the run is the thing that is
 * actually alive. Both the refusal in `startTurn` and the queue depend on the
 * same answer, so there is one of them.
 */
export async function isTurnRunning(session: Session): Promise<boolean> {
  const lastRunId = session.runIds.at(-1)
  if (!lastRunId) return false

  const previous = getActive(lastRunId)?.run ?? await readRun(lastRunId)
  return !!previous && (previous.status === 'running' || previous.status === 'queued')
}

/**
 * Start the next thing you typed while it was working, if there is one.
 *
 * Called when a turn ends and when a message is queued into a session that
 * turns out to be free after all. Returns the run id it started, or null when
 * there was nothing to send or nothing it could do with it.
 *
 * One message per call, oldest first. Queued messages are separate turns rather
 * than one concatenated prompt: they were written minutes apart about different
 * things, and a transcript that shows them as one paragraph loses which answer
 * belonged to which instruction.
 *
 * Never throws. Everything that calls it is either detached from a turn that
 * has already been reported or is doing this on the side of answering something
 * else, and neither has anywhere useful to put an error.
 */
export async function flushQueue(sessionId: string): Promise<string | null> {
  try {
    const session = await findSession(sessionId)
    if (!session?.queued?.length) return null

    // Closed, or its workspace is gone. Nothing queued is ever going to send,
    // so the queue is dropped rather than left claiming otherwise.
    if (turnRefusal(session)) {
      await clearQueue(sessionId)
      return null
    }

    // Taken only once it is clear there is somewhere for it to go: taking first
    // and putting it back is the same thing with a window in it where the
    // message is on neither side.
    if (await isTurnRunning(session)) return null

    const next = await takeQueuedMessage(sessionId)
    if (!next) return null

    // Read off disk here rather than when it was queued: this is the moment
    // there is a turn to hand them to.
    const images = await loadQueuedAttachments(sessionId, next.attachments)

    try {
      const runId = await startTurn(session, next.text, { images })
      // Only now. Deleting before the turn starts would leave a message that
      // failed to send holding references to files that no longer exist, and
      // the requeue below is exactly the case that has to survive.
      await dropQueuedAttachments(sessionId, next.attachments)
      return runId
    } catch {
      await requeueMessage(sessionId, next)
      return null
    }
  } catch (e) {
    console.error('[sessionQueue] could not send the next queued message', e)
    return null
  }
}

/**
 * Send an instruction, or hold it until the session is free.
 *
 * The decision is made here rather than in the page because the page's idea of
 * whether a session is busy is however old its last load was — and a composer
 * that decides for itself either refuses a message the session would have
 * taken, or sends one into a running turn and is told 409 for its trouble.
 */
export async function sendOrQueue(
  session: Session,
  input: string,
  images: ModelImage[] = [],
): Promise<{ runId: string; queued?: undefined } | { queued: QueuedMessage; runId?: undefined }> {
  const refusal = turnRefusal(session)
  if (refusal) throw createError({ statusCode: 409, data: refusal })

  /**
   * Anything already waiting has to go first, even when the session is free.
   *
   * A queue left over from a turn you stopped is still a queue: sending
   * straight past it would put the sentence you typed ten minutes ago after
   * the one you typed just now, which is not what either of them meant.
   */
  const waiting = session.queued?.length ?? 0
  if (!waiting && !await isTurnRunning(session)) {
    return { runId: await startTurn(session, input, { images }) }
  }

  const queued = await queueMessage(session.id, input, images)
  if (!queued) throw createError({ statusCode: 400, message: 'input is required' })

  /**
   * Sends the front of the queue if the session is free — which is both how a
   * message added to a standing queue on an idle session gets going, and how
   * the window between the check above and the write is closed: a turn that
   * ended inside it ran its own flush before this message existed, so nothing
   * would be coming back for it.
   *
   * Race-free either way: `takeQueuedMessage` is atomic, so of two flushers
   * one gets the message and the other gets null.
   */
  const runId = await flushQueue(session.id)
  return runId ? { runId } : { queued }
}

/**
 * Say it into the turn that is running, rather than after it.
 *
 * The deliberate half of the pair `sendOrQueue` is the default of. Queueing is
 * right for "and then do this"; this is for "no, not that file", where waiting
 * out the turn means paying for the rest of a wrong answer before correcting it.
 *
 * Falls back rather than refusing, and that matters: the turn can end in the
 * moment between pressing the button and this running, and a refusal there would
 * lose a sentence for a race the person could not see. What comes back says
 * which of the three happened — steered into the running turn, sent as a turn of
 * its own because nothing was running, or queued because a turn was running and
 * would not take it.
 */
export async function sendSteered(
  session: Session,
  input: string,
  images: ModelImage[] = [],
): Promise<
  | { steered: true; runId: string; queued?: undefined }
  | { runId: string; steered?: undefined; queued?: undefined }
  | { queued: QueuedMessage; runId?: undefined; steered?: undefined }
> {
  const refusal = turnRefusal(session)
  if (refusal) throw createError({ statusCode: 409, data: refusal })

  // The last run is the only one that can be running — a session takes one turn
  // at a time, which `startTurn` guarantees.
  const runId = session.runIds.at(-1)
  if (runId && steerRun(runId, input, images)) return { steered: true, runId }

  return sendOrQueue(session, input, images)
}

/**
 * What a failing verdict leads to, once the checks are in.
 *
 * Either the session takes another turn at fixing itself, or the failure is
 * somebody's problem and they should be told. Exactly one of those, which is
 * why both live here rather than in the checks.
 *
 * Never throws — everything below this point is detached from a turn that has
 * already finished and been reported.
 */
async function actOnVerdict(sessionId: string, check: SessionCheck | null): Promise<void> {
  try {
    const prompt = await planRepair(sessionId, check)

    if (!prompt) {
      // No repair coming, so a failure now needs a person. Re-read the session:
      // a suite can run for ten minutes and the title, or the session itself,
      // may not be what it was when the turn ended.
      const session = await findSession(sessionId)
      if (session && check?.status === 'failing') {
        await notify(
          'failed',
          `${session.title} — checks failed`,
          `\`${check.command}\` did not pass in this session's workspace.`,
          `/sessions/${session.id}`,
        )
      }
      return
    }

    const session = await findSession(sessionId)
    if (!session) return

    // Everything a person's turn is refused for applies here too — an archived
    // session or a missing workspace is not something to retry into.
    if (turnRefusal(session)) return

    await startTurn(session, prompt, { repair: true })
  } catch (e: any) {
    // The likely one is the daily limit: `startTurn` refuses, and a streak that
    // cannot afford another attempt has ended rather than paused. Recorded on
    // the session so the row says why it stopped instead of looking abandoned.
    const session = await findSession(sessionId)
    if (session?.repair?.state === 'running') {
      await patchSession(sessionId, {
        repair: {
          ...session.repair,
          state: 'gave-up',
          reason: e?.data?.message || 'Could not start another attempt.',
          updatedAt: Date.now(),
        },
      })
    }
  }
}

/**
 * Start a turn and return its run id. The run itself is detached: it outlives
 * the request, streams to whoever is attached, and persists for whoever
 * attaches later.
 *
 * `repair` marks a turn this app decided to send, rather than one a person
 * typed. The difference matters in one place: a turn somebody typed is a new
 * instruction, and ends whatever the session had been doing on its own.
 *
 * `images` are handed to the run rather than written onto it. The record keeps
 * their names and the CLI keeps the bytes, which is the split every other part
 * of this app makes about a screenshot: the model needs it once, and the history
 * needs to say it was there.
 */
export async function startTurn(
  session: Session,
  input: string,
  opts: { repair?: boolean; images?: ModelImage[] } = {},
): Promise<string> {
  const refusal = turnRefusal(session)
  if (refusal) throw createError({ statusCode: 409, data: refusal })

  // A second turn while one is still running would interleave two agents in
  // the same worktree, which is the exact problem sessions exist to prevent.
  // Typing during a turn is not refused any more — it queues, see `sendOrQueue`
  // — but this stays as the guarantee underneath that.
  if (await isTurnRunning(session)) {
    throw createError({
      statusCode: 409,
      data: { error: 'session_busy', message: 'This session is still working. Wait for it to finish or stop it.' },
    })
  }

  // Refused before the workspace is touched and before anything is spent, so
  // hitting the daily limit costs nothing and changes nothing.
  const budget = await checkBudget()
  if (!budget.allowed) {
    throw createError({
      statusCode: 429,
      data: { error: 'over_budget', message: budget.reason! },
    })
  }

  // A fresh instruction supersedes whatever the session was doing unattended.
  // Without this, a streak that gave up an hour ago still counts against the
  // checks that fail after what you have just asked for.
  if (!opts.repair) await clearRepair(session)

  // Sessions adopted before this was understood have their conversation only
  // in the repository's transcript directory, where a run in the worktree will
  // never find it. Putting it in place here repairs them on their next turn
  // rather than leaving them permanently unable to resume.
  if (session.adoptedAt && session.sdkSessionId) {
    await ensureTranscriptFor(session.repoDir, session.worktreePath, session.sdkSessionId)
  }

  const options = await resolveRunOptionsFor({
    projectDir: session.worktreePath,
    // Settings keyed by repository — the sandbox — are filed against the repo,
    // not this session's worktree, which is deleted when the session closes.
    repoDir: session.repoDir,
    agentSlug: session.agentSlug,
    // How much this session was told it could do without stopping to ask.
    permissionMode: permissionModeFor(session.trust),
    // What this project has already been trusted with. Without it every
    // session starts from scratch and asks again for approvals given a dozen
    // times before.
    allowRules: await rulesForProject(session.repoDir),
    // A worktree is a copy of the repository and nothing else. When the
    // repository was picked out of a larger folder, the rest of that folder is
    // most of what the work is about — and it would otherwise disappear the
    // moment anything moved into a session.
    additionalDirectories: await contextDirsFor(session.repoDir),
  })

  /*
   * Who this turn is on behalf of, resolved now and written onto the run.
   *
   * Every turn started through here is stamped, repair turns included. A repair
   * turn is this app finishing the job somebody asked for, in their session, on
   * their machine — splitting a session's cost between a person and nobody
   * depending on which turns the app decided to take answers "who did this"
   * worse, not better. What is genuinely nobody's is a ritual, and a ritual does
   * not come through here: it creates its run directly and stays unattributed.
   *
   * The repository rather than the worktree, so a session and its turns agree
   * about one person.
   */
  const by = await gitIdentity(session.repoDir)

  const images = opts.images ?? []

  const run = createRun({
    kind: 'chat',
    // An image with nothing typed under it is a whole instruction, and a turn
    // called "" in the list is one nobody can find again.
    title: input.trim().slice(0, 70) || titleForImages(images),
    input: input.trim(),
    attachments: images.length ? images.map(describe) : undefined,
    agentSlug: session.agentSlug,
    projectDir: session.worktreePath,
    sessionId: session.id,
    by,
  })

  await patchSession(session.id, {
    status: 'running',
    runIds: [...session.runIds, run.id],
    // Sending a session an instruction is the clearest statement there is that
    // you are not finished with it, so a session you had set aside comes back
    // out of History rather than taking a second click to retrieve.
    filedAt: undefined,
  })

  const startedAt = Date.now()

  // What the workspace looked like before the turn. Comparing against it
  // afterwards is what distinguishes a turn that changed the code from one
  // that answered a question — only the first is worth a test run.
  const fingerprintBefore = await worktreeFingerprint(session.worktreePath)

  const execution = {
    resumeSessionId: session.sdkSessionId,
    maxBudgetUsd: budget.maxBudgetUsd,
    images,
  }

  // A turn you typed goes now — you are sitting in front of it, and "queued
  // behind a ritual" is a worse experience than a busy machine. A repair turn
  // is nobody's foreground, so it waits its turn like the rest of the
  // unattended work.
  void (opts.repair
    ? withRunSlot(() => executeRun(run, options, execution))
    : executeRun(run, options, execution))
    .finally(async () => {
      // The SDK hands back its own id on the first turn; keep it so the next
      // turn resumes rather than starting a new conversation.
      const finished = getActive(run.id)?.run ?? await readRun(run.id)
      await patchSession(session.id, {
        status: 'idle',
        sdkSessionId: finished?.sdkSessionId ?? session.sdkSessionId,
      })

      await announceTurn(session.id, session.title, finished, Date.now() - startedAt)

      /**
       * Anything typed during the turn goes now, before the checks below, so
       * what it waits for is the turn you were watching and not a test suite
       * after it.
       *
       * Only after a turn that finished, though. The two other endings are both
       * reasons to hold on to what you wrote:
       *
       *   - Stopping is the one moment you are most certainly at the keyboard
       *     and most certainly changing your mind. Having your own queued
       *     sentence fire into the mess you just halted is the opposite of what
       *     the button meant.
       *   - A turn that failed usually failed for a reason the next turn will
       *     hit as well — the conversation would not resume, the day's budget is
       *     spent — and a queue of three would empty itself into three
       *     identical failures without anybody being asked.
       *
       * Either way it stays queued, the page says why, and sending it anyway is
       * one click.
       */
      const queuedRun = finished?.status === 'completed' ? await flushQueue(session.id) : null

      // Detached: the checks outlast the turn by minutes, and the session is
      // idle and usable throughout. The verdict lands on the record when it
      // arrives, and may start the next turn on its own.
      //
      // A turn you stopped by hand does not lead anywhere. You interrupted it
      // deliberately, and having it immediately restart itself to fix what it
      // was halfway through is the opposite of what stopping means.
      //
      // Nor does a turn with another one already running behind it: the checks
      // would be a ten-minute suite over a workspace being edited underneath
      // them, and a verdict about a state nobody will ever see again. The turn
      // that queued behind this one runs them at its own end.
      if (finished?.status !== 'cancelled' && !queuedRun) {
        void verifySessionAfterTurn(session.id, fingerprintBefore)
          .then(check => actOnVerdict(session.id, check))
      }

      // Same trigger as the checks, and for the same reason: a turn that
      // changed nothing has nothing to describe. Kept separate from them
      // because a sentence takes seconds and a test suite takes minutes —
      // waiting on the checks would leave the list mute for the whole of it.
      const after = await worktreeFingerprint(session.worktreePath)
      if (after && after !== fingerprintBefore) {
        void summariseAfterTurn(session.id, after)
      }

      // A review session's turn produces a report rather than a change, so the
      // fingerprint above is deliberately not the trigger — a review that
      // changed no files is the ordinary case and the only one worth composing.
      //
      // Composed here rather than when somebody opens the pane, because a review
      // nobody has opened is exactly the one worth telling them about: the count
      // on Land is the whole point of composing eagerly, and it cannot count what
      // has not been composed. It is a parser over text this run already
      // produced, so the only cost is two git calls to place the findings.
      if (session.reviewOf && finished?.status !== 'cancelled') {
        void composeAfterTurn(session.id)
      }
    })

  return run.id
}

/**
 * What the record keeps of an image: everything except the image.
 *
 * Keyed by position rather than by name — two screenshots pasted in a row are
 * both called `image.png`, and a list keyed on that draws one of them.
 */
function describe(image: ModelImage, index: number): ChatAttachmentRef {
  return {
    id: String(index),
    name: image.name,
    mediaType: image.mediaType,
    size: base64Bytes(image.data),
  }
}

function titleForImages(images: ModelImage[]): string {
  if (!images.length) return 'Turn'
  return images.length === 1 ? images[0]!.name : `${images.length} images`
}
