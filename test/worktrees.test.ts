import { describe, expect, it } from 'vitest'
import { branchNameFor, looksLikeSessionWorktree, parseWorktreeList } from '../server/utils/worktrees'

describe('branchNameFor', () => {
  it('builds a readable branch from the session title', () => {
    expect(branchNameFor('Fix the login bug', 'abc123')).toBe('fix-the-login-bug-abc123')
  })

  it('is named for the work, not for the tool that made it', () => {
    // These are ordinary branches you push and open pull requests from, so an
    // `agents-ui/` namespace read as belonging to the tool rather than the work.
    expect(branchNameFor('anything', 'x')).not.toMatch(/^agents-ui\//)
    expect(branchNameFor('anything', 'x')).toBe('anything-x')
  })

  it('strips characters git will not accept', () => {
    const branch = branchNameFor('Fix: the "thing" (again)!', 'id1')
    expect(branch).toBe('fix-the-thing-again-id1')
    expect(branch).not.toMatch(/[^a-z0-9/-]/)
  })

  it('never produces a trailing or doubled hyphen', () => {
    expect(branchNameFor('trailing --- ', 'id')).toBe('trailing-id')
    expect(branchNameFor('a   b', 'id')).toBe('a-b-id')
  })

  it('falls back when the title has nothing usable', () => {
    expect(branchNameFor('!!!', 'id9')).toBe('session-id9')
    expect(branchNameFor('', 'id9')).toBe('session-id9')
  })

  it('caps long titles but keeps the id, so branches stay unique', () => {
    const long = 'a'.repeat(200)
    const branch = branchNameFor(long, 'zz99')
    expect(branch.endsWith('-zz99')).toBe(true)
    expect(branch.length).toBeLessThan(70)
  })
})

describe('parseWorktreeList', () => {
  it('reads the main worktree and a session worktree', () => {
    const porcelain = [
      'worktree /Users/me/repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /Users/me/.claude/agents-ui/worktrees/repo/s1',
      'HEAD def456',
      'branch refs/heads/agents-ui/fix-login-s1',
    ].join('\n')

    expect(parseWorktreeList(porcelain)).toEqual([
      { path: '/Users/me/repo', branch: 'main', head: 'abc123', prunable: false },
      {
        path: '/Users/me/.claude/agents-ui/worktrees/repo/s1',
        branch: 'agents-ui/fix-login-s1',
        head: 'def456',
        prunable: false,
      },
    ])
  })

  it('flags a worktree whose directory has been deleted', () => {
    // These are exactly the ones a user loses track of.
    const porcelain = [
      'worktree /Users/me/gone',
      'HEAD abc',
      'branch refs/heads/agents-ui/orphan',
      'prunable gitdir file points to non-existent location',
    ].join('\n')

    expect(parseWorktreeList(porcelain)[0]!.prunable).toBe(true)
  })

  it('handles a detached HEAD', () => {
    const porcelain = ['worktree /Users/me/repo', 'HEAD abc123', 'detached'].join('\n')
    expect(parseWorktreeList(porcelain)[0]!.branch).toBeNull()
  })

  it('survives empty or malformed output', () => {
    expect(parseWorktreeList('')).toEqual([])
    expect(parseWorktreeList('\n\n')).toEqual([])
    expect(parseWorktreeList('garbage')).toEqual([])
  })

  it('tolerates extra blank lines between records', () => {
    const porcelain = 'worktree /a\nHEAD x\n\n\n\nworktree /b\nHEAD y\n'
    expect(parseWorktreeList(porcelain).map(w => w.path)).toEqual(['/a', '/b'])
  })
})

describe('looksLikeSessionWorktree', () => {
  /**
   * This is what stops `prune` — which deletes branches with `-D` — from
   * touching a worktree somebody set up by hand. It used to be the
   * `agents-ui/` branch prefix; now that branches are named plainly, it is
   * where the worktree sits.
   */
  const root = '/repo/.worktrees'

  it('claims a worktree inside this repository\'s worktree directory', () => {
    expect(looksLikeSessionWorktree(root, { canonical: '/repo/.worktrees/abc123' })).toBe(true)
  })

  it('does not claim a worktree someone made by hand elsewhere', () => {
    // The one that matters: prune would delete this branch with -D.
    expect(looksLikeSessionWorktree(root, { canonical: '/repo/../my-experiment' })).toBe(false)
    expect(looksLikeSessionWorktree(root, { canonical: '/somewhere/else' })).toBe(false)
  })

  it('does not claim the repository itself', () => {
    expect(looksLikeSessionWorktree(root, { canonical: '/repo' })).toBe(false)
  })

  it('is not fooled by a sibling whose name merely starts the same', () => {
    // Without a separator-terminated prefix, `.worktrees-old` matches
    // `.worktrees` and someone's archive gets pruned.
    expect(looksLikeSessionWorktree(root, { canonical: '/repo/.worktrees-old/keep' })).toBe(false)
  })

  it('still claims worktrees made before branches were renamed', () => {
    // Legacy layouts put these outside the repository, so only the old branch
    // prefix identifies them. Dropping it would make them invisible to both
    // cleanup and recovery.
    expect(looksLikeSessionWorktree(root, {
      canonical: '/home/me/.claude/agents-ui/worktrees/repo/s1',
      branch: 'agents-ui/fix-login-s1',
    })).toBe(true)
  })

  it('tolerates a root given with a trailing separator', () => {
    expect(looksLikeSessionWorktree('/repo/.worktrees/', { canonical: '/repo/.worktrees/x' })).toBe(true)
  })
})
