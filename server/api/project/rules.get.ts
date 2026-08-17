import { getProjectDir } from '../../utils/scope'
import { rulesForProject } from '../../utils/projectRules'
import { deadRulesForDir } from '../../utils/deadRules'

export default defineEventHandler(async (event) => {
  const dir = (getQuery(event).dir as string) || getProjectDir(event)
  const rules = await rulesForProject(dir ?? undefined)

  /*
   * Which of these cannot do anything, for the same reason a ritual's cannot.
   *
   * A project grant is what a session turn runs with, and a session turn is
   * unattended in every way that matters here — so a rule for a tool that only
   * an interactive session can reach is as dead here as it is on a ritual, and
   * looked exactly as allowed.
   *
   * Costs nothing when there is nothing to ask about: a project whose grants are
   * all `Bash(…)` never reaches the MCP lookup.
   */
  return { dir: dir ?? null, rules, deadRules: await deadRulesForDir(dir ?? undefined, rules) }
})
