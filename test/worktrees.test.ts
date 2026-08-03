import { describe, expect, it } from 'vitest'
import { branchNameFor, parseWorktreeList } from '../server/utils/worktrees'

describe('branchNameFor', () => {
  it('builds a readable branch from the session title', () => {
    expect(branchNameFor('Fix the login bug', 'abc123')).toBe('agents-ui/fix-the-login-bug-abc123')
  })

  it('namespaces everything under agents-ui/ so sessions are identifiable', () => {
    // Someone scanning `git branch` should be able to tell what made these.
    expect(branchNameFor('anything', 'x')).toMatch(/^agents-ui\//)
  })

  it('strips characters git will not accept', () => {
    const branch = branchNameFor('Fix: the "thing" (again)!', 'id1')
    expect(branch).toBe('agents-ui/fix-the-thing-again-id1')
    expect(branch).not.toMatch(/[^a-z0-9/-]/)
  })

  it('never produces a trailing or doubled hyphen', () => {
    expect(branchNameFor('trailing --- ', 'id')).toBe('agents-ui/trailing-id')
    expect(branchNameFor('a   b', 'id')).toBe('agents-ui/a-b-id')
  })

  it('falls back when the title has nothing usable', () => {
    expect(branchNameFor('!!!', 'id9')).toBe('agents-ui/session-id9')
    expect(branchNameFor('', 'id9')).toBe('agents-ui/session-id9')
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
