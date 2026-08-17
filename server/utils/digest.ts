import { runsSince } from './runStore'
import { readSessions, type Session } from './sessions'
import { readSchedules } from './schedules'
import { collapseChainRuns, outcomeOf, type RitualOutcome } from './ritualHistory'
import { listPending } from './permissionBroker'
import { spentSince } from './budget'
import { listMcpServers, ruleWontHelp, type McpServer } from './mcp'
import { describeSkipped, type SkippedSource } from './selfReported'
import { describeLanded } from './landed'

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
  /**
   * It was blocked, and the rules it needed have since been granted.
   *
   * Distinct from having nothing to suggest: this says the problem is already
   * solved, which is worth reading in a report about a morning that went wrong.
   */
  alreadyAllowed?: boolean
  /**
   * Refusals no rule can fix, each with the reason.
   *
   * The sibling of `alreadyAllowed`: both say the offer above is not the answer
   * here. This one is the more expensive case, because granting a rule for a
   * tool that does not exist for an unattended run *looks* like it worked and
   * costs another morning to find out otherwise.
   */
  unreachable?: { tool: string; reason: string }[]
  /**
   * Sources the run reported it could not read, in its own words.
   *
   * The third way a run comes back half-done, and the only one the harness
   * cannot see: nothing was denied and nothing was refused, so the outcome is
   * `ok` and the report used to say it went through without trouble. This
   * morning that sentence sat over a briefing that had been written without
   * Calendar, without Gmail, and with the Notion tasks table cut off mid-pull —
   * one of whose six ranked priorities came from Notion.
   */
  skipped?: SkippedSource[]
  /** The sentence that goes above them, built once here. */
  partial?: string
}

export interface DigestSession {
  id: string
  title: string
  /** One sentence about what it did, when a model wrote one. */
  summary?: string
  check?: 'passing' | 'failing' | 'errored' | 'running'
  behindBase: boolean
  /** Ready to look at, or waiting on you, or still going, or already in. */
  state: 'needs-you' | 'landed' | 'ready' | 'working' | 'nothing-yet'
  /**
   * How it got in, in words, when it did.
   *
   * The strongest line a report about last night can carry, and until landings
   * were recorded it could not be written at all: a merged session looked
   * exactly like one waiting to be read, so the best outcome this app has was
   * filed under "ready to look at".
   */
  landed?: string
}

export interface Digest {
  since: number
  /** Nothing at all happened — worth saying rather than showing empty lists. */
  quiet: boolean
  rituals: DigestRitual[]
  sessions: DigestSession[]
  /** Rituals the scheduler turned off in this window. */
  stopped: { id: string; title: string; reason: string }[]
  /**
   * Rituals whose turn came round while nothing was running.
   *
   * Its own list rather than an outcome on `rituals`, because those are runs
   * and this is the absence of one. Reported for exactly the reason the report
   * exists: a morning with no briefing in it and no explanation anywhere is
   * indistinguishable from the thing being broken.
   */
  missed: { id: string; title: string; dueAt: number }[]
  /**
   * Triggered rituals whose poll could not see back to where it had got to.
   *
   * The event equivalent of `missed`, and here for the same reason: something
   * happened that this was watching for, and it went by unseen. Separate from
   * `missed` because the answer is different — a missed occurrence comes round
   * again tomorrow, and these do not come round at all.
   */
  gaps: { id: string; title: string; at: number }[]
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
/**
 * Why an unattended run came back with the job half done.
 *
 * These arrive at the same door — `needsAttention` — and used to leave through
 * it wearing the same sentence, so a run that had used up its turns was
 * reported as having been refused a tool. That sends you looking for a
 * permission problem that was never there.
 */
/**
 * What is still worth offering to grant.
 *
 * A blocked run is a fact about a morning and stays in the record forever; the
 * permission it needed is not, because you can give it. Without taking the
 * difference, the report kept offering rules the ritual had already been
 * granted — you clicked "allow this from now on", it worked, said so, and the
 * same offer came back on the next page load, for good.
 */
export function stillNeeded(
  suggested: string[] | undefined,
  allowed: string[],
): string[] | undefined {
  if (!suggested?.length) return undefined

  const have = new Set(allowed)
  const missing = suggested.filter(rule => !have.has(rule))
  return missing.length ? missing : undefined
}

/**
 * The tool a permission rule is about. `Bash(gh issue edit:*)` → `Bash`.
 *
 * MCP rules carry no argument, so this is mostly a no-op for them — but the
 * suggestion list holds both kinds and a rule is not always a bare tool name.
 */
export function ruleTool(rule: string): string {
  const paren = rule.indexOf('(')
  return paren === -1 ? rule : rule.slice(0, paren)
}

/**
 * Split what was refused into what a rule would fix and what it would not.
 *
 * Pure, and separated from the fetching above it, because this is the judgement
 * — the same reason `verdictFor` is not computed in a page.
 */
export function splitUnreachable(
  suggested: string[] | undefined,
  denied: string[] | undefined,
  servers: McpServer[],
): { grantable?: string[]; unreachable?: { tool: string; reason: string }[] } {
  const unreachable: { tool: string; reason: string }[] = []

  // From what was *refused*, not from what was suggested: a tool can be denied
  // without a rule ever being proposed for it, and that is exactly the case
  // worth explaining rather than leaving as a silent nothing.
  for (const tool of new Set(denied ?? [])) {
    const reason = ruleWontHelp(tool, servers)
    if (reason) unreachable.push({ tool, reason })
  }

  const dead = new Set(unreachable.map(entry => entry.tool))
  const grantable = (suggested ?? []).filter(rule => !dead.has(ruleTool(rule)))

  return {
    grantable: grantable.length ? grantable : undefined,
    unreachable: unreachable.length ? unreachable : undefined,
  }
}

export function describeIncomplete(run: {
  stoppedBy?: 'budget' | 'turns'
  deniedTools?: string[]
  refusedHosts?: string[]
}): string {
  if (run.stoppedBy === 'turns') return 'It used up every turn it was allowed, so the job is half done.'
  if (run.stoppedBy === 'budget') return 'It reached the spending limit, so the job is half done.'

  // Named before the tool refusal, because it is the more actionable of the
  // two: the fix is a host to paste, and a run blocked on the sandbox usually
  // was not refused a tool at all.
  if (run.refusedHosts?.length && !run.deniedTools?.length) {
    return `Could not reach ${describeHosts(run.refusedHosts)}, so the job is half done.`
  }

  return `Refused ${describeDenied(run.deniedTools ?? [])}, so the job is half done.`
}

export function describeHosts(hosts: string[]): string {
  const names = [...new Set(hosts)]
  if (!names.length) return 'the network'
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

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
  /*
   * Ahead of the check verdict, deliberately.
   *
   * A landed session's verdict is about a workspace whose work is now in the
   * base branch, and a failing one does not mean "go and fix this" — it means
   * the branch that merged had a red suite, which is a fact about history. What
   * is not in question is that it is in, and that is the useful thing to say.
   */
  if (session.landed) return 'landed'
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
  const allowedBy = new Map(schedules.map(s => [s.id, new Set(s.allowRules ?? [])]))
  const dirFor = new Map(schedules.map(s => [s.id, s.projectDir]))

  function stillNeededFor(scheduleId: string, suggested: string[] | undefined): string[] | undefined {
    return stillNeeded(suggested, [...(allowedBy.get(scheduleId) ?? [])])
  }

  /*
   * Which MCP servers each blocked ritual could actually reach.
   *
   * Only for rituals that were refused a tool. `listMcpServers` spawns a health
   * check against every server, and a morning where nothing went wrong must not
   * pay for one — most mornings are that morning. Cached per directory anyway,
   * so several rituals in one project ask once.
   *
   * Failure is silently no servers, which makes `ruleWontHelp` return null for
   * everything and leaves the offer exactly as it was. A digest that could not
   * reach the CLI should be a digest without this note, not a missing digest.
   */
  const blockedDirs = new Set(
    runs
      .filter(run => run.scheduleId && run.deniedTools?.length && outcomeOf(run) === 'blocked')
      .map(run => dirFor.get(run.scheduleId!))
      .filter((dir): dir is string => Boolean(dir)),
  )

  const serversByDir = new Map<string, McpServer[]>()
  await Promise.all([...blockedDirs].map(async (dir) => {
    serversByDir.set(dir, await listMcpServers(dir).catch(() => []))
  }))

  function serversFor(scheduleId: string): McpServer[] {
    const dir = dirFor.get(scheduleId)
    return (dir && serversByDir.get(dir)) || []
  }

  // Scheduled work only. A session turn is somebody typing, which is not news
  // in the morning; a ritual firing at 08:00 is the entire point.
  //
  // Collapsed first, so a chained ritual is one line about the morning rather
  // than one per step. Being three things to read was half of what chains were
  // built to fix — the other half is the failing streak, which uses the same
  // collapse.
  const rituals: DigestRitual[] = collapseChainRuns(runs.filter(run => run.scheduleId))
    .map((run) => {
      const outcome = outcomeOf(run)

      // Sorted out before the offer is built, because it decides what is worth
      // offering: a rule for a tool the run could never reach is a button that
      // does nothing and reads as the fix.
      const split = outcome === 'blocked' && !run.stoppedBy
        ? splitUnreachable(run.suggestedRules, run.deniedTools, serversFor(run.scheduleId!))
        : {}

      return {
        scheduleId: run.scheduleId!,
        title: titleFor.get(run.scheduleId!) ?? run.title,
        outcome,
        at: run.createdAt,
        costUsd: run.costUsd,
        preview: run.preview,
        // Nothing to grant when nothing was refused, so the "always allow"
        // offer stays off a run that simply ran out of room — and nothing to
        // grant twice, so it comes off once the rules have been given.
        suggestedRules: outcome === 'blocked' && !run.stoppedBy
          ? stillNeededFor(run.scheduleId!, split.grantable)
          : undefined,
        unreachable: split.unreachable,
        // Reported whatever the outcome. A blocked run that also lost a
        // connector has two things wrong with it, and the one the harness saw
        // is not necessarily the one that spoiled the answer.
        skipped: run.skipped,
        partial: run.skipped?.length ? describeSkipped(run.skipped) : undefined,
        /** Already granted since this run was blocked, so it will not recur. */
        alreadyAllowed: outcome === 'blocked'
          && !run.stoppedBy
          && Boolean(run.suggestedRules?.length)
          && !stillNeededFor(run.scheduleId!, run.suggestedRules),
        problem: outcome === 'failed'
          ? run.error || 'It ended early.'
          : outcome === 'blocked'
            ? describeIncomplete(run)
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
      landed: session.landed ? describeLanded(session.landed) : undefined,
    })
  }

  const stopped = schedules
    .filter(s => s.pausedReason && (s.pausedAt ?? 0) >= since)
    .map(s => ({ id: s.id, title: s.title, reason: s.pausedReason! }))

  // Keyed on when it was noticed rather than on when it was due: a laptop shut
  // for a week comes back with an occurrence days old, and reporting it against
  // its due time would put it outside the window and say nothing at all.
  const missed = schedules
    .filter(s => s.missedAt && (s.missedNoticedAt ?? 0) >= since)
    .map(s => ({ id: s.id, title: s.title, dueAt: s.missedAt! }))

  const gaps = schedules
    .filter(s => s.eventGapAt && s.eventGapAt >= since)
    .map(s => ({ id: s.id, title: s.title, at: s.eventGapAt! }))

  // Deliberately not counted in `needsYou`. Nothing is blocked and there is
  // nothing to approve — the machine was off. It is worth reading, not worth
  // a number that means "go and do something".
  //
  // A partial run is out for the same reason and it is a closer call, because
  // one of its sources may well be worth chasing. But most of them are not:
  // Calendar and Gmail are connector-only for an unattended run and will skip
  // every morning for good, and a badge that is permanently at 2 is a badge
  // nobody reads. It is shown, in its own words, and not counted.
  const needsYou = digestSessions.filter(s => s.state === 'needs-you').length
    + rituals.filter(r => r.problem).length
    + stopped.length

  return {
    since,
    quiet: !rituals.length && !digestSessions.length && !stopped.length && !missed.length
      && !gaps.length,
    rituals,
    sessions: digestSessions,
    stopped,
    missed,
    gaps,
    costUsd,
    needsYou,
  }
}
