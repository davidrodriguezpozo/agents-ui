import { describe, expect, it } from 'vitest'
import { describeDenied, describeIncomplete, stillNeeded, toolLabel } from '../server/utils/digest'

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
