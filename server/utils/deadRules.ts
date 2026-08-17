import { listMcpServers, ruleWontHelp, type McpServer } from './mcp'
import { ruleTool } from './digest'
import type { Schedule } from './schedules'

export interface DeadRule {
  rule: string
  reason: string
}

/**
 * Granted rules that cannot do anything.
 *
 * A permission chip says "allowed" whether or not the tool behind it exists for
 * an unattended run, so eight granted rules can be four real ones and four that
 * will be refused every morning forever. The refusal produces a fresh offer to
 * grant, which is granted, which changes nothing — a loop that costs a morning
 * per turn and ends with `GIVE_UP_AFTER` switching the ritual off.
 *
 * Pure, and the only place the judgement is made. Rituals and projects both hold
 * permission rules and both draw them as chips; two implementations of "is this
 * one real" is how one screen starts disagreeing with another.
 */
export function deadRulesIn(rules: string[], servers: McpServer[]): DeadRule[] {
  // No servers means the list could not be read, which `ruleWontHelp` already
  // treats as no opinion — but returning early keeps that explicit at the one
  // place a caller might otherwise be tempted to interpret it.
  if (!servers.length) return []

  const dead: DeadRule[] = []
  for (const rule of rules) {
    const reason = ruleWontHelp(ruleTool(rule), servers)
    if (reason) dead.push({ rule, reason })
  }
  return dead
}

/** Whether asking about a set of rules could tell us anything. */
function hasMcpRule(rules: string[] | undefined): boolean {
  return Boolean(rules?.some(rule => ruleTool(rule).startsWith('mcp__')))
}

/**
 * The dead rules granted in one project directory.
 *
 * **Nothing is asked when nothing could be dead.** `listMcpServers` spawns a
 * health check against every server, and this is reached from a session page
 * people leave open on a poll. Most grants are `Bash(…)` and need no lookup at
 * all, so the common case costs one filter and no process.
 */
export async function deadRulesForDir(
  dir: string | undefined,
  rules: string[],
): Promise<DeadRule[]> {
  if (!dir || !hasMcpRule(rules)) return []

  // A directory that will not answer contributes an empty list, which means no
  // opinion rather than "nothing is configured". A page that cannot reach the
  // CLI should show no warnings, never every rule condemned at once.
  const servers = await listMcpServers(dir).catch(() => [])
  return deadRulesIn(rules, servers)
}

/**
 * The same question for every ritual, in as few reads as possible.
 *
 * One read per directory rather than per ritual — several rituals in a project
 * ask the same question and the answer is cached anyway.
 */
export async function deadRulesFor(schedules: Schedule[]): Promise<Map<string, DeadRule[]>> {
  const out = new Map<string, DeadRule[]>()

  const withMcpRules = schedules.filter(s => hasMcpRule(s.allowRules))
  if (!withMcpRules.length) return out

  const dirs = new Set(
    withMcpRules.map(s => s.projectDir).filter((dir): dir is string => Boolean(dir)),
  )

  const serversByDir = new Map<string, McpServer[]>()
  await Promise.all([...dirs].map(async (dir) => {
    serversByDir.set(dir, await listMcpServers(dir).catch(() => []))
  }))

  for (const schedule of withMcpRules) {
    const servers = (schedule.projectDir && serversByDir.get(schedule.projectDir)) || []
    const dead = deadRulesIn(schedule.allowRules ?? [], servers)
    if (dead.length) out.set(schedule.id, dead)
  }

  return out
}
