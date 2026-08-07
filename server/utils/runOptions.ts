import { existsSync } from 'node:fs'
import type { H3Event } from 'h3'
import { getClaudeDir } from './claudeDir'
import { getProjectDir, getScopeRoots, scopeRootsFor } from './scope'
import { resolveAgentInRoots, toSdkModel, type ResolvedAgent } from './resolveAgent'
import { readInstalledPlugins } from './pluginScan'
import { resolveEnabledPluginsInRoots } from './pluginState'
import { toSettingsPermissions } from './permissionRules'
import { readPreferences } from './preferences'
import type { PermissionMode } from '~/types'

export const DEFAULT_MAX_TURNS = 40

export interface RunRequest {
  agentSlug?: string
  projectDir?: string
  systemPromptOverride?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  permissionMode?: PermissionMode
  maxTurns?: number
  loadProjectSettings?: boolean
  model?: string
  /** Permanent permission rules, e.g. `Bash(gh:*)`. */
  allowRules?: string[]
  /** Readable alongside `cwd` — see `Project.contextDir`. */
  additionalDirectories?: string[]
}

export interface ResolvedRunOptions {
  cwd: string
  allowedTools?: string[]
  disallowedTools?: string[]
  permissionMode: PermissionMode
  maxTurns: number
  model?: string
  loadSettings: boolean
  plugins: { type: 'local'; path: string }[]
  systemAppend: string
  agent: ResolvedAgent | null
  allowRules: string[]
  additionalDirectories: string[]
}

export function managerPrompt(claudeDir: string): string {
  return `You are an assistant integrated into the Agent Manager UI. The user is managing their Claude Code agents, commands, skills, and plugins through a web interface.

The user's global Claude configuration folder is: ${claudeDir}

## File structure

- **Agents**: Markdown files in \`agents/\` with YAML frontmatter (name, description, model, color, tools)
- **Commands**: Markdown files in \`commands/\` (can be in subdirectories) with YAML frontmatter (name, description, argument-hint, allowed-tools)
- **Skills**: Each skill is a directory at \`skills/<name>/SKILL.md\` with YAML frontmatter (name, description)
- **Settings**: \`settings.json\`

These exist at two levels: globally in \`${claudeDir}\`, and per-project in \`<project>/.claude/\`. Project-level definitions apply only inside that project and take precedence.

## Rules

- Always confirm what you did after making changes.
- For destructive operations (delete, overwrite), list exactly what will be affected and ask for confirmation.
- Be explicit about whether you are writing to the global folder or a project folder.
- Keep the user informed of progress during multi-step operations.`
}

/**
 * Resolve everything a run needs while the request context is still available.
 * The result is a plain object, so a detached run can outlive the request that
 * created it.
 */
export async function resolveRunOptions(event: H3Event, body: RunRequest): Promise<ResolvedRunOptions> {
  const projectDir = (body.projectDir && existsSync(body.projectDir) ? body.projectDir : null)
    ?? getProjectDir(event)
  return resolveRunOptionsFor({ ...body, projectDir: projectDir ?? undefined })
}

/**
 * Request-free variant. The scheduler runs long after any request has gone, so
 * everything it needs comes from the schedule record itself.
 */
export async function resolveRunOptionsFor(body: RunRequest): Promise<ResolvedRunOptions> {
  const claudeDir = getClaudeDir()
  // 0 means "no preference", which must fall through to the default rather
  // than being read as a limit of zero turns.
  const preferredTurns = (await readPreferences()).maxTurns || undefined
  const projectDir = body.projectDir && existsSync(body.projectDir) ? body.projectDir : null
  const roots = scopeRootsFor(projectDir)

  const agent = body.agentSlug ? await resolveAgentInRoots(roots, body.agentSlug) : null

  let systemAppend: string
  if (body.systemPromptOverride?.trim()) {
    systemAppend = body.systemPromptOverride
  } else if (agent) {
    systemAppend = `You are "${agent.name}", a specialized agent.${
      agent.description ? `\n\nYou are used when: ${agent.description}` : ''
    }\n\nFollow these instructions precisely:\n\n${agent.prompt}`
  } else {
    systemAppend = managerPrompt(claudeDir)
  }

  // Explicit request wins, then the agent's own `tools:` frontmatter, then
  // undefined — which lets the CLI offer its full tool set.
  const allowedTools = body.allowedTools?.length
    ? body.allowedTools
    : agent?.tools?.length
      ? agent.tools
      : undefined

  // Without these the SDK cannot resolve plugin slash commands, skills or
  // subagents — they'd be visible in the UI but unusable in a run.
  const [installed, isEnabled] = await Promise.all([
    readInstalledPlugins(roots[0]!.dir),
    resolveEnabledPluginsInRoots(roots),
  ])
  const plugins = installed
    .filter(p => isEnabled(p.id) && existsSync(p.entry.installPath))
    .map(p => ({ type: 'local' as const, path: p.entry.installPath }))

  return {
    cwd: projectDir || claudeDir,
    allowedTools,
    disallowedTools: body.disallowedTools?.length ? body.disallowedTools : undefined,
    permissionMode: body.permissionMode ?? 'acceptEdits',
    // An explicit request wins; then whatever this machine was set to; then
    // the built-in. Sessions, rituals and workflows all pass nothing, which is
    // why the preference has to be consulted here rather than at each caller.
    maxTurns: Math.max(1, Math.min(body.maxTurns ?? preferredTurns ?? DEFAULT_MAX_TURNS, 200)),
    model: toSdkModel(body.model || agent?.model),
    loadSettings: body.loadProjectSettings !== false,
    plugins,
    systemAppend,
    agent,
    allowRules: body.allowRules ?? [],
    additionalDirectories: (body.additionalDirectories ?? []).filter(dir => dir && dir !== (projectDir || claudeDir)),
  }
}

/**
 * Shape the resolved options into the SDK's `query` options object.
 *
 * `maxBudgetUsd` is the one limit that can stop a run part-way through. Ours
 * are all checked before a run starts, which cannot help once a single run
 * goes wrong — so this is handed straight to the SDK, which stops the query
 * itself and reports `error_max_budget_usd`.
 */
export function toQueryOptions(
  options: ResolvedRunOptions,
  resumeSessionId?: string | null,
  maxBudgetUsd?: number,
) {
  return {
    cwd: options.cwd,
    ...(maxBudgetUsd && maxBudgetUsd > 0 ? { maxBudgetUsd } : {}),
    ...(options.allowedTools ? { allowedTools: options.allowedTools } : {}),
    ...(options.disallowedTools ? { disallowedTools: options.disallowedTools } : {}),
    permissionMode: options.permissionMode,
    ...(options.permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
    maxTurns: options.maxTurns,
    ...(options.model ? { model: options.model } : {}),
    ...(options.plugins.length ? { plugins: options.plugins } : {}),
    // Readable, not the working directory. Git still happens in `cwd`, so a
    // worktree stays a worktree and nothing here can be committed by accident.
    ...(options.additionalDirectories.length
      ? { additionalDirectories: options.additionalDirectories }
      : {}),
    // Rules the ritual has been granted permanently, so it stops asking for
    // things its owner already approved.
    ...(toSettingsPermissions(options.allowRules) ? { settings: toSettingsPermissions(options.allowRules) } : {}),
    ...(options.loadSettings
      ? { settingSources: ['user', 'project', 'local'] as ('user' | 'project' | 'local')[] }
      : {}),
    includePartialMessages: true,
    systemPrompt: {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      append: options.systemAppend,
    },
    ...(resumeSessionId ? { resume: resumeSessionId } : {}),
  }
}
