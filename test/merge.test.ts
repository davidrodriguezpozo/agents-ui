import { describe, expect, it } from 'vitest'
import { mergeRefusal, parseMergeTreeConflicts } from '../server/utils/merge'
import type { Session } from '../server/utils/sessions'

/**
 * The two refusals that have to come before anything is written.
 *
 * Both are a record and a workspace disagreeing, and they are opposite mistakes
 * about it — which is why neither can be found in the commit count:
 *
 *  - A **drifted** session's count is zero, because it never committed to the
 *    branch on record, so the preview would say "has not committed anything yet"
 *    over a worktree holding real work.
 *  - A **review** session's count is healthy and belongs to somebody else, so the
 *    preview would happily offer to merge a colleague's pull request branch into
 *    the local base.
 *
 * The worktree paths below do not exist, which is the point: `git` fails, the
 * checkout reads as unknown, and unknown must never be treated as drift. What is
 * left is the answer that comes from the record alone.
 */

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'msy9ux9alyfo',
    title: 'Review it',
    repoDir: '/nowhere/repo',
    worktreePath: '/nowhere/repo/.worktrees/msy9ux9alyfo',
    branch: 'feat/somebody-elses-work',
    baseBranch: 'master',
    baseSha: 'abc123',
    status: 'idle',
    runIds: [],
    createdAt: 1,
    updatedAt: 2,
    ...over,
  } as Session
}

describe('mergeRefusal', () => {
  it('refuses a review workspace, which holds nobody’s work but the author’s', async () => {
    const refusal = await mergeRefusal(session({ detached: true }))

    expect(refusal?.blockedBy).toBe('read-only')
    expect(refusal?.reason).toContain('feat/somebody-elses-work')
    // Says where it *can* be merged, since the answer is not "nowhere".
    expect(refusal?.reason).toMatch(/Land|github\.com/)
  })

  it('lets an ordinary session through to the rest of the preview', async () => {
    // Nothing about a session whose record and workspace agree is this
    // function's business, and answering here would block every merge.
    expect(await mergeRefusal(session())).toBeNull()
  })
})

describe('parseMergeTreeConflicts', () => {
  it('reads the conflicted paths and ignores the messages after them', () => {
    // Counting the message line as a path reports one conflict as two.
    const stdout = [
      'e6f6afc62606c0b6803b0bf5b2c3114e578ed09b',
      'file.txt',
      '',
      'CONFLICT (content): Merge conflict in file.txt',
    ].join('\n')

    expect(parseMergeTreeConflicts(stdout)).toEqual(['file.txt'])
  })

  it('handles several conflicted files', () => {
    const stdout = [
      'abc123',
      'src/a.ts',
      'src/b.ts',
      '',
      'CONFLICT (content): Merge conflict in src/a.ts',
      'CONFLICT (content): Merge conflict in src/b.ts',
    ].join('\n')

    expect(parseMergeTreeConflicts(stdout)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('drops noise even when git omits the blank separator', () => {
    const stdout = ['abc123', 'Auto-merging file.txt', 'CONFLICT (content): boom'].join('\n')
    expect(parseMergeTreeConflicts(stdout)).toEqual([])
  })

  it('returns nothing for a clean merge or empty output', () => {
    expect(parseMergeTreeConflicts('abc123')).toEqual([])
    expect(parseMergeTreeConflicts('')).toEqual([])
  })
})
