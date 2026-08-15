import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Granted rules that cannot do anything.
 *
 * A permission chip says "allowed" whether or not the tool behind it exists for
 * an unattended run. On the machine this was written for, a briefing carried
 * eight granted rules: four real ones, and four for a connector and a server
 * that was no longer installed. Nothing distinguished them, which is how the
 * same four came to be granted twice — refused, offered, granted, refused.
 */

const listMcpServers = vi.fn()

vi.mock('../server/utils/mcp', async () => {
  const actual = await vi.importActual<typeof import('../server/utils/mcp')>('../server/utils/mcp')
  return { ...actual, listMcpServers }
})

const { deadRulesFor } = await import('../server/utils/deadRules')
const { parseMcpList } = await import('../server/utils/mcp')

const SERVERS = parseMcpList(`claude.ai Linear: https://mcp.linear.app/mcp - ! Needs authentication
plugin:slack:slack: https://mcp.slack.com/mcp (HTTP) - ✔ Connected
notion: https://mcp.notion.com/mcp (HTTP) - ✔ Connected`)

const schedule = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'Morning brief',
  input: '/hd:goodmorning',
  invocation: '/hd:goodmorning',
  projectDir: '/repo',
  recurrence: { hour: 8, minute: 45, days: [1] },
  permission: 'full',
  enabled: true,
  origin: 'user',
  createdAt: 0,
  ...over,
} as any)

beforeEach(() => {
  listMcpServers.mockReset()
  listMcpServers.mockResolvedValue(SERVERS)
})

describe('deadRulesFor', () => {
  it('names a rule for a connector, which no grant can reach', async () => {
    const dead = await deadRulesFor([
      schedule({ allowRules: ['mcp__claude_ai_Linear__list_issues'] }),
    ])

    expect(dead.get('s1')).toHaveLength(1)
    expect(dead.get('s1')![0]!.reason).toContain('claude.ai connector')
  })

  it('names a rule whose server is not installed any more', async () => {
    const dead = await deadRulesFor([
      schedule({ allowRules: ['mcp__claude_ai_Slack__slack_read_channel'] }),
    ])

    expect(dead.get('s1')![0]!.reason).toContain('No MCP server matching claude_ai_Slack')
  })

  it('leaves working rules alone, so the warning means something', async () => {
    const dead = await deadRulesFor([
      schedule({
        allowRules: [
          'Bash(gh issue edit:*)',
          'mcp__notion__notion-search',
          'mcp__plugin_slack_slack__slack_read_channel',
        ],
      }),
    ])

    expect(dead.get('s1')).toBeUndefined()
  })

  it('separates the dead half from the live half', async () => {
    // The real shape of the ritual: some rules worth keeping, some that never
    // did anything.
    const dead = await deadRulesFor([
      schedule({
        allowRules: [
          'Bash(gh api:*)',
          'mcp__notion__notion-search',
          'mcp__claude_ai_Linear__list_issues',
          'mcp__claude_ai_Slack__slack_search_channels',
        ],
      }),
    ])

    expect(dead.get('s1')!.map(d => d.rule)).toEqual([
      'mcp__claude_ai_Linear__list_issues',
      'mcp__claude_ai_Slack__slack_search_channels',
    ])
  })

  it('asks nothing at all when no ritual holds an MCP rule', async () => {
    // This spawns a health check against every server and runs on a page people
    // leave open, so the common ritual — `Bash(gh …)` and nothing else — must
    // cost no process.
    const dead = await deadRulesFor([schedule({ allowRules: ['Bash(gh issue edit:*)'] })])

    expect(dead.size).toBe(0)
    expect(listMcpServers).not.toHaveBeenCalled()
  })

  it('asks once per directory rather than once per ritual', async () => {
    await deadRulesFor([
      schedule({ id: 'a', allowRules: ['mcp__claude_ai_Linear__list_issues'] }),
      schedule({ id: 'b', allowRules: ['mcp__claude_ai_Linear__list_issues'] }),
    ])

    expect(listMcpServers).toHaveBeenCalledTimes(1)
  })

  it('condemns nothing when the server list cannot be read', async () => {
    // Empty means the CLI did not answer. Reading it as "nothing is configured"
    // would light up every rule on the page at once, which is both wrong and
    // exactly when somebody would start deleting real permissions.
    listMcpServers.mockRejectedValue(new Error('claude not found'))

    const dead = await deadRulesFor([
      schedule({ allowRules: ['mcp__claude_ai_Linear__list_issues'] }),
    ])

    expect(dead.size).toBe(0)
  })
})
