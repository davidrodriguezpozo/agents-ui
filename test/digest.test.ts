import { describe, expect, it } from 'vitest'
import { describeDenied, toolLabel } from '../server/utils/digest'

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
