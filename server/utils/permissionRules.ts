import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'

/**
 * Claude Code permission rules, as they appear in `settings.permissions.allow`.
 *
 * A rule is either a bare tool (`Read`) or a tool narrowed by content
 * (`Bash(gh:*)`, `WebFetch(domain:github.com)`). The narrow form is the point:
 * a ritual that needs `gh` should get `Bash(gh:*)`, not the ability to run any
 * command every morning with nobody watching.
 */

export interface RuleValue {
  toolName: string
  ruleContent?: string
}

export function formatRule(value: RuleValue): string {
  const tool = value.toolName?.trim()
  if (!tool) return ''
  const content = value.ruleContent?.trim()
  return content ? `${tool}(${content})` : tool
}

export function parseRule(rule: string): RuleValue | null {
  const trimmed = rule?.trim()
  if (!trimmed) return null

  const match = trimmed.match(/^([A-Za-z_][\w-]*)\s*(?:\((.*)\))?$/s)
  if (!match) return null

  const toolName = match[1]!
  const ruleContent = match[2]
  return ruleContent?.trim() ? { toolName, ruleContent: ruleContent.trim() } : { toolName }
}

/**
 * The rules the CLI itself proposed when it asked. These are far better than
 * anything we could infer from the tool input, because the CLI already knows
 * how to scope a rule for each tool.
 */
export function rulesFromSuggestions(suggestions: PermissionUpdate[] | undefined): string[] {
  if (!suggestions?.length) return []

  const rules: string[] = []
  for (const update of suggestions) {
    if (update.type !== 'addRules' && update.type !== 'replaceRules') continue
    if (update.behavior !== 'allow') continue

    for (const value of update.rules ?? []) {
      const formatted = formatRule(value as RuleValue)
      if (formatted) rules.push(formatted)
    }
  }

  return dedupe(rules)
}

function dedupe(rules: string[]): string[] {
  return [...new Set(rules.map(r => r.trim()).filter(Boolean))]
}

/**
 * Combine allowlists, dropping anything a broader rule already covers.
 *
 * `Bash` allows every command, so keeping `Bash(gh:*)` alongside it would
 * overstate how narrow the ritual's permissions are — which matters, because
 * this list is what someone reads to decide whether it is safe.
 */
export function mergeRules(existing: string[] = [], incoming: string[] = []): string[] {
  const all = dedupe([...existing, ...incoming])

  const bareTools = new Set(
    all.map(parseRule).filter(r => r && !r.ruleContent).map(r => r!.toolName)
  )

  const kept = all.filter((rule) => {
    const parsed = parseRule(rule)
    if (!parsed) return false
    if (!parsed.ruleContent) return true
    // A narrowed rule is redundant once the bare tool is allowed.
    return !bareTools.has(parsed.toolName)
  })

  return kept.sort((a, b) => a.localeCompare(b))
}

export function removeRule(rules: string[] = [], rule: string): string[] {
  return rules.filter(r => r.trim() !== rule.trim())
}

/** Plain-language rendering, for people who have never seen a permission rule. */
export function describeRule(rule: string): string {
  const parsed = parseRule(rule)
  if (!parsed) return rule

  const { toolName, ruleContent } = parsed
  if (!ruleContent) {
    switch (toolName) {
      case 'Bash': return 'Run any terminal command'
      case 'Read': return 'Read any file'
      case 'Write': return 'Create any file'
      case 'Edit': return 'Change any file'
      case 'WebFetch': return 'Fetch any web page'
      case 'WebSearch': return 'Search the web'
      default: return `Use ${toolName}`
    }
  }

  if (toolName === 'Bash') return `Run ${ruleContent} commands`
  if (toolName === 'WebFetch' && ruleContent.startsWith('domain:')) {
    return `Fetch pages from ${ruleContent.slice('domain:'.length)}`
  }
  if (toolName === 'Read') return `Read ${ruleContent}`
  if (toolName === 'Write') return `Create ${ruleContent}`
  if (toolName === 'Edit') return `Change ${ruleContent}`

  return `${toolName}: ${ruleContent}`
}

/** Shape an allowlist into the SDK's `settings` option. */
export function toSettingsPermissions(allowRules: string[] | undefined) {
  const allow = mergeRules(allowRules ?? [])
  return allow.length ? { permissions: { allow } } : undefined
}
