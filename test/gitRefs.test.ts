import { describe, expect, it } from 'vitest'
import { parseBranchRefs } from '../server/utils/gitRefs'

/**
 * A picker is only worth having if what it offers is right. The ways this list
 * goes wrong are all quiet ones — the same branch twice under two spellings, a
 * symbolic ref offered as though it were a branch, or a path-shaped name cut in
 * half by stripping the wrong prefix.
 */

const SEP = '\x1f'

/** Real `for-each-ref` output from this repository, separators restored. */
const REAL = [
  `*${SEP}refs/heads/main${SEP}1786351943${SEP}build: 0.2.0`,
  ` ${SEP}refs/remotes/origin/HEAD${SEP}1786351943${SEP}build: 0.2.0`,
  ` ${SEP}refs/remotes/origin/main${SEP}1786351943${SEP}build: 0.2.0`,
  ` ${SEP}refs/heads/docs/readme-rebrand${SEP}1785764786${SEP}docs: rewrite the README`,
  ` ${SEP}refs/remotes/origin/docs/readme-rebrand${SEP}1785764786${SEP}docs: rewrite the README`,
].join('\n')

describe('the branches on offer', () => {
  it('offers each branch once, however many places it exists', () => {
    const branches = parseBranchRefs(REAL)

    expect(branches.map(b => b.name)).toEqual(['main', 'docs/readme-rebrand'])
  })

  it('does not offer origin/HEAD, which is a pointer rather than a branch', () => {
    expect(parseBranchRefs(REAL).some(b => b.name === 'HEAD')).toBe(false)
  })

  it('keeps a path-shaped name whole', () => {
    // Stripping the remote must take `origin/` and stop, not the first segment
    // of everything — `docs/readme-rebrand` is the branch, not `readme-rebrand`.
    expect(parseBranchRefs(REAL).map(b => b.name)).toContain('docs/readme-rebrand')
  })

  it('marks the branch that is checked out', () => {
    const main = parseBranchRefs(REAL).find(b => b.name === 'main')

    expect(main?.current).toBe(true)
    expect(main?.remoteOnly).toBe(false)
  })

  it('says when a branch is only on the remote, since picking it creates it here', () => {
    const branches = parseBranchRefs(
      ` ${SEP}refs/remotes/origin/someone-elses${SEP}1785000000${SEP}their work`,
    )

    expect(branches[0]).toMatchObject({ name: 'someone-elses', remoteOnly: true })
  })

  it('prefers the local branch even when the remote copy is listed first', () => {
    // `for-each-ref` sorts by date, and the two share one, so either can come
    // first. The local one has to win regardless.
    const branches = parseBranchRefs([
      ` ${SEP}refs/remotes/origin/shared${SEP}1785000000${SEP}a commit`,
      ` ${SEP}refs/heads/shared${SEP}1785000000${SEP}a commit`,
    ].join('\n'))

    expect(branches).toHaveLength(1)
    expect(branches[0]!.remoteOnly).toBe(false)
  })

  it('orders by most recent commit, so the plausible answers are at the top', () => {
    const branches = parseBranchRefs([
      ` ${SEP}refs/heads/old${SEP}1000${SEP}older`,
      ` ${SEP}refs/heads/new${SEP}2000${SEP}newer`,
    ].join('\n'))

    expect(branches.map(b => b.name)).toEqual(['new', 'old'])
  })

  it('survives a repository with no refs at all', () => {
    expect(parseBranchRefs('')).toEqual([])
  })

  it('keeps a commit subject containing anything but the separator', () => {
    const branches = parseBranchRefs(
      ` ${SEP}refs/heads/odd${SEP}1000${SEP}fix: a|b, "c" — d/e`,
    )

    expect(branches[0]!.subject).toBe('fix: a|b, "c" — d/e')
  })

  it('handles a remote whose name is not origin', () => {
    const branches = parseBranchRefs(
      ` ${SEP}refs/remotes/upstream/theirs${SEP}1000${SEP}work`,
    )

    expect(branches[0]!.name).toBe('theirs')
  })
})
