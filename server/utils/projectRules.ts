import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'
import { mergeRules } from './permissionRules'

/**
 * Permissions a project has been granted permanently.
 *
 * Rituals learned this trick already: after being blocked on `Bash(gh:*)` once,
 * a ritual can be granted exactly that and stop asking. Sessions never learned
 * anything — every session started from defaults and asked again for approvals
 * given a dozen times before.
 *
 * Kept per repository rather than per session, because that is the unit the
 * answer belongs to: "running the test suite here is fine" is true of the
 * project, not of one conversation that happened to need it.
 *
 * Deliberately *not* written into the project's own `.claude/settings.json`.
 * That file is usually tracked, so granting yourself a permission would become
 * a commit, and one person's convenience would silently become the team's
 * policy.
 */

export type ProjectRules = Record<string, string[]>

export const projectRulesStore = defineJsonStore<ProjectRules>({
  label: 'project permissions',
  path: () => join(getClaudeDir(), 'agents-ui', 'project-rules.json'),
  empty: () => ({}),
  decode: parsed => parsed?.projects ?? {},
  encode: projects => ({ version: 1, projects }),
})

/** Never fails a run: an unreadable allowlist means asking, not stopping. */
export async function rulesForProject(dir: string | undefined): Promise<string[]> {
  if (!dir) return []
  try {
    return (await projectRulesStore.read())[dir] ?? []
  } catch {
    return []
  }
}

export async function allowInProject(dir: string, rules: string[]): Promise<string[]> {
  return projectRulesStore.update((projects) => {
    const merged = mergeRules(projects[dir] ?? [], rules)
    projects[dir] = merged
    return merged
  })
}

export async function revokeInProject(dir: string, rule: string): Promise<string[]> {
  return projectRulesStore.update((projects) => {
    const remaining = (projects[dir] ?? []).filter(existing => existing !== rule)

    // Drop the key entirely rather than leave an empty list behind, so the file
    // stays a list of projects that actually have grants.
    if (remaining.length) projects[dir] = remaining
    else delete projects[dir]

    return remaining
  })
}
