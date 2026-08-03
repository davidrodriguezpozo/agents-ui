import { describe, expect, it } from 'vitest'
import { parseMergeTreeConflicts } from '../server/utils/merge'

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
