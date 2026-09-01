import { existsSync } from 'node:fs'
import type { H3Event } from 'h3'
import { getClaudeDir } from './claudeDir'
import { claudeExecutable } from './claudeExecutable'
import { getProjectDir, getScopeRoots, scopeRootsFor } from './scope'
import { resolveAgentInRoots, toSdkModel, type ResolvedAgent } from './resolveAgent'
import { readInstalledPlugins } from './pluginScan'
import { resolveEnabledPluginsInRoots } from './pluginState'
import { toSettingsPermissions } from './permissionRules'
import { readPreferences, sanitiseEffort, type RunEffort } from './preferences'
import { sandboxForProject, toSandboxSettings, type ProjectSandbox } from './sandbox'
import { briefForRun } from './brief'
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
  /**
   * Override what this run is allowed to touch. Almost nothing passes this —
   * the answer belongs to the repository, not to one caller — but a run that
   * exists to repair a sandbox problem needs a way to say so.
   */
  sandbox?: ProjectSandbox
  /**
   * The repository this run belongs to, for settings keyed by repository
   * rather than by working directory.
   *
   * A session's `projectDir` is its *worktree*, which is created per session
   * and deleted when it closes. Anything filed against that key is written
   * where nothing reads and evaporates with the session — which is exactly
   * what happened to the sandbox: Settings and the "Allow these hosts" button
   * both write under the repository, the run looked under the worktree, and
   * the two never met. Allowing a host reported success and changed nothing.
   *
   * Permission rules avoided this by being passed in already resolved. This is
   * the same fact said once, so the next repository-scoped setting cannot
   * repeat the mistake.
   */
  repoDir?: string
  /**
   * Nobody is watching this one — a ritual, a repair turn, a landing step.
   *
   * Only affects whether a sandboxed run may skip its Bash prompts. A turn you
   * typed keeps them, because the trust level you chose promised them.
   */
  unattended?: boolean
  /**
   * How hard this run thinks. Absent means whatever this machine was set to.
   */
  effort?: RunEffort
  /**
   * This run *is* the Agent Studio's own chat, so being told it is an assistant
   * inside a web interface for managing agents is true.
   *
   * Opt-in, because it used to be the fallback for anything without an agent —
   * which is to say for sessions and rituals, neither of which is
   * managing anything. A pull request review opened believing its job was to
   * edit files in `~/.claude`.
   */
  managerChat?: boolean
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
  sandbox: ProjectSandbox
  unattended: boolean
  effort: RunEffort
  /**
   * What is going on around this machine, for a run that is starting cold.
   *
   * Resolved here because reading it is I/O and this is the layer that does I/O.
   * *Applied* in `toQueryOptions`, which is the only layer that knows whether
   * this run is a fresh start or the continuation of a conversation — and that
   * distinction turns out to decide whether attaching it is nearly free or
   * genuinely expensive. See the note there.
   */
  standingBrief: string
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
  const preferences = await readPreferences()
  // 0 means "no preference", which must fall through to the default rather
  // than being read as a limit of zero turns.
  const preferredTurns = preferences.maxTurns || undefined
  const projectDir = body.projectDir && existsSync(body.projectDir) ? body.projectDir : null
  const roots = scopeRootsFor(projectDir)

  const agent = body.agentSlug ? await resolveAgentInRoots(roots, body.agentSlug) : null

  // The Studio's own chat is the only thing the manager prompt describes. A
  // run without an agent is not a run that wants to be told it lives in a
  // settings screen — it is a session working in a repository, and the prompt
  // was quietly the first thing every one of them read.
  let systemAppend: string
  if (body.systemPromptOverride?.trim()) {
    systemAppend = body.systemPromptOverride
  } else if (agent) {
    systemAppend = `You are "${agent.name}", a specialized agent.${
      agent.description ? `\n\nYou are used when: ${agent.description}` : ''
    }\n\nFollow these instructions precisely:\n\n${agent.prompt}`
  } else if (body.managerChat) {
    systemAppend = managerPrompt(claudeDir)
  } else {
    systemAppend = ''
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
  const [installed, isEnabled, projectSandbox, standingBrief] = await Promise.all([
    readInstalledPlugins(roots[0]!.dir),
    resolveEnabledPluginsInRoots(roots),
    // Keyed by repository, never by the working directory — see `repoDir`.
    sandboxForProject(body.repoDir ?? projectDir ?? undefined),
    // Asked about the repository rather than the worktree: a session's own
    // sessions are the repository's, and `projectDir` here is a checkout that
    // exists for one session and is deleted with it.
    briefForRun(body.repoDir ?? projectDir ?? undefined).catch(() => ''),
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
    // the built-in. Sessions and rituals both pass nothing, which is
    // why the preference has to be consulted here rather than at each caller.
    maxTurns: Math.max(1, Math.min(body.maxTurns ?? preferredTurns ?? DEFAULT_MAX_TURNS, 200)),
    model: toSdkModel(body.model || agent?.model),
    loadSettings: body.loadProjectSettings !== false,
    plugins,
    systemAppend,
    agent,
    allowRules: body.allowRules ?? [],
    additionalDirectories: (body.additionalDirectories ?? []).filter(dir => dir && dir !== (projectDir || claudeDir)),
    // An explicit request wins, then whatever the repository was set to, then
    // sandboxed — the default lives in `sandboxForProject`, not here, so there
    // is one place that decides it.
    sandbox: body.sandbox ?? projectSandbox,
    unattended: body.unattended === true,
    // Same shape as the turn limit: an explicit request wins, then whatever
    // this machine was set to. Never left to the SDK to decide.
    effort: body.effort ? sanitiseEffort(body.effort) : preferences.effort,
    standingBrief,
  }
}

/**
 * The system prompt this run actually gets.
 *
 * The brief is appended *after* the agent's own instructions, never before: what
 * a run is for outranks what is going on around it, and a subagent that read
 * three paragraphs of context before being told its job answered as though the
 * context were the job.
 *
 * **It is left off a resumed conversation, and that is the whole reason this is
 * a function.** Prompt caching is prefix-based: change the system prompt and
 * everything after it misses, which on turn nine of a long session means
 * re-reading the entire conversation at full price. The brief is rebuilt every
 * couple of minutes, so attaching it to every turn would quietly guarantee that
 * miss on every turn of every session — paying for the whole history to buy a
 * fact the session was already told on turn one.
 *
 * Which is also why it is not a loss. A resumed session has the brief in its
 * context already; a ritual and the first turn of a session are
 * all cold starts, and they are exactly the runs this was built for.
 */
export function systemPromptFor(options: ResolvedRunOptions, resuming: boolean): string {
  if (resuming || !options.standingBrief) return options.systemAppend

  return [options.systemAppend, options.standingBrief].filter(Boolean).join('\n\n---\n\n')
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
    // Resolved rather than left to the SDK, which looks for a native binary
    // this build does not carry — see `claudeExecutable`.
    pathToClaudeCodeExecutable: claudeExecutable(),
    // Spread rather than added to: the SDK uses this *instead of*
    // `process.env`, so anything left out is simply gone from the run.
    //
    // `CLAUDE_CODE_ARTIFACT` turns the Artifact tool back on. Claude Code
    // registers it only when the entrypoint is a human at a terminal, and the
    // SDK stamps `CLAUDE_CODE_ENTRYPOINT=sdk-ts` on every process it spawns —
    // so every session and ritual here asked for an artifact
    // and got `No such tool available: Artifact`. The env var is the only
    // lever: the `enableArtifact` setting is read *after* that entrypoint
    // check, so turning it on in `/config` changed nothing. Past this point
    // it is still the account's call — artifacts want a claude.ai login on a
    // paid plan — but that is an answer from the other end, not a door this
    // process was holding shut.
    env: { ...process.env, CLAUDE_CODE_ARTIFACT: '1' },
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
    // Isolation for the commands this run decides to execute. Absent when the
    // project has turned it off, which is the SDK's own "no sandbox".
    ...(toSandboxSettings(options.sandbox, { unattended: options.unattended })
      ? { sandbox: toSandboxSettings(options.sandbox, { unattended: options.unattended }) }
      : {}),
    includePartialMessages: true,
    // Passed on every run rather than left to the SDK's default, which is how
    // the same review command came back having done no reasoning at all.
    effort: options.effort,
    systemPrompt: {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      // Nothing to add is said by leaving it off, not by appending an empty
      // string to the preset. What is added includes the standing brief on a
      // cold start and deliberately not on a resume — see `systemPromptFor`.
      ...(systemPromptFor(options, Boolean(resumeSessionId))
        ? { append: systemPromptFor(options, Boolean(resumeSessionId)) }
        : {}),
    },
    ...(resumeSessionId ? { resume: resumeSessionId } : {}),
  }
}
