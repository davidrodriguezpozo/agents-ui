import { describe, expect, it } from 'vitest'
import { describeOverlap, findOverlaps, type OverlapInput } from '../app/utils/overlap'

/**
 * Two sessions changing the same file.
 *
 * `behind` answers this once something has merged. Before that — which is the
 * only point at which knowing is cheap — nothing did. The tests are mostly about
 * what must *not* be reported: a badge that fires on finished work is noise, and
 * noise on a fact nobody has to act on is how the fact stops being read.
 */

function session(over: Partial<OverlapInput> & { id: string }): OverlapInput {
  return {
    title: over.id,
    repoDir: '/repo',
    status: 'idle',
    worktree: { exists: true, changedPaths: [] },
    ...over,
  }
}

describe('findOverlaps', () => {
  it('finds two sessions on the same file', () => {
    const overlaps = findOverlaps([
      session({ id: 'a', worktree: { exists: true, changedPaths: ['src/cache.ts', 'src/a.ts'] } }),
      session({ id: 'b', worktree: { exists: true, changedPaths: ['src/cache.ts', 'src/b.ts'] } }),
    ])
    expect(overlaps.get('a')).toEqual([
      { sessionId: 'b', title: 'b', files: ['src/cache.ts'], total: 1 },
    ])
    // Symmetric: both rows should say it, not only the first.
    expect(overlaps.get('b')![0]!.sessionId).toBe('a')
  })

  it('says nothing when they touch different files', () => {
    const overlaps = findOverlaps([
      session({ id: 'a', worktree: { exists: true, changedPaths: ['src/a.ts'] } }),
      session({ id: 'b', worktree: { exists: true, changedPaths: ['src/b.ts'] } }),
    ])
    expect(overlaps.size).toBe(0)
  })

  it('does not cross repositories', () => {
    const overlaps = findOverlaps([
      session({ id: 'a', repoDir: '/one', worktree: { exists: true, changedPaths: ['src/cache.ts'] } }),
      session({ id: 'b', repoDir: '/two', worktree: { exists: true, changedPaths: ['src/cache.ts'] } }),
    ])
    expect(overlaps.size).toBe(0)
  })

  /** A review holds a commit and will never merge, so it cannot collide. */
  it('leaves a review session out', () => {
    const overlaps = findOverlaps([
      session({ id: 'a', worktree: { exists: true, changedPaths: ['src/cache.ts'] } }),
      session({ id: 'review', detached: true, worktree: { exists: true, changedPaths: ['src/cache.ts'] } }),
    ])
    expect(overlaps.size).toBe(0)
  })

  it('leaves work that has already landed out', () => {
    const overlaps = findOverlaps([
      session({ id: 'a', worktree: { exists: true, changedPaths: ['src/cache.ts'] } }),
      session({ id: 'done', landed: true, worktree: { exists: true, changedPaths: ['src/cache.ts'] } }),
    ])
    expect(overlaps.size).toBe(0)
  })

  it('leaves an archived session and a missing workspace out', () => {
    const overlaps = findOverlaps([
      session({ id: 'a', worktree: { exists: true, changedPaths: ['src/cache.ts'] } }),
      session({ id: 'archived', status: 'archived', worktree: { exists: true, changedPaths: ['src/cache.ts'] } }),
      session({ id: 'gone', worktree: { exists: false, changedPaths: ['src/cache.ts'] } }),
    ])
    expect(overlaps.size).toBe(0)
  })

  it('puts the session sharing most files first', () => {
    const overlaps = findOverlaps([
      session({ id: 'a', worktree: { exists: true, changedPaths: ['x.ts', 'y.ts', 'z.ts'] } }),
      session({ id: 'lock', worktree: { exists: true, changedPaths: ['x.ts'] } }),
      session({ id: 'deep', worktree: { exists: true, changedPaths: ['x.ts', 'y.ts', 'z.ts'] } }),
    ])
    expect(overlaps.get('a')!.map(o => o.sessionId)).toEqual(['deep', 'lock'])
  })

  it('names only the first few files', () => {
    const many = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']
    const overlaps = findOverlaps([
      session({ id: 'a', worktree: { exists: true, changedPaths: many } }),
      session({ id: 'b', worktree: { exists: true, changedPaths: many } }),
    ])
    expect(overlaps.get('a')![0]!.files).toHaveLength(3)
    expect(overlaps.get('a')![0]!.total).toBe(5)
  })
})

describe('describeOverlap', () => {
  /** "2 files" is not something anybody can act on. */
  it('names the file and the other session', () => {
    expect(describeOverlap([{ sessionId: 'b', title: 'Fix the cache', files: ['src/cache.ts'], total: 1 }]))
      .toBe('Also being changed by "Fix the cache" — `src/cache.ts`')
  })

  it('counts the files when there are several', () => {
    expect(describeOverlap([{ sessionId: 'b', title: 'Fix the cache', files: ['a.ts', 'b.ts'], total: 2 }]))
      .toContain('2 files')
  })

  it('leads with the count when several sessions are involved', () => {
    const text = describeOverlap([
      { sessionId: 'b', title: 'B', files: ['a.ts'], total: 1 },
      { sessionId: 'c', title: 'C', files: ['a.ts'], total: 1 },
    ])
    expect(text).toBe('2 other sessions change `a.ts`')
  })
})
