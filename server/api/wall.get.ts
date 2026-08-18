import { basename } from 'node:path'
import { readSessions, type Session } from '../utils/sessions'
import { getActive, readRun, runsSince, type Run } from '../utils/runStore'
import { listPending } from '../utils/permissionBroker'
import { latestStep, recentSteps } from '../utils/turnActivity'
import { spentSince, startOfToday } from '../utils/budget'
import { readPreferences } from '../utils/preferences'
import { describeWindow, isStale, readQuota, resetsAtMs } from '../utils/quota'
import { readSchedules } from '../utils/schedules'
import { mapLimit } from '../utils/pool'
import { SETTLED_WINDOW_MS, type WallSnapshot, type WallTick, type WallTile } from '~/utils/wall'

/**
 * One poll for a screen that is never looked away from.
 *
 * The wall is left running on a second monitor, so this is the most-called
 * endpoint in the app by a wide margin — and the only one whose caller is not a
 * person who might get bored and navigate away. That makes cost the design
 * constraint rather than an afterthought.
 *
 * **Nothing here spawns git.** `/api/sessions` answers a richer question and
 * pays for it: worktree state, commits ahead, files changed, one process per
 * session per poll, which is why it has a concurrency pool and a caching layer
 * of its own. A wall does not need any of that — it needs to know what is
 * happening *now*, and everything that says so is either a field on the session
 * record or already in memory.
 *
 * **Run files are read only when they might matter.** A run's JSON carries its
 * whole event log, so reading one per session per poll would be several
 * megabytes a second to discover that nineteen sessions are still idle. So the
 * free signals decide first — is the run still in memory, is a permission
 * prompt pending, does the record already say the checks failed — and only what
 * survives that gets read from disk.
 *
 * What it deliberately does not carry: anything that would need a model, and
 * anything from outside this machine. The inbox and reviews are somebody else's
 * poll budget, and neither belongs on a wall whose whole claim is immediacy.
 */

/** Enough to keep the disk busy, few enough to leave the server responsive. */
const AT_ONCE = 8

/**
 * How long the expensive half of this answer is allowed to stand.
 *
 * Everything above is free or nearly so. The money is not: `spentSince` reads
 * *every run file on disk*, each carrying its own event log, and so does the
 * count of what ran in the last day. At a two-and-a-half second poll that is the
 * whole run log read twenty-four times a minute, for a figure that changes when
 * a run finishes — which is minutes apart at best.
 *
 * So it is computed at most twice a minute and held. A wall showing a spend
 * total that is twenty seconds old is not wrong in any way anybody could act on;
 * a wall that keeps the disk busy all afternoon to avoid that is.
 */
const MONEY_TTL_MS = 30_000

/** A day, matching the window the night-shift chart draws by default. */
const NIGHT_WINDOW_MS = 24 * 3_600_000

interface Money {
  at: number
  todayUsd: number
  /** Runs in the last day — whether the night has anything in it to draw. */
  runsLastDay: number
}

/**
 * Process-global, like the rest of this app's state: single local user, one
 * server. Keyed by nothing because there is only ever one machine's worth of
 * runs to count.
 */
let money: Money | null = null

async function readMoney(now: number, dayStart: number): Promise<Money> {
  if (money && now - money.at < MONEY_TTL_MS) return money

  const [todayUsd, lastDay] = await Promise.all([
    // Read the way the daily cap is enforced rather than re-derived here, so the
    // meter and the thing that actually skips work cannot disagree.
    spentSince(dayStart),
    runsSince(now - NIGHT_WINDOW_MS),
  ])

  money = { at: now, todayUsd, runsLastDay: lastDay.length }
  return money
}

/** Tool calls across the whole fleet, newest first. Longer than any tile shows. */
const TICKER_MAX = 14

/**
 * Whether this session could possibly be part of *now*, decided without
 * touching the disk.
 *
 * Every test here is a field already in hand or a map already in memory. It
 * errs towards yes — a session let through only costs one file read, while one
 * wrongly excluded is missing from the wall, and those are not the same size of
 * mistake.
 */
function mightBeCurrent(session: Session, lastRunId: string | undefined, now: number): boolean {
  if (session.status === 'running') return true
  if (lastRunId && getActive(lastRunId)) return true
  if (lastRunId && listPending(lastRunId).length) return true
  if (session.check?.status === 'failing' || session.check?.status === 'running') return true
  if (session.repair?.state === 'running') return true
  if (session.landed && session.landed.at >= startOfToday(now)) return true
  return now - session.updatedAt < SETTLED_WINDOW_MS
}

export default defineEventHandler(async (): Promise<WallSnapshot> => {
  const now = Date.now()
  const dayStart = startOfToday(now)

  const [sessions, preferences, quota, schedules, spent] = await Promise.all([
    readSessions().catch(() => [] as Session[]),
    readPreferences(),
    readQuota().catch(() => null),
    readSchedules().catch(() => []),
    readMoney(now, dayStart),
  ])

  const live = sessions.filter(session => session.status !== 'archived')

  const candidates = live
    .map(session => ({ session, lastRunId: session.runIds.at(-1) }))
    .filter(({ session, lastRunId }) => mightBeCurrent(session, lastRunId, now))

  /**
   * The run each candidate is on. In memory for anything still going, which is
   * every session the wall is really about; off disk only for the rest, and
   * that read is what the filter above exists to keep small.
   */
  const runs = await mapLimit(candidates, AT_ONCE, async ({ lastRunId }) => {
    if (!lastRunId) return { run: null as Run | null, pending: 0, fromMemory: false }

    const activeRun = getActive(lastRunId)?.run ?? null
    const run = activeRun ?? await readRun(lastRunId)

    return { run, pending: listPending(lastRunId).length, fromMemory: Boolean(activeRun) }
  })

  const tiles: WallTile[] = []
  const ticker: WallTick[] = []

  candidates.forEach(({ session }, index) => {
    const { run, pending } = runs[index]!
    const repo = basename(session.repoDir) || session.repoDir
    const working = run?.status === 'running' || run?.status === 'queued'

    // The same order `/api/sessions` decides activity in, so a tile and a row
    // never disagree about one session.
    let activity: WallTile['activity'] = 'idle'
    if (session.worktreeRemovedAt) activity = 'missing'
    else if (pending) activity = 'awaiting-permission'
    else if (working) activity = 'working'
    else if (run?.status === 'failed') activity = 'failed'

    tiles.push({
      sessionId: session.id,
      title: session.title,
      repo,
      branch: session.branch,
      activity,
      check: session.check ? { status: session.check.status, at: session.check.at } : null,
      landedAt: session.landed?.at,
      landedHow: session.landed?.how,
      turns: session.runIds.length,
      updatedAt: session.updatedAt,
      // Only while something is in flight: an elapsed clock on a finished turn
      // counts up forever and reads as work that is stuck.
      startedAt: working ? run?.startedAt ?? run?.createdAt : undefined,
      pending,
      // Only while it is live: a run id on a finished turn is a cancel button
      // for something that has already stopped.
      runId: working ? run?.id : undefined,
      doing: working ? latestStep(run?.events) : null,
      prUrl: session.prUrl,
      repairing: session.repair?.state === 'running',
    })

    // Only live runs feed the ticker. A finished run's last few calls are
    // history, and history scrolling past as though it were happening is the
    // one thing a live feed must not do.
    if (!working) return

    for (const call of recentSteps(run?.events, TICKER_MAX)) {
      ticker.push({ sessionId: session.id, repo, ...call })
    }
  })

  ticker.sort((a, b) => b.at - a.at)

  const landedToday = live
    .filter(session => session.landed && session.landed.at >= dayStart)
    .map(session => ({
      sessionId: session.id,
      title: session.summary?.text || session.title,
      repo: basename(session.repoDir) || session.repoDir,
      how: session.landed!.how,
      at: session.landed!.at,
    }))
    .sort((a, b) => b.at - a.at)

  /**
   * The next thing due on the clock. Triggered rituals are left out: they carry
   * a recurrence so that removing the trigger leaves something behind, but the
   * time on it is not when they will fire, and counting down to it would be a
   * countdown to nothing.
   */
  const nextRitual = schedules
    .filter(schedule => schedule.enabled && !schedule.trigger && schedule.nextRunAt && schedule.nextRunAt > now)
    .sort((a, b) => a.nextRunAt! - b.nextRunAt!)
    .map(schedule => ({
      id: schedule.id,
      title: schedule.title,
      at: schedule.nextRunAt!,
      repo: schedule.projectDir ? basename(schedule.projectDir) : undefined,
    }))[0] ?? null

  return {
    at: now,
    // Uncapped on purpose — see `WallSnapshot.tiles`. The page cuts it to what
    // fits and says how many it left out.
    tiles,
    ticker: ticker.slice(0, TICKER_MAX),
    landedToday,
    // The cap is read fresh — it is one small file, and a limit somebody has
    // just set should not take half a minute to appear on the screen.
    spend: { todayUsd: spent.todayUsd, capUsd: preferences.dailyCapUsd },
    runsLastDay: spent.runsLastDay,
    quota: quota
      ? {
          status: quota.status,
          window: describeWindow(quota.rateLimitType),
          utilization: quota.utilization ?? null,
          resetsAt: resetsAtMs(quota) ?? null,
          stale: isStale(quota, now),
        }
      : null,
    nextRitual,
    pausedRituals: schedules.filter(schedule => !schedule.enabled && schedule.pausedReason).length,
  }
})
