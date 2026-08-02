/**
 * Plain-language labels for Claude Code permission rules. Mirrors
 * `server/utils/permissionRules.ts` so the browser can render a rule without a
 * round trip — the rules themselves are short and stable.
 */
export function usePermissionRuleLabels() {
  function parse(rule: string): { toolName: string; ruleContent?: string } | null {
    const match = rule?.trim().match(/^([A-Za-z_][\w-]*)\s*(?:\((.*)\))?$/s)
    if (!match) return null
    const toolName = match[1]!
    const ruleContent = match[2]
    return ruleContent?.trim() ? { toolName, ruleContent: ruleContent.trim() } : { toolName }
  }

  function describeRule(rule: string): string {
    const parsed = parse(rule)
    if (!parsed) return rule
    const { toolName, ruleContent } = parsed

    if (!ruleContent) {
      const bare: Record<string, string> = {
        Bash: 'Run any terminal command',
        Read: 'Read any file',
        Write: 'Create any file',
        Edit: 'Change any file',
        WebFetch: 'Fetch any web page',
        WebSearch: 'Search the web',
      }
      return bare[toolName] ?? `Use ${toolName}`
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

  return { describeRule }
}
