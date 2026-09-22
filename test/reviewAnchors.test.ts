import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anchorFor, describeDegraded, diffPositions, resolvePath, type DiffPositions } from '../server/utils/reviewAnchors'

/**
 * Where a finding can actually be posted.
 *
 * Real git rather than a fixture, because the thing being relied on is git's own
 * hunk arithmetic — and `--unified=0` headers are exactly where a hand-written
 * fixture would encode the bug it was meant to catch. GitHub refuses an inline
 * comment on a line outside the diff, and it refuses the *whole review* rather
 * than the one comment, so being wrong here loses the other seven findings.
 */

let repo: string
let positions: DiffPositions

function git(args: string[], cwd = repo) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'anchors-'))
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])

  // Base: two files, ten lines each.
  await writeFile(join(repo, 'kept.ts'), Array.from({ length: 10 }, (_, i) => `kept ${i + 1}`).join('\n') + '\n')
  await writeFile(join(repo, 'gone.ts'), 'gone 1\ngone 2\n')
  git(['add', '.'])
  git(['commit', '-m', 'base'])
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim()

  // Head: change line 5 of kept.ts, add a new file, delete gone.ts.
  await writeFile(
    join(repo, 'kept.ts'),
    Array.from({ length: 10 }, (_, i) => (i === 4 ? 'kept 5 changed' : `kept ${i + 1}`)).join('\n') + '\n',
  )
  await writeFile(join(repo, 'added.ts'), 'added 1\nadded 2\nadded 3\n')
  git(['rm', '--quiet', 'gone.ts'])
  git(['add', '.'])
  git(['commit', '-m', 'head'])

  positions = await diffPositions(repo, base)
})

afterAll(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('diffPositions', () => {
  it('takes the changed line and nothing around it', () => {
    // The whole point of --unified=0: with context, the hunk would claim lines
    // 2-8 and GitHub would refuse a comment on every one of them but 5.
    expect([...positions.right.get('kept.ts')!]).toEqual([5])
  })

  it('takes every line of an added file', () => {
    expect([...positions.right.get('added.ts')!].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('records a deleted file with no head-side lines to comment on', () => {
    expect(positions.files.has('gone.ts')).toBe(true)
    expect(positions.right.get('gone.ts')).toBeUndefined()
    expect([...positions.left.get('gone.ts')!].sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('keeps the removed line on the base side', () => {
    expect([...positions.left.get('kept.ts')!]).toEqual([5])
  })
})

describe('anchorFor', () => {
  it('anchors a finding on a changed line inline', () => {
    expect(anchorFor({ path: 'kept.ts', line: 5, location: 'kept.ts:5' }, positions)).toEqual({
      kind: 'inline',
      path: 'kept.ts',
      line: 5,
      side: 'RIGHT',
    })
  })

  /**
   * A real thing to say about a diff — "this is about the caller you did not
   * touch" — and the reason it degrades rather than being nudged onto the
   * nearest changed line: a comment on the wrong line is worse than a comment
   * on no line.
   */
  it('degrades to the file when the line is not in the diff', () => {
    const anchor = anchorFor({ path: 'kept.ts', line: 9, location: 'kept.ts:9' }, positions)
    expect(anchor.kind).toBe('file')
    expect(anchor.reason).toContain('line 9 of kept.ts is not in this diff')
  })

  it('degrades to the summary when the file is not in the diff at all', () => {
    const anchor = anchorFor({ path: 'elsewhere.ts', line: 3, location: 'elsewhere.ts:3' }, positions)
    expect(anchor.kind).toBe('summary')
    expect(anchor.reason).toContain('not in this diff')
  })

  it('degrades to the summary when the finding named no file', () => {
    const anchor = anchorFor({ location: 'the whole migration' }, positions)
    expect(anchor.kind).toBe('summary')
    expect(anchor.reason).toContain('the whole migration')
  })

  it('posts a whole-file finding against the file', () => {
    expect(anchorFor({ path: 'added.ts', location: 'added.ts' }, positions).kind).toBe('file')
  })

  it('anchors a finding about a deleted line to the base side', () => {
    expect(anchorFor({ path: 'gone.ts', line: 2, location: 'gone.ts:2' }, positions)).toMatchObject({
      kind: 'inline',
      side: 'LEFT',
    })
  })
})

/**
 * The bug this was written for: every finding in a monorepo folded into the
 * summary and the send button offered nought comments, because reports write
 * `email-collector.ts` and the diff is keyed `packages/server/src/…`.
 */
describe('resolvePath', () => {
  const positions = (...files: string[]): DiffPositions =>
    ({ right: new Map(), left: new Map(), files: new Set(files) })

  it('takes a repository-relative path as it stands', () => {
    expect(resolvePath('packages/server/src/mail.ts', positions('packages/server/src/mail.ts')))
      .toEqual({ path: 'packages/server/src/mail.ts' })
  })

  it('resolves a bare filename onto the one file in the diff that ends with it', () => {
    expect(resolvePath('mail.ts', positions('packages/server/src/mail.ts', 'web/other.ts')))
      .toEqual({ path: 'packages/server/src/mail.ts' })
  })

  it('resolves a partial path the same way', () => {
    expect(resolvePath('src/mail.ts', positions('packages/server/src/mail.ts')))
      .toEqual({ path: 'packages/server/src/mail.ts' })
  })

  /** Two candidates is a guess, and this file does not guess. */
  it('refuses a name that two files in the diff could be', () => {
    const resolved = resolvePath('mail.ts', positions('packages/server/mail.ts', 'packages/web/mail.ts'))
    expect(resolved.path).toBeUndefined()
    expect(resolved.ambiguous).toContain('matches 2 files')
    expect(resolved.ambiguous).toContain('packages/web/mail.ts')
  })

  /** A suffix that is not a whole segment is a different file. */
  it('does not let a name claim a file it is only the tail of', () => {
    expect(resolvePath('collector.ts', positions('src/email-collector.ts'))).toEqual({})
  })

  it('says nothing when the diff holds no such file', () => {
    expect(resolvePath('absent.ts', positions('src/mail.ts'))).toEqual({})
  })
})

describe('anchorFor, against a path the report shortened', () => {
  it('anchors inline on the resolved path', () => {
    const anchor = anchorFor({ path: 'kept.ts', line: 5, location: 'kept.ts:5' }, positions)
    expect(anchor).toMatchObject({ kind: 'inline', path: 'kept.ts', line: 5 })
  })

  it('reports the ambiguity rather than the absence', () => {
    const two: DiffPositions = {
      right: new Map(),
      left: new Map(),
      files: new Set(['a/mail.ts', 'b/mail.ts']),
    }
    const anchor = anchorFor({ path: 'mail.ts', line: 3, location: 'mail.ts:3' }, two)
    expect(anchor.kind).toBe('summary')
    expect(anchor.reason).toContain('matches 2 files')
  })

  /** The anchor carries the real path, because that is what gets posted. */
  it('carries the resolved path, not the one the report wrote', () => {
    const deep: DiffPositions = {
      right: new Map([['packages/server/src/mail.ts', new Set([12])]]),
      left: new Map(),
      files: new Set(['packages/server/src/mail.ts']),
    }
    expect(anchorFor({ path: 'mail.ts', line: 12, location: 'mail.ts:12' }, deep)).toEqual({
      kind: 'inline',
      path: 'packages/server/src/mail.ts',
      line: 12,
      side: 'RIGHT',
    })
  })
})

describe('describeDegraded', () => {
  /** Silent truncation is the failure this whole feature exists to avoid. */
  it('names what moved and why, rather than counting it', () => {
    const text = describeDegraded([
      { location: 'kept.ts:5', anchor: { kind: 'inline' } },
      { location: 'migrations/0042.sql', anchor: { kind: 'summary', reason: 'not in this diff' } },
    ])!
    expect(text).toContain('One finding could not be attached')
    expect(text).toContain('migrations/0042.sql')
    expect(text).toContain('not in this diff')
    expect(text).not.toContain('kept.ts:5')
  })

  it('says nothing when everything anchored', () => {
    expect(describeDegraded([{ location: 'a.ts:1', anchor: { kind: 'inline' } }])).toBeNull()
  })
})
