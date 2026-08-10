import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * The branches and pull requests you could mean, so you do not have to type one
 * from memory.
 *
 * Every place this app asks for a ref was a free-text box. That is the wrong
 * shape for the question twice over: the answer is nearly always one of a known
 * list, and a name typed slightly wrong does not fail loudly — a trigger set to
 * watch `feature/foo` when the branch is `feature/Foo` simply never fires, and
 * looks identical to a trigger with nothing to do.
 *
 * Read-only, and free text is never taken away: a branch that does not exist
 * yet, or a pull request in a repository this checkout has no remote for, still
 * has to be typeable. This narrows the common case rather than closing the
 * uncommon one.
 */

export interface BranchRef {
  name: string
  /** Unix seconds of its last commit, which is what the ordering is by. */
  updatedAt: number
  subject: string
  /** Only on a remote so far. Checking it out is what creates it here. */
  remoteOnly: boolean
  /** The one checked out in the repository itself. */
  current: boolean
}

export interface PullRequestRef {
  number: number
  title: string
  url: string
  headBranch: string
  draft: boolean
}

/**
 * Most branches offered.
 *
 * A long-lived repository has thousands of remote refs and a list that long is
 * not a list any more. They are sorted by most recent commit first, which puts
 * anything somebody is plausibly about to pick in the first handful — and the
 * box is still free text for the rest.
 */
const MAX_BRANCHES = 200

/** A unit separator: a commit subject can contain anything else. */
const SEP = '\x1f'

/**
 * Local branches and remote ones, newest commit first.
 *
 * `%(HEAD)` marks the checked-out branch, which saves a second call to ask.
 * Remote refs are included because "continue somebody's branch" is a thing
 * people do with a branch they have not fetched into a local one yet — but a
 * remote copy of a branch that exists locally is not a second option, so the
 * local one wins and the remote duplicate is dropped.
 */
export async function listBranches(repoDir: string): Promise<BranchRef[]> {
  if (!repoDir || !existsSync(repoDir)) return []

  try {
    const { stdout } = await exec('git', [
      'for-each-ref',
      '--sort=-committerdate',
      `--format=%(HEAD)${SEP}%(refname)${SEP}%(committerdate:unix)${SEP}%(contents:subject)`,
      'refs/heads',
      'refs/remotes',
    ], { cwd: repoDir, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })

    return parseBranchRefs(stdout)
  } catch {
    // Not a repository, no refs, git missing. All the same answer: nothing to
    // offer, and the field stays free text.
    return []
  }
}

/**
 * The ref list, from what `for-each-ref` printed.
 *
 * Split from the call so the awkward half can be tested without a repository —
 * and the awkward half is all of it: which of two spellings of the same branch
 * wins, and which refs are not branches at all.
 */
export function parseBranchRefs(stdout: string): BranchRef[] {
  const byName = new Map<string, BranchRef>()

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue

    const [head = '', refname = '', at = '', subject = ''] = line.split(SEP)
    if (!refname) continue

    const local = refname.startsWith('refs/heads/')
    const name = local
      ? refname.slice('refs/heads/'.length)
      // `refs/remotes/origin/foo` → `foo`. The remote name is dropped because
      // it is not part of the branch, and keeping it would offer the same
      // branch twice under two spellings.
      : refname.replace(/^refs\/remotes\/[^/]+\//, '')

    // `origin/HEAD` is a symbolic pointer at the default branch, not a branch.
    if (!name || name === 'HEAD') continue

    const existing = byName.get(name)
    // A local branch always wins over the remote copy of the same name.
    if (existing && (!existing.remoteOnly || !local)) continue

    byName.set(name, {
      name,
      updatedAt: Number(at) || 0,
      subject,
      remoteOnly: !local,
      current: head === '*',
    })
  }

  return [...byName.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_BRANCHES)
}

/**
 * Open pull requests, or null when GitHub could not be asked.
 *
 * Null and empty are deliberately different: "there are none open" is a fact
 * worth showing, and "`gh` is not installed or not signed in" is a reason the
 * list is missing. Telling somebody there are no pull requests when really we
 * never asked is how a picker teaches you not to trust it.
 */
export async function listOpenPullRequests(repoDir: string): Promise<PullRequestRef[] | null> {
  if (!repoDir || !existsSync(repoDir)) return null

  try {
    const { stdout } = await exec('gh', [
      'pr', 'list', '--state', 'open', '--limit', '50',
      '--json', 'number,title,url,headRefName,isDraft',
    ], { cwd: repoDir, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })

    const rows = JSON.parse(stdout || '[]') as {
      number?: number
      title?: string
      url?: string
      headRefName?: string
      isDraft?: boolean
    }[]

    if (!Array.isArray(rows)) return null

    return rows
      .filter(row => typeof row.number === 'number' && row.url)
      .map(row => ({
        number: row.number!,
        title: row.title ?? '(untitled)',
        url: row.url!,
        headBranch: row.headRefName ?? '',
        draft: Boolean(row.isDraft),
      }))
  } catch {
    return null
  }
}
