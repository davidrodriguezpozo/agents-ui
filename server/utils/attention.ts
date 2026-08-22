import { readSessions } from './sessions'
import { listPending } from './permissionBroker'
import { getActive, listRunsBySchedule, readRun, type RunSummary } from './runStore'
import { summarizeRitualRuns } from './ritualHistory'
import { readSchedules } from './schedules'

/**
 * What, if anything, wants a person.
 *
 * This was the body of `api/attention.get.ts` and nothing else asked for it, so
 * it lived there. Then the MCP server needed the same answer — `blocked` is the
 * one question an agent asks this app before it does anything — and the choice
 * was to write the derivation twice or to move it here.
 *
 * Twice would have been wrong for the same reason the endpoint exists at all.
 * The sidebar badge and the Now queue were once assembled from two different
 * sources, and the pair disagreed: the badge said "3" over a screen that said
 * nothing was waiting. A badge that contradicts the view it points at is worse
 * than no badge, and a tool that contradicts the sidebar is worse than no tool —
 * a run told nothing is blocked stops looking. One derivation, one answer.
 *
 * Never reaches the network and never throws: every read is caught, because a
 * poll every eight seconds and an agent's first question are both the wrong
 * places to surface an unreadable schedules file.
 */

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

export interface Attention {
  /** Sessions stopped on a permission prompt. */
  blocked: number
  /** Sessions with a turn in flight. */
  working: number
  failingRituals: number
  /** Everything that will not move until you do something. */
  needsYou: number
  /**
   * The same things, named. `needsYou` is `items.length` by construction —
   * kept as its own field because the sidebar and the tab title only ever
   * wanted the number.
   */
  items: AttentionItem[]
}

/** How many failed turns in a row before a ritual is asking for you. */
const FAILING_STREAK = 2

export async function collectAttention(): Promise<Attention> {
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
    if (failingStreak < FAILING_STREAK) continue

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
    blocked,
    working,
    failingRituals,
    needsYou: blocked + failingRituals,
    items,
  }
}
