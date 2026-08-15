import { listMcpServers, ruleWontHelp } from './mcp'
import { ruleTool } from './digest'
import type { Schedule } from './schedules'

export interface DeadRule {
  rule: string
  reason: string
}

/**
 * Granted rules that cannot do anything, per ritual.
 *
 * A permission chip says "allowed" whether or not the tool behind it exists for
 * an unattended run, so eight granted rules can be four real ones and four that
 * will be refused every morning forever. The refusal produces a fresh offer to
 * grant, which is granted, which changes nothing — a loop that costs a morning
 * per turn and ends with `GIVE_UP_AFTER` switching the ritual off.
 *
 * **Only rituals holding an MCP rule are worth asking about.** `listMcpServers`
 * spawns a health check against every server, and this runs on a page people
 * leave open. Most rituals allow `Bash(gh …)` and nothing else, and those need
 * no lookup at all — so the common case costs one filter and no process.
 */
export async function deadRulesFor(schedules: Schedule[]): Promise<Map<string, DeadRule[]>> {
  const out = new Map<string, DeadRule[]>()

  const withMcpRules = schedules.filter(
    s => s.allowRules?.some(rule => ruleTool(rule).startsWith('mcp__')),
  )
  if (!withMcpRules.length) return out

  // One read per directory rather than per ritual — several rituals in a
  // project ask the same question and the answer is cached anyway.
  const dirs = new Set(
    withMcpRules.map(s => s.projectDir).filter((dir): dir is string => Boolean(dir)),
  )

  const serversByDir = new Map<string, Awaited<ReturnType<typeof listMcpServers>>>()
  await Promise.all([...dirs].map(async (dir) => {
    // A directory that will not answer contributes an empty list, which
    // `ruleWontHelp` treats as "no opinion" rather than as "nothing is
    // configured". A page that cannot reach the CLI should show no warnings,
    // never every rule condemned at once.
    serversByDir.set(dir, await listMcpServers(dir).catch(() => []))
  }))

  for (const schedule of withMcpRules) {
    const servers = (schedule.projectDir && serversByDir.get(schedule.projectDir)) || []
    if (!servers.length) continue

    const dead: DeadRule[] = []
    for (const rule of schedule.allowRules ?? []) {
      const reason = ruleWontHelp(ruleTool(rule), servers)
      if (reason) dead.push({ rule, reason })
    }

    if (dead.length) out.set(schedule.id, dead)
  }

  return out
}
