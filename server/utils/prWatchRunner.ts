import { existsSync } from 'node:fs'
import { findSession, patchSession, readSessions, type Session } from './sessions'
import { recordLanded } from './landed'
import {
  decideWatch, fixPrompt, landPullRequest, pushFix, readPrStatus,
  type SessionPrWatch,
} from './prWatch'
import { startTurn } from './sessionTurn'
import { checkBudget } from './budget'
import { notify } from './notify'

/**
 * Driving the pull request watch, once per event poll.
 *
 * Split from `prWatch` for the reason `sessionRepair` gives for the same split:
 * that module decides and this one acts, and keeping the dependency pointing
 * one way is what stops "a turn ends, so check, so fix, so a turn ends" from
 * becoming a circular import.
 *
 * The whole thing is a state machine advanced by polling, with no callback into
 * the turn lifecycle. That is deliberate. A fix turn is detached — `startTurn`
 * returns as soon as it is away — so the alternative is a completion hook that
 * has to survive the process stopping mid-turn. Asking "is this session still
 * busy?" every two minutes needs nothing to survive anything: a watch left in
 * `fixing` by a restart is picked up by the next poll and carries on.
 */

/** Which states still have something to do. The rest are over. */
const ACTIVE = new Set(['watching', 'fixing'])

/**
 * Where to run `git` and `gh` for this session.
 *
 * The worktree while it exists, because that is where the branch is checked
 * out and where a push has to happen. A session whose workspace has been
 * removed can still have its pull request read and landed from the repository
 * it branched from.
 */
function dirFor(session: Session): string | null {
  if (existsSync(session.worktreePath)) return session.worktreePath
  if (existsSync(session.repoDir)) return session.repoDir
  return null
}

async function conclude(
  session: Session,
  watch: SessionPrWatch,
  state: 'landed' | 'stopped',
  reason: string,
  kind: 'finished' | 'needsYou' = 'needsYou',
  /**
   * How it got in, for the two ways this ends in a landing.
   *
   * Recorded here rather than at the call sites so that "the watcher decided
   * this is in" and "the session says it is in" cannot come apart — they are
   * one event, and a `landed` pull request whose session showed no landing was
   * the state of the world before this.
   *
   * The two differ in a way worth keeping: one is this app merging a green pull
   * request, the other is finding that somebody merged it on github.com while
   * we were watching. Only one of those is work this machine did.
   */
  how?: 'pull-request' | 'elsewhere',
): Promise<void> {
  await patchSession(session.id, {
    prWatch: { ...watch, state, reason, updatedAt: Date.now() },
  })

  if (state === 'landed' && how) {
    await recordLanded(session.id, { at: Date.now(), how, pr: watch.number })
  }

  await notify(kind, `${session.title} — #${watch.number}`, reason, `/sessions/${session.id}`)
}

/**
 * One session's pull request, advanced by one step.
 *
 * Never throws. This runs inside a loop over every watched session, and one
 * repository that `gh` is unhappy about must not stop the others being asked.
 */
async function advance(session: Session): Promise<void> {
  const watch = session.prWatch
  if (!watch || !ACTIVE.has(watch.state)) return

  const cwd = dirFor(session)
  if (!cwd) {
    await conclude(session, watch, 'stopped', 'The workspace is no longer on disk, so this pull request is no longer being watched.')
    return
  }

  /**
   * A fix turn that has finished needs its commits pushed before CI can say
   * anything new. Handled before the status is read, because until the push
   * lands GitHub is still describing the commit that already failed.
   */
  if (watch.state === 'fixing') {
    // Still working. Nothing to do, and reading the status now would only find
    // the failure that started this.
    if (session.status === 'running') return

    const push = await pushFix(cwd, session.branch)
    if (!push.pushed) {
      await conclude(session, watch, 'stopped', push.message ?? 'Nothing was pushed, so CI will not run again.')
      return
    }

    // Back to watching, with this commit recorded as handled so the red verdict
    // that is still standing does not immediately earn another turn.
    await patchSession(session.id, {
      prWatch: { ...watch, state: 'watching', updatedAt: Date.now() },
    })
    return
  }

  const status = await readPrStatus(cwd, String(watch.number))

  // Could not ask. Not an answer, and acting on it would mean landing a pull
  // request the first time the network blinked.
  if (!status) {
    await patchSession(session.id, {
      prWatch: { ...watch, lastPolledAt: Date.now(), updatedAt: Date.now() },
    })
    return
  }

  const decision = decideWatch(status, watch)

  if (decision.action === 'wait') {
    await patchSession(session.id, {
      prWatch: { ...watch, lastPolledAt: Date.now(), updatedAt: Date.now() },
    })
    return
  }

  if (decision.action === 'done') {
    const landed = status.state === 'MERGED'
    await conclude(
      session,
      watch,
      landed ? 'landed' : 'stopped',
      decision.reason!,
      landed ? 'finished' : 'needsYou',
      // Nothing here merged it. It was already `MERGED` when we asked, which
      // means a person did it on github.com — worth telling apart from the
      // branch below, which is this app doing the merging.
      landed ? 'elsewhere' : undefined,
    )
    return
  }

  if (decision.action === 'stop') {
    await conclude(session, watch, 'stopped', decision.reason!)
    return
  }

  if (decision.action === 'land') {
    const result = await landPullRequest(cwd, watch.number)

    if (!result.ok) {
      await conclude(session, watch, 'stopped', `#${watch.number} is green but the merge was refused: ${result.message}`)
      return
    }

    await conclude(
      session,
      watch,
      'landed',
      `#${watch.number} passed CI and has been merged.`,
      'finished',
      'pull-request',
    )
    return
  }

  // A fix, which spends money with nobody watching — the case the daily limit
  // exists for. Skipped out loud rather than quietly not happening.
  const budget = await checkBudget(Date.now(), { unattended: true })
  if (!budget.allowed) {
    await conclude(session, watch, 'stopped', `#${watch.number} is failing CI, and there was no budget left to fix it: ${budget.reason}`)
    return
  }

  const attempts = watch.attempts + 1

  // Recorded before the turn is away, not after. If the process stops between
  // the two, an attempt that was paid for is an attempt that counts — the other
  // way round, a crash loop would fix the same commit forever.
  await patchSession(session.id, {
    prWatch: {
      ...watch,
      state: 'fixing',
      attempts,
      lastHandledSha: status.headSha,
      lastPolledAt: Date.now(),
      updatedAt: Date.now(),
    },
  })

  try {
    const fresh = await findSession(session.id)
    if (!fresh) return

    await startTurn(fresh, fixPrompt(status, attempts, watch.max), { repair: true })
    console.log(`[pr-watch] "${session.title}": attempt ${attempts}/${watch.max} on #${watch.number}`)
  } catch (e: any) {
    // The likely refusals are the session being busy or over budget. Either way
    // this attempt did not happen, so the watch stops rather than looking as
    // though something is still working on it.
    const current = await findSession(session.id)
    if (current?.prWatch?.state === 'fixing') {
      await conclude(
        current,
        current.prWatch,
        'stopped',
        e?.data?.message || 'Could not start a turn to fix the failing checks.',
      )
    }
  }
}

/**
 * Every session still watching a pull request, advanced one step.
 *
 * Called from the scheduler's event poll rather than on a timer of its own:
 * both ask GitHub the same kind of question at the same kind of interval, and
 * two pollers would be two things to reason about and twice the rate limit.
 */
export async function pollPullRequests(): Promise<void> {
  let sessions: Session[]

  try {
    sessions = (await readSessions()).filter(s => s.prWatch && ACTIVE.has(s.prWatch.state))
  } catch (e) {
    console.error('[pr-watch] could not read sessions', e)
    return
  }

  for (const session of sessions) {
    try {
      await advance(session)
    } catch (e) {
      console.error(`[pr-watch] "${session.title}" could not be advanced`, e)
    }
  }
}
