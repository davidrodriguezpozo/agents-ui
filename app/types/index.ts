export type AgentModel = 'opus' | 'sonnet' | 'haiku' | 'inherit'
export type AgentMemory = 'user' | 'project' | 'none'

/** Where a definition lives: `~/.claude`, `<project>/.claude`, or inside a plugin. */
export type Scope = 'user' | 'project'
export type ItemSource = 'local' | 'plugin'

export interface AgentFrontmatter {
  name: string
  description: string
  model?: AgentModel
  color?: string
  memory?: AgentMemory
  /** Tool allowlist, as Claude Code reads it from subagent frontmatter. */
  tools?: string[]
}

export interface Agent {
  slug: string
  filename: string
  frontmatter: AgentFrontmatter
  body: string
  hasMemory: boolean
  filePath: string
  scope: Scope
  source: ItemSource
  /** Set when `source === 'plugin'`. */
  pluginId?: string
  pluginName?: string
  /** Project root for project-scoped items. */
  projectDir?: string
  readOnly?: boolean
}

export interface CommandFrontmatter {
  name: string
  description: string
  'argument-hint'?: string
  'allowed-tools'?: string[]
  model?: string
}

export interface Command {
  slug: string
  filename: string
  directory: string
  frontmatter: CommandFrontmatter
  body: string
  filePath: string
  scope: Scope
  source: ItemSource
  /** How the command is typed in Claude Code, e.g. `/defender:pickup`. */
  invocation: string
  pluginId?: string
  pluginName?: string
  projectDir?: string
  readOnly?: boolean
}

export interface Settings {
  hooks?: Record<string, unknown[]>
  enabledPlugins?: Record<string, boolean>
  statusLine?: { type: string; command: string }
  alwaysThinkingEnabled?: boolean
  guidanceSeen?: {
    agentDetail?: boolean
    explore?: boolean
    chat?: boolean
  }
  [key: string]: unknown
}

export interface AgentPayload {
  frontmatter: AgentFrontmatter
  body: string
}

export interface CommandPayload {
  frontmatter: CommandFrontmatter
  body: string
  directory?: string
}

export interface PluginComponentCounts {
  commands: number
  agents: number
  skills: number
  hooks: number
  mcpServers: number
  scripts: number
}

export interface Plugin {
  id: string
  name: string
  marketplace: string
  description: string
  version: string
  enabled: boolean
  installedAt: string
  lastUpdated: string
  installPath: string
  skills: string[]
  author?: { name: string; email?: string }
  counts: PluginComponentCounts
}

// ── Plugin components ───────────────────────────────

export interface PluginCommand {
  name: string
  /** Full invocation, e.g. `/hd:debug` or `/defender:pickup`. */
  invocation: string
  namespace: string
  description: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  body: string
  filePath: string
  relPath: string
}

export interface PluginAgent {
  name: string
  description: string
  model?: string
  tools?: string[]
  color?: string
  body: string
  filePath: string
  relPath: string
}

export interface PluginSkill {
  slug: string
  /** Which directory it came from — `skills`, `workflow-skills`, … */
  group: string
  frontmatter: SkillFrontmatter
  body: string
  filePath: string
}

export interface PluginHookEntry {
  event: string
  matcher?: string
  commands: string[]
}

export interface PluginMcpServer {
  name: string
  transport: string
  target: string
  configPath: string
}

export interface PluginScript {
  name: string
  filePath: string
}

export interface PluginComponents {
  commands: PluginCommand[]
  agents: PluginAgent[]
  skills: PluginSkill[]
  hooks: PluginHookEntry[]
  mcpServers: PluginMcpServer[]
  scripts: PluginScript[]
  readmePath: string | null
}

export interface SkillFrontmatter {
  name: string
  description: string
  context?: string
  agent?: string
  /** Tool allowlist, as Claude Code reads it from skill frontmatter. */
  'allowed-tools'?: string[]
  /**
   * Keys this app has no field for are still real. Anything editing a skill
   * has to carry them back out again — see `mergeSkillFrontmatter`.
   */
  [key: string]: unknown
}

/**
 * A file sitting beside SKILL.md in the skill's directory.
 *
 * A skill is a directory, not a file: the instructions live in SKILL.md and
 * everything it defers to — `references/`, `scripts/`, `assets/` — lives next
 * to it. Progressive disclosure is the whole point of that layout, so a skill
 * shown without these is a skill shown with its second half missing.
 */
export interface SkillFile {
  name: string
  /** Relative to the skill directory, which is the only form a request may use. */
  path: string
  kind: 'file' | 'directory'
  size?: number
  /** Set when the contents are not text we would open in an editor. */
  binary?: boolean
}

export interface Skill {
  slug: string
  frontmatter: SkillFrontmatter
  body: string
  filePath: string
  source?: 'local' | 'github' | 'plugin'
  githubRepo?: string
  scope?: Scope
  pluginId?: string
  pluginName?: string
  projectDir?: string
  readOnly?: boolean
  /** Supporting files, SKILL.md excluded. Only present on a single-skill fetch. */
  files?: SkillFile[]
}

export interface AgentSkill {
  slug: string
  frontmatter: SkillFrontmatter
  body: string
  filePath: string
  source: 'standalone' | 'plugin'
  pluginId?: string
  pluginName?: string
}

export interface SkillPayload {
  frontmatter: SkillFrontmatter
  body: string
}

// ── GitHub Imports ──────────────────────────────────

export interface ScannedSkill {
  slug: string
  name: string
  description: string
  category: string | null
  tags: string[]
  filePath: string
  hasSupporting: boolean
  conflict: boolean
}

export interface ScanResult {
  owner: string
  repo: string
  branch: string
  targetPath: string
  skills: ScannedSkill[]
  detectionMethod: 'frontmatter' | 'skills-index'
}

export interface GithubImport {
  owner: string
  repo: string
  url: string
  targetPath: string
  localPath: string
  importedAt: string
  lastChecked: string
  currentSha: string
  remoteSha: string
  selectedSkills: string[]
}

export interface GithubImportsRegistry {
  imports: GithubImport[]
}

// ── Marketplace ─────────────────────────────────────

export interface AvailablePlugin {
  name: string
  description: string
  author?: { name: string; email?: string }
  skillCount: number
  commandCount: number
  agentCount: number
  installed: boolean
  marketplace: string
}

export interface MarketplaceSource {
  name: string
  sourceType: string
  sourceUrl: string
  lastUpdated: string
}

export interface MarketplaceData {
  marketplaces: Record<string, { plugins: AvailablePlugin[] }>
}

/** `skills` widens from a list of names to full skill records. */
export type PluginDetail = Omit<Plugin, 'skills'> & PluginComponents & {
  /** Plugin skills in the shape the standalone skill editor expects. */
  skillDetails: Skill[]
}

export interface SkillInvocation {
  skill: string
  args: string | null
}

export type WizardStep = 1 | 2 | 3

// ── Chat ──────────────────────────────────────────

/** Image types the model accepts. `IMAGE_MEDIA_TYPES` is this list at runtime. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/**
 * An image sent with a message, so the model sees it rather than reading about
 * it. See `app/utils/imageAttachments.ts`.
 */
export interface ChatAttachment {
  id: string
  name: string
  mediaType: ImageMediaType
  /** Decoded size, for the chip. */
  size: number
  /**
   * Base64 of the image itself, no data-URL prefix.
   *
   * Absent on a conversation read back from disk: the bytes are stripped before
   * a conversation is saved, so a history file stays a readable record instead
   * of a few megabytes of base64 per screenshot. The model already has them —
   * they are in the session it is resuming.
   */
  data?: string
}

/**
 * An attachment recorded rather than carried: what it was called, what it was,
 * how big it was, and no bytes.
 *
 * This is what a queued session message holds. The bytes are on disk — see
 * `server/utils/queuedAttachments.ts` — because they are too big to live on a
 * record that is rewritten as often as a session's is, and it is also what a
 * chip needs to draw itself, so the page gets it for free.
 */
export type ChatAttachmentRef = Omit<ChatAttachment, 'data'>

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  timestamp: number
  /** Images the user attached to this turn. User messages only. */
  attachments?: ChatAttachment[]
}

export type StreamActivity =
  | { type: 'thinking' }
  | { type: 'tool'; name: string; elapsed: number }
  | { type: 'writing' }
  | { type: 'permission'; name: string }
  | null

/** One choice on offer in a question. */
export interface QuestionOption {
  label: string
  description: string
  /** A mockup or snippet the agent sent with the option, when it sent one. */
  preview?: string
}

/** A question the agent stopped to ask. See `server/utils/askUserQuestion`. */
export interface QuestionPrompt {
  question: string
  /** Short chip, e.g. `Approach`. */
  header: string
  options: QuestionOption[]
  /** Several options may be chosen at once. */
  multiSelect: boolean
}

/** A tool call waiting on the user before the agent can continue. */
export interface PermissionRequest {
  id: string
  ownerId: string
  toolName: string
  input: Record<string, unknown>
  toolUseId: string
  decisionReason?: string
  blockedPath?: string
  /** Whether "allow for the rest of this run" is on offer. */
  canRemember: boolean
  /**
   * Permission rules the CLI proposed for this request, e.g. `Bash(gh:*)`.
   * These are what a ritual can permanently allow.
   */
  suggestedRules: string[]
  /**
   * Set when the agent asked a question rather than asking to use a tool. Both
   * arrive in the same queue and are answered through the same endpoint, so
   * only what renders a prompt needs to tell them apart.
   */
  questions?: QuestionPrompt[]
  createdAt: number
}

export type PermissionAnswer =
  | {
      behavior: 'allow'
      scope?: 'once' | 'session'
      /** Chosen labels — or typed text — per question. Empty is a skip. */
      answers?: Record<string, string[]>
    }
  | { behavior: 'deny'; message?: string }

// ── History ───────────────────────────────────────

export interface ToolCallRecord {
  toolName: string
  elapsed: number
  timestamp: number
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

export interface RunStats {
  usage: TokenUsage
  costUsd: number
  durationMs: number
  numTurns: number
  model?: string
  permissionDenials: { toolName: string }[]
}

export interface ConversationSession {
  id: string
  agentSlug: string
  /** `studio` for agent testing, `manager` for the global assistant panel. */
  origin: 'studio' | 'manager'
  title: string
  messages: ChatMessage[]
  toolCalls: ToolCallRecord[]
  tokenUsage: TokenUsage
  costUsd: number
  duration: number
  model?: string
  projectDir?: string
  sdkSessionId?: string
  createdAt: string
  updatedAt: string
}

export interface ConversationSummary {
  id: string
  agentSlug: string
  origin: 'studio' | 'manager'
  title: string
  messageCount: number
  toolCallCount: number
  tokenUsage: TokenUsage
  costUsd: number
  firstUserMessage: string
  createdAt: string
  updatedAt: string
}

// ── Run configuration (fidelity controls) ──────────

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface RunConfig {
  /** Tool allowlist. Empty/undefined means "everything the CLI offers". */
  allowedTools?: string[]
  disallowedTools?: string[]
  permissionMode: PermissionMode
  maxTurns: number
  /** Load `~/.claude`, `.claude/settings.json` and CLAUDE.md like the real CLI. */
  loadProjectSettings: boolean
  model?: string
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
  permissionMode: 'acceptEdits',
  maxTurns: 40,
  loadProjectSettings: true,
}

/** The full tool surface Claude Code exposes, for the per-agent tool picker. */
export const AVAILABLE_TOOLS = [
  'Task',
  'Bash',
  'Glob',
  'Grep',
  'Read',
  'Edit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'BashOutput',
  'KillShell',
  'Skill',
  'SlashCommand',
] as const
