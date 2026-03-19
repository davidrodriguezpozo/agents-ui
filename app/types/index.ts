export type AgentModel = 'opus' | 'sonnet' | 'haiku'
export type AgentMemory = 'user' | 'project' | 'none'

export interface AgentFrontmatter {
  name: string
  description: string
  model?: AgentModel
  color?: string
  memory?: AgentMemory
}

export interface Agent {
  slug: string
  filename: string
  frontmatter: AgentFrontmatter
  body: string
  hasMemory: boolean
  filePath: string
}

export interface CommandFrontmatter {
  name: string
  description: string
  'argument-hint'?: string
  'allowed-tools'?: string[]
}

export interface Command {
  slug: string
  filename: string
  directory: string
  frontmatter: CommandFrontmatter
  body: string
  filePath: string
}

export interface Settings {
  hooks?: Record<string, unknown[]>
  enabledPlugins?: Record<string, boolean>
  statusLine?: { type: string; command: string }
  alwaysThinkingEnabled?: boolean
  onboardingCompleted?: boolean
  guidanceSeen?: {
    agentDetail?: boolean
    explore?: boolean
    chat?: boolean
  }
  [key: string]: unknown
}

export type RelationshipType = 'spawns' | 'agent-frontmatter' | 'spawned-by'

export interface Relationship {
  sourceType: 'agent' | 'command' | 'skill' | 'plugin'
  sourceSlug: string
  targetType: 'agent' | 'command' | 'skill' | 'plugin'
  targetSlug: string
  type: RelationshipType
  evidence: string
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
}

export interface SkillFrontmatter {
  name: string
  description: string
  context?: string
  agent?: string
  [key: string]: unknown
}

export interface Skill {
  slug: string
  frontmatter: SkillFrontmatter
  body: string
  filePath: string
  source?: 'local' | 'github' | 'plugin'
  githubRepo?: string
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

export interface PluginDetail extends Plugin {
  skillDetails: Skill[]
}

export interface SkillInvocation {
  skill: string
  args: string | null
}

export type WizardStep = 1 | 2 | 3

export interface WorkflowStep {
  id: string
  agentSlug: string
  label: string
}

export interface Workflow {
  slug: string
  name: string
  description: string
  steps: WorkflowStep[]
  createdAt: string
  lastRunAt?: string
  filePath: string
}

export interface WorkflowPayload {
  name: string
  description: string
  steps: WorkflowStep[]
}

export interface StepExecution {
  stepId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  input: string
  output: string
  error?: string
  startedAt?: number
  completedAt?: number
}

// ── Chat ──────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  timestamp: number
}

export type StreamActivity =
  | { type: 'thinking' }
  | { type: 'tool'; name: string; elapsed: number }
  | { type: 'writing' }
  | null

// ── History ───────────────────────────────────────

export interface ToolCallRecord {
  toolName: string
  elapsed: number
  timestamp: number
}

export interface ConversationSession {
  id: string
  agentSlug: string
  messages: ChatMessage[]
  toolCalls: ToolCallRecord[]
  tokenUsage: { input: number; output: number }
  duration: number
  createdAt: string
}

export interface ConversationSummary {
  id: string
  agentSlug: string
  messageCount: number
  firstUserMessage: string
  createdAt: string
}
