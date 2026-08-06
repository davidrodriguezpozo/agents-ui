import { runsSince } from './runStore'
import { readSessions, type Session } from './sessions'
import { readSchedules } from './schedules'
import { outcomeOf, type RitualOutcome } from './ritualHistory'
import { listPending } from './permissionBroker'
import { spentSince } from './budget'

/**
 * What happened while you were away.
 *
 * The product's claim is that you can leave it running and come back to what it
 * did. Every part of that answer existed — ritual outcomes, session verdicts,
 * the spend page, the blocked count — in five different places, none of which
 * is the one you open in the morning. Assembling it is the whole feature.
 *
 * Deliberately not a fifth list of everything. Three questions, in the order a
 * person asks them: did anything go wrong, what came out of it, what did it
 * cost.
 */

export interface DigestRitual {
  scheduleId: string
  title: string
  outcome: RitualOutcome
  at: number
  costUsd?: number
  preview: string
  /** Why it is worth your attention, when it is. */
  problem?: string
  /**
   * The narrow rules that would have let it through, gathered from the prompts
   * it was refused. Granting these is the fix, and it is one click from here
   * rather than a trip to the ritual and back.
   */
  suggestedRules?: string[]
}

export interface DigestSession {
  id: string
  title: string
  /** One sentence about what it did, when a model wrote one. */
  summary?: string
  check?: 'passing' | 'failing' | 'errored' | 'running'
  behindBase: boolean
  /** Ready to look at, or waiting on you, or still going. */
  state: 'needs-you' | 'ready' | 'working' | 'nothing-yet'
}

export interface Digest {
  since: number
  /** Nothing at all happened — worth saying rather than showing empty lists. */
  quiet: boolean
  rituals: DigestRitual[]
  sessions: DigestSession[]
  /** Rituals the scheduler turned off in this window. */
  stopped: { id: string; title: string; reason: string }[]
  costUsd: number
  needsYou: number
}

/** A day is the window that matters — the pitch is about overnight. */
export const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * What a refused tool is called, for somebody reading a sentence.
 *
 * An MCP tool's real name is `mcp__claude_ai_Linear__list_issues`, which is an
 * identifier rather than a word. Four of those in a row is not a sentence, and
 * the useful part — which service was refused — is in the middle.
 */
export function toolLabel(name: string): string {
  const mcp = name.match(/^mcp__(.+?)__/)
  if (!mcp?.[1]) return name

  // `claude_ai_Linear` → `Linear`; `notion` → `notion`.
  return mcp[1].replace(/^claude_ai_/, '').replace(/_/g, ' ')
}

/** Names enough of them to be useful, then stops. */
export function describeDenied(tools: string[]): string {
  const names = [...new Set(tools.map(toolLabel))]
  if (!names.length) return 'a tool'
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

/**
 * Read off the session record alone — no git here, so this stays cheap enough
 * to run over every session that moved. `errored` counts as needing you for a
 * different reason from `failing`: not "the code is broken" but "nobody can
 * tell", which is its own thing to go and look at.
 */
function sessionState(session: Session, blocked: boolean, working: boolean): DigestSession['state'] {
  if (blocked) return 'needs-you'
  if (working) return 'working'
  if (session.check?.status === 'failing' || session.check?.status === 'errored') return 'needs-you'
  if (session.check?.status === 'passing') return 'ready'
  // No verdict, but it wrote a sentence about what it did — which it only does
  // after a turn that changed files.
  return session.summary ? 'ready' : 'nothing-yet'
}

/**
 * Assemble it. Never throws — this is the first thing the morning shows, and a
 * page that errors because one of five sources was unreadable is worse than one
 * that is honest about a gap.
 */
export async function buildDigest(since: number): Promise<Digest> {
  const [runs, sessions, schedules, costUsd] = await Promise.all([
    runsSince(since).catch(() => []),
    readSessions().catch(() => []),
    readSchedules().catch(() => []),
    spentSince(since).catch(() => 0),
  ])

  const titleFor = new Map(schedules.map(s => [s.id, s.title]))

  // Scheduled work only. A session turn is somebody typing, which is not news
  // in the morning; a ritual firing at 08:00 is the entire point.
  const rituals: DigestRitual[] = runs
    .filter(run => run.scheduleId)
    .map((run) => {
      const outcome = outcomeOf(run)
      return {
        scheduleId: run.scheduleId!,
        title: titleFor.get(run.scheduleId!) ?? run.title,
        outcome,
        at: run.createdAt,
        costUsd: run.costUsd,
        preview: run.preview,
        suggestedRules: outcome === 'blocked' ? run.suggestedRules : undefined,
        problem: outcome === 'failed'
          ? run.error || 'It ended early.'
          : outcome === 'blocked'
            ? `Refused ${describeDenied(run.deniedTools ?? [])}, so the job is half done.`
            : undefined,
      }
    })
    .sort((a, b) => b.at - a.at)

  const digestSessions: DigestSession[] = []
  for (const session of sessions) {
    if (session.status === 'archived') continue
    if (session.updatedAt < since) continue

    const lastRunId = session.runIds.at(-1)
    const blocked = lastRunId ? listPending(lastRunId).length > 0 : false

    digestSessions.push({
      id: session.id,
      title: session.title,
      summary: session.summary?.text,
      check: session.check?.status,
      // Filled by the endpoint, which is the layer that knows about git.
      behindBase: false,
      state: sessionState(session, blocked, session.status === 'running'),
    })
  }

  const stopped = schedules
    .filter(s => s.pausedReason && (s.pausedAt ?? 0) >= since)
    .map(s => ({ id: s.id, title: s.title, reason: s.pausedReason! }))

  const needsYou = digestSessions.filter(s => s.state === 'needs-you').length
    + rituals.filter(r => r.problem).length
    + stopped.length

  return {
    since,
    quiet: !rituals.length && !digestSessions.length && !stopped.length,
    rituals,
    sessions: digestSessions,
    stopped,
    costUsd,
    needsYou,
  }
}
