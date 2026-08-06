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

    // An MCP tool's name is an identifier — `mcp__claude_ai_Linear__list_issues`
    // — and "Use mcp__claude_ai_Linear__list_issues" is not a label anybody can
    // read. The two useful parts are the service and the verb, and both are in
    // there separated by the noise.
    const mcp = toolName.match(/^mcp__(.+?)__(.+)$/)
    if (mcp) {
      const service = mcp[1]!.replace(/^claude_ai_/, '').replace(/_/g, ' ')
      let action = mcp[2]!.replace(/[-_]/g, ' ')

      // Some servers repeat their own name in every tool — `slack_search_channels`,
      // `notion-list-recent-pages`. Drop it only when it really is the service
      // name: stripping any leading word turns `list_issues` into "issues".
      const first = action.split(' ')[0] ?? ''
      if (first.toLowerCase() === (service.split(' ')[0] ?? '').toLowerCase()) {
        action = action.slice(first.length).trim()
      }

      return `${service}: ${action}`
    }

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
