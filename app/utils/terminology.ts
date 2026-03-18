import type { AgentModel } from '~/types'

export const friendlyModelName: Record<AgentModel, string> = {
  opus: 'Most capable',
  sonnet: 'Balanced',
  haiku: 'Fast & efficient',
}

export const friendlyToolName: Record<string, string> = {
  Read: 'Reading your files...',
  Write: 'Saving changes...',
  Edit: 'Editing files...',
  Glob: 'Searching your workspace...',
  Grep: 'Searching file contents...',
  Bash: 'Running a command...',
  Agent: 'Working on a subtask...',
}

export function getFriendlyModelName(model: AgentModel | undefined): string {
  return model ? friendlyModelName[model] ?? model : 'Balanced'
}

export function getFriendlyToolName(tool: string): string {
  return friendlyToolName[tool] ?? `Working...`
}
