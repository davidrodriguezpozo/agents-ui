import { describe, expect, it } from 'vitest'
import {
  describeDenied, describeIncomplete, ruleTool, splitUnreachable, stillNeeded, toolLabel,
} from '../server/utils/digest'
import { parseMcpList } from '../server/utils/mcp'

/**
 * Naming a refused tool in a sentence somebody reads at breakfast.
 *
 * The real names are identifiers — `mcp__claude_ai_Linear__list_issues` — and
 * four of them in a row is not a sentence. What matters is which service said
 * no, which is buried in the middle of each one.
 */

describe('toolLabel', () => {
  it('pulls the service out of an MCP tool name', () => {
    expect(toolLabel('mcp__claude_ai_Linear__list_issues')).toBe('Linear')
    expect(toolLabel('mcp__notion__notion-list-recent-pages')).toBe('notion')
    expect(toolLabel('mcp__claude_ai_Google_Drive__search_files')).toBe('Google Drive')
  })

  it('leaves a plain tool name alone', () => {
    expect(toolLabel('Bash')).toBe('Bash')
    expect(toolLabel('WebFetch')).toBe('WebFetch')
  })
})

describe('describeDenied', () => {
  it('collapses several tools from one service into its name once', () => {
    // Being refused three Linear calls is one fact, not three.
    expect(describeDenied([
      'mcp__claude_ai_Linear__list_issues',
      'mcp__claude_ai_Linear__get_issue',
    ])).toBe('Linear')
  })

  it('names up to three, then counts the rest', () => {
    expect(describeDenied(['Bash', 'mcp__a__x', 'mcp__b__y'])).toBe('Bash, a, b')
    expect(describeDenied(['Bash', 'mcp__a__x', 'mcp__b__y', 'mcp__c__z', 'mcp__d__w']))
      .toBe('Bash, a, b and 2 more')
  })

  it('says something rather than nothing when the list is empty', () => {
    expect(describeDenied([])).toBe('a tool')
  })
})

/**
 * The two ways an unattended run comes back half-done arrive at the same door
 * — `needsAttention` — and used to leave through it wearing the same sentence.
 * Being told a tool was refused when nothing was refused sends you looking for
 * a permission problem that never existed.
 */
describe('describeIncomplete', () => {
  it('names the turn limit rather than inventing a refusal', () => {
    expect(describeIncomplete({ stoppedBy: 'turns' })).toContain('every turn it was allowed')
  })

  it('names the spending limit', () => {
    expect(describeIncomplete({ stoppedBy: 'budget' })).toContain('spending limit')
  })

  it('still names what was refused when something was', () => {
    expect(describeIncomplete({ deniedTools: ['Bash'] })).toContain('Refused')
  })

  it('does not claim a refusal it cannot name', () => {
    expect(describeIncomplete({})).toContain('a tool')
  })

  it('names the host the sandbox refused, which is the thing you can fix', () => {
    const said = describeIncomplete({ refusedHosts: ['registry.npmjs.org'] })
    expect(said).toContain('registry.npmjs.org')
    expect(said).not.toContain('Refused a tool')
  })

  /**
   * Both at once means the tool refusal is the one worth leading with: it is
   * the wall the run hit first, and the host may only have been wanted by work
   * that the missing tool would have done anyway.
   */
  it('leads with the tool when it was refused both', () => {
    expect(describeIncomplete({ deniedTools: ['Bash'], refusedHosts: ['github.com'] }))
      .toContain('Refused')
  })
})

/**
 * A blocked run is a fact about a morning and stays in the record forever. The
 * permission it needed is not, because you can give it — and once you have,
 * the report must stop asking.
 *
 * Without this, "Allow this from now on" worked, said so, and then offered
 * itself again on the next page load, for good: the rules were sitting on the
 * ritual and nothing ever compared them against what the report was still
 * asking for.
 */
describe('a blocked ritual whose rules have since been granted', () => {
  const RULES = ['Bash(gh api:*)', 'Bash(gh issue:*)']

  it('offers nothing more once every rule is allowed', () => {
    expect(stillNeeded(RULES, RULES)).toBeUndefined()
  })

  it('offers only what is actually still missing', () => {
    expect(stillNeeded(RULES, ['Bash(gh api:*)'])).toEqual(['Bash(gh issue:*)'])
  })

  it('offers everything when the ritual has been granted nothing', () => {
    expect(stillNeeded(RULES, [])).toEqual(RULES)
  })

  it('has nothing to offer when the run suggested nothing', () => {
    expect(stillNeeded(undefined, RULES)).toBeUndefined()
    expect(stillNeeded([], RULES)).toBeUndefined()
  })
})

/**
 * Which refusals the "Allow this from now on" button should actually cover.
 *
 * Granting a rule for a tool the run could never reach is worse than offering
 * nothing: the button turns into "Allowed. It will not stop for these again",
 * and the next firing is refused exactly as before, for another morning.
 */
describe('splitUnreachable', () => {
  const servers = parseMcpList([
    'claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected',
    'notion: https://mcp.notion.com/mcp (HTTP) - ✔ Connected',
  ].join('\n'))

  it('keeps a rule whose server is reachable', () => {
    const split = splitUnreachable(
      ['mcp__notion__notion-search'],
      ['mcp__notion__notion-search'],
      servers,
    )

    expect(split.grantable).toEqual(['mcp__notion__notion-search'])
    expect(split.unreachable).toBeUndefined()
  })

  it('drops a rule for a connector tool and says why', () => {
    const split = splitUnreachable(
      ['mcp__claude_ai_Slack__slack_read_channel'],
      ['mcp__claude_ai_Slack__slack_read_channel'],
      servers,
    )

    expect(split.grantable).toBeUndefined()
    expect(split.unreachable).toHaveLength(1)
    expect(split.unreachable![0]!.reason).toContain('claude.ai connector')
  })

  it('offers the half that would work and explains the half that would not', () => {
    // The real shape of the ritual this was written for: some rules worth
    // granting, some that can never be.
    const split = splitUnreachable(
      ['mcp__notion__notion-search', 'mcp__claude_ai_Slack__slack_read_channel'],
      ['mcp__notion__notion-search', 'mcp__claude_ai_Slack__slack_read_channel'],
      servers,
    )

    expect(split.grantable).toEqual(['mcp__notion__notion-search'])
    expect(split.unreachable).toHaveLength(1)
  })

  it('explains a refusal even when no rule was ever suggested for it', () => {
    // A tool can be denied without a suggestion being recorded, and that is
    // exactly the case worth a sentence rather than a silent nothing.
    const split = splitUnreachable(undefined, ['mcp__claude_ai_Slack__slack_search_users'], servers)

    expect(split.grantable).toBeUndefined()
    expect(split.unreachable).toHaveLength(1)
  })

  it('leaves ordinary rules alone', () => {
    const split = splitUnreachable(['Bash(gh issue edit:*)'], ['Bash'], servers)

    expect(split.grantable).toEqual(['Bash(gh issue edit:*)'])
    expect(split.unreachable).toBeUndefined()
  })

  it('matches a rule to its tool when the rule carries an argument', () => {
    expect(ruleTool('Bash(gh issue edit:*)')).toBe('Bash')
    expect(ruleTool('mcp__notion__notion-search')).toBe('mcp__notion__notion-search')
  })
})

/**
 * The ritual this was all found on, with its real data.
 *
 * `Morning brief` fires `/hd:goodmorning` at 08:45 from a work monorepo. It had
 * two runs, both `completed` with `needsAttention`, so both read as blocked and
 * the failing streak sat at two — one more and `GIVE_UP_AFTER` would have
 * turned it off. Eight rules had been granted across those two mornings, and
 * the tools they covered could never have worked: the Linear connector is not
 * signed in, and there is no `claude.ai Slack` on the machine at all.
 *
 * Kept verbatim from `claude mcp list` in that project, because the point of
 * the test is that this exact set-up produces an honest answer.
 */
const REAL_PROJECT_SERVERS = parseMcpList(`Checking MCP server health…

claude.ai Linear: https://mcp.linear.app/mcp - ! Needs authentication
claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected
plugin:slack:slack: https://mcp.slack.com/mcp (HTTP) - ✔ Connected
notion: https://mcp.notion.com/mcp (HTTP) - ✔ Connected`)

describe('the morning brief that was one run from turning itself off', () => {
  const DENIED = [
    'Bash',
    'mcp__claude_ai_Linear__list_issues',
    'mcp__notion__notion-list-recent-pages',
    'mcp__claude_ai_Slack__slack_search_channels',
  ]

  const split = splitUnreachable(DENIED, DENIED, REAL_PROJECT_SERVERS)

  it('still offers the two rules that would actually help', () => {
    // Bash is an ordinary tool and Notion is a working HTTP server. Those
    // grants were never the problem and must not be taken away.
    expect(split.grantable).toEqual(['Bash', 'mcp__notion__notion-list-recent-pages'])
  })

  it('sends you to a real server for Linear rather than to its sign-in', () => {
    // Linear is both a connector and unauthenticated, and being a connector is
    // the answer that matters: signing the connector in would still leave an
    // unattended run with none of its tools. "Needs authentication" is the
    // true-but-useless reading, and the order of the checks is what avoids it.
    const linear = split.unreachable!.find(u => u.tool.includes('Linear'))
    expect(linear!.reason).toContain('claude.ai connector')
    expect(linear!.reason).toContain('its own HTTP server')
  })

  it('says the Slack server is not there at all, rather than staying quiet', () => {
    // The failure that made this worth building: the rule was granted, the
    // button said "Allowed. It will not stop for these again", and the next
    // firing was refused identically.
    const slack = split.unreachable!.find(u => u.tool.includes('Slack'))
    expect(slack!.reason).toContain('No MCP server matching claude_ai_Slack')
  })

  it('leaves exactly the two that no rule can fix', () => {
    expect(split.unreachable).toHaveLength(2)
  })
})
