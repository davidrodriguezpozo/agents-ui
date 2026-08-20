import { describe, expect, it } from 'vitest'
import { fileAt, patchFiles, patchSummary, stepFile } from '../diff'

const PATCH = [
  'diff --git a/app/one.ts b/app/one.ts',
  'index 111..222 100644',
  '--- a/app/one.ts',
  '+++ b/app/one.ts',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '+added',
  '-removed',
  'diff --git a/server/two.ts b/server/two.ts',
  '--- a/server/two.ts',
  '+++ b/server/two.ts',
  '@@ -1 +1 @@',
  '+only',
].join('\n')

describe('patchFiles', () => {
  it('finds each file, where it starts, and how much moved', () => {
    const files = patchFiles(PATCH)
    expect(files).toEqual([
      { path: 'app/one.ts', start: 0, added: 1, removed: 1 },
      { path: 'server/two.ts', start: 8, added: 1, removed: 0 },
    ])
  })

  it('does not count the file markers as changed lines', () => {
    expect(patchSummary(patchFiles(PATCH))).toBe('2 files  +2/−1')
  })

  it('has nothing to say about an empty patch', () => {
    expect(patchFiles('')).toEqual([])
    expect(patchSummary([])).toBe('no changes')
  })
})

describe('fileAt', () => {
  it('names the file a line belongs to', () => {
    const files = patchFiles(PATCH)
    expect(fileAt(files, 0)?.path).toBe('app/one.ts')
    expect(fileAt(files, 6)?.path).toBe('app/one.ts')
    expect(fileAt(files, 8)?.path).toBe('server/two.ts')
    expect(fileAt(files, 99)?.path).toBe('server/two.ts')
  })
})

describe('stepFile', () => {
  const files = patchFiles(PATCH)

  it('walks forwards to the next file, and stops at the end', () => {
    expect(stepFile(files, 0, 1)).toBe(8)
    expect(stepFile(files, 8, 1)).toBeNull()
  })

  it('goes to the top of this file before the one before it', () => {
    expect(stepFile(files, 6, -1)).toBe(0)
    expect(stepFile(files, 10, -1)).toBe(8)
    expect(stepFile(files, 8, -1)).toBe(0)
    expect(stepFile(files, 0, -1)).toBeNull()
  })

  it('has nowhere to go in an empty patch', () => {
    expect(stepFile([], 0, 1)).toBeNull()
  })
})
