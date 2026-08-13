import { readSessions } from '../utils/sessions'
import { listPending } from '../utils/permissionBroker'
import { getActive, listRunsBySchedule, readRun, type RunSummary } from '../utils/runStore'
import { summarizeRitualRuns } from '../utils/ritualHistory'
import { readSchedules } from '../utils/schedules'

export type AttentionKind = 'blocked-session' | 'failing-ritual'

export interface AttentionItem {
  kind: AttentionKind
  /** Session id or schedule id, depending on kind. */
  id: string
  title: string
  /** Why it wants you, in one sentence. */
  because: string
  at?: number
}

/**
 * What, if anything, wants you.
 *
 * One small endpoint the whole app can poll, so the sidebar can say "one needs
 * you" rather than "six agents exist". Counting how much you own is not a
 * reason to look at a page; being blocked is.
 *
 * It returns the items and not only the tally, and that is the point. The Now
 * queue used to be assembled from `/api/digest`, which reports on a *window* —
 * so a ritual that broke before the window began was counted by this endpoint
 * and missing from the queue, and the sidebar said "3" over a screen that said
 * "nothing is waiting on you". A badge that contradicts the view it points at is
 * worse than no badge. Both now read one payload and cannot disagree.
 */
export default defineEventHandler(async () => {
  const [sessions, schedules, ritualRuns] = await Promise.all([
    readSessions().catch(() => []),
    readSchedules().catch(() => []),
    listRunsBySchedule(10).catch(() => ({} as Record<string, RunSummary[]>)),
  ])

  const items: AttentionItem[] = []
  let blocked = 0
  let working = 0

  for (const session of sessions) {
    if (session.status === 'archived') continue

    const lastRunId = session.runIds.at(-1)
    if (!lastRunId) continue

    if (listPending(lastRunId).length) {
      blocked++
      items.push({
        kind: 'blocked-session',
        id: session.id,
        title: session.title,
        because: 'It stopped to ask permission for something and is waiting.',
        at: session.updatedAt,
      })
      continue
    }

    const run = getActive(lastRunId)?.run ?? await readRun(lastRunId)
    if (run?.status === 'running' || run?.status === 'queued') working++
  }

  // A ritual that has come to nothing several times running is asking for
  // attention just as much as a prompt is — it is simply less loud about it.
  for (const schedule of schedules) {
    if (!schedule.enabled) continue

    const { failingStreak } = summarizeRitualRuns(ritualRuns[schedule.id] ?? [])
    if (failingStreak < 2) continue

    items.push({
      kind: 'failing-ritual',
      id: schedule.id,
      title: schedule.title,
      because: `Its last ${failingStreak} runs came to nothing.`,
      at: schedule.lastRunAt,
    })
  }

  const failingRituals = items.filter(item => item.kind === 'failing-ritual').length

  return {
    /** Sessions stopped on a permission prompt. */
    blocked,
    /** Sessions with a turn in flight. */
    working,
    failingRituals,
    /** Everything that will not move until you do something. */
    needsYou: blocked + failingRituals,
    /**
     * The same things, named. `needsYou` is `items.length` by construction —
     * kept as its own field because the sidebar and the tab title only ever
     * wanted the number.
     */
    items,
  }
})
