import { describe, expect, it } from 'vitest'
import { titleFromBranch, transcriptDirFor } from '../server/utils/sessionRecovery'

describe('transcriptDirFor', () => {
  // Matches how Claude Code names its own transcript directories; getting this
  // wrong silently loses the conversation on restore rather than erroring.
  it('replaces slashes and dots with dashes', () => {
    expect(transcriptDirFor('/Users/me/.claude/agents-ui/worktrees/webapp/abc123'))
      .toMatch(/projects\/-Users-me--claude-agents-ui-worktrees-webapp-abc123$/)
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

  /**
   * Worktrees this app did not create, found in its directory on a real machine.
   * `id` is the directory basename, and for these it *is* the branch's last
   * segment — so stripping it as an id left `fix/authorization-gaps` titled
   * "Fix/". A session id here is never hyphenated.
   */
  it('keeps the branch when the directory name is not a session id', () => {
    expect(titleFromBranch('fix/authorization-gaps', 'authorization-gaps'))
      .toBe('Fix authorization gaps')
  })

  it('reads a type prefix as words rather than leaving a slash in a sentence', () => {
    expect(titleFromBranch('fix/cogs-per-product-calculation', 'cogs-per-product'))
      .toBe('Fix cogs per product calculation')
    expect(titleFromBranch('refactor/misc-dead-code', 'misc-dead-code'))
      .toBe('Refactor misc dead code')
  })

  it('is not confused by a directory name containing regex characters', () => {
    // `id` goes into a pattern, so an unescaped `.` matched any character and a
    // stray `(` would have thrown outright.
    expect(titleFromBranch('fix/v1.2-upgrade', 'v1.2-upgrade')).toBe('Fix v1.2 upgrade')
  })
})
