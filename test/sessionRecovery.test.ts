import { describe, expect, it } from 'vitest'
import { titleFromBranch, transcriptDirFor } from '../server/utils/sessionRecovery'

describe('transcriptDirFor', () => {
  // Matches how Claude Code names its own transcript directories; getting this
  // wrong silently loses the conversation on restore rather than erroring.
  it('replaces slashes and dots with dashes', () => {
    expect(transcriptDirFor('/Users/me/.claude/agents-ui/worktrees/almaria/abc123'))
      .toMatch(/projects\/-Users-me--claude-agents-ui-worktrees-almaria-abc123$/)
  })

  it('handles a plain project path', () => {
    expect(transcriptDirFor('/Users/me/workspaces/app'))
      .toMatch(/projects\/-Users-me-workspaces-app$/)
  })
})

describe('titleFromBranch', () => {
  it('recovers a readable title from the branch slug', () => {
    expect(titleFromBranch('agents-ui/add-a-search-filter-mscd66dxgj7s', 'mscd66dxgj7s'))
      .toBe('Add a search filter')
  })

  it('handles a truncated slug without leaving a trailing dash', () => {
    expect(titleFromBranch('agents-ui/we-d-like-the-tone-of-the-agents-to-be-m-abc', 'abc'))
      .toBe('We d like the tone of the agents to be m')
  })

  it('falls back when the session had no usable title', () => {
    expect(titleFromBranch('agents-ui/session-abc123', 'abc123')).toBe('Recovered session')
  })

  it('does not mangle an id that also appears mid-slug', () => {
    expect(titleFromBranch('agents-ui/abc-refactor-abc', 'abc')).toBe('Abc refactor')
  })
})
