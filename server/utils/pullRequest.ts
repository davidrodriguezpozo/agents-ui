import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * Turning a session into a pull request.
 *
 * A session ends with a branch nobody else can see. Merging puts it in your own
 * checkout, which is the right answer when the work is yours to land and the
 * wrong one when somebody has to look at it first. This is the other ending.
 *
 * Everything here is `git` and `gh` doing what you would have typed. Nothing is
 * pushed or opened until the endpoint is asked to, and the preview says exactly
 * what will happen first — this is the one action in the app that other people
 * can see.
 */

export interface Commit {
  sha: string
  subject: string
}

export interface PullRequestPreview {
  canOpen: boolean
  /** Why not, in a sentence someone can act on. */
  blockedReason?: string
  baseBranch: string
  branch: string
  commits: Commit[]
  uncommittedFiles: string[]
  files: string[]
  remote: string | null
  /** Set when this branch already has one, so we offer to open it instead. */
  existingUrl?: string
  suggestedTitle: string
  suggestedBody: string
}

/**
 * One commit is its own title; several need the session's name, because the
 * first commit subject describes a step rather than the whole change.
 */
export function suggestTitle(sessionTitle: string, commits: Commit[]): string {
  if (commits.length === 1 && commits[0]) return commits[0].subject
  return sessionTitle
}

/**
 * A body that says what changed and what was touched, and admits how it was
 * written. Anyone reviewing this should know an agent produced it — not to
 * discount it, but because it changes what you look for.
 */
export function suggestBody(commits: Commit[], files: string[]): string {
  const sections: string[] = []

  if (commits.length > 1) {
    sections.push(`## Commits\n\n${commits.map(c => `- ${c.subject}`).join('\n')}`)
  }

  if (files.length) {
    const listed = files.slice(0, 20).map(f => `- \`${f}\``).join('\n')
    const more = files.length > 20 ? `\n- …and ${files.length - 20} more` : ''
    sections.push(`## Files\n\n${listed}${more}`)
  }

  sections.push('---\n\nWritten in a Claude Code session, reviewed before opening.')

  return sections.join('\n\n')
}

/**
 * What someone pasted.
 *
 * One field takes both, because the answer to "start from what?" is a pull
 * request URL about as often as it is a branch name, and making people choose
 * a category first is a form standing between them and the work.
 */
export type StartRef =
  | { kind: 'pr'; ref: string }
  | { kind: 'branch'; ref: string }

export function parseStartRef(input: string): StartRef | null {
  const value = input.trim()
  if (!value) return null

  // Any GitHub pull request URL, including enterprise hosts and trailing paths
  // like /files or /commits that come from copying the address bar.
  const url = value.match(/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/(\d+)/)
  if (url) return { kind: 'pr', ref: url[1]! }

  // `#123` or a bare number, the way people refer to one in conversation.
  const number = value.match(/^#?(\d+)$/)
  if (number) return { kind: 'pr', ref: number[1]! }

  // `origin/feature-x` names a remote-tracking ref; the branch is the tail.
  // Only the conventional remote names are stripped: guessing that the first
  // segment of anything is a remote would turn the real branch
  // `feature/team/thing` into `team/thing`.
  return {
    kind: 'branch',
    ref: value.replace(/^remotes\//, '').replace(/^(origin|upstream)\//, ''),
  }
}

export interface ResolvedPullRequest {
  number: number
  title: string
  url: string
  headBranch: string
  baseBranch: string
  state: string
  isFork: boolean
}

async function git(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 })
  return stdout.trim()
}

async function gh(cwd: string, args: string[], timeout = 60_000): Promise<string> {
  const { stdout } = await exec('gh', args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 })
  return stdout.trim()
}

/** Present and signed in are different failures, and both are worth naming. */
export async function ghReady(cwd: string): Promise<{ ready: boolean; reason?: string }> {
  try {
    await exec('gh', ['--version'], { timeout: 10_000 })
  } catch {
    return { ready: false, reason: 'The GitHub CLI (`gh`) is not installed, so a pull request cannot be opened from here.' }
  }

  try {
    await gh(cwd, ['auth', 'status'], 20_000)
    return { ready: true }
  } catch {
    return { ready: false, reason: 'The GitHub CLI is installed but not signed in. Run `gh auth login` and try again.' }
  }
}

export async function commitsBetween(cwd: string, baseRef: string, branch: string): Promise<Commit[]> {
  const raw = await git(cwd, ['log', '--format=%H%x1f%s', `${baseRef}..${branch}`]).catch(() => '')

  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      // A unit separator, because a commit subject can contain anything else.
      const [sha = '', subject = ''] = line.split('\x1f')
      return { sha, subject }
    })
    .filter(commit => commit.sha)
}

/** Read-only: asks GitHub whether this branch already has one open. */
export async function existingPullRequest(cwd: string, branch: string): Promise<string | null> {
  try {
    const raw = await gh(cwd, ['pr', 'view', branch, '--json', 'url,state'])
    const parsed = JSON.parse(raw) as { url?: string; state?: string }
    return parsed.state === 'OPEN' ? parsed.url ?? null : null
  } catch {
    // No pull request, no remote branch, or no network. All the same answer.
    return null
  }
}

/** Ask GitHub what this pull request is. Read-only. */
export async function resolvePullRequest(cwd: string, ref: string): Promise<ResolvedPullRequest> {
  let raw: string
  try {
    raw = await gh(cwd, [
      'pr', 'view', ref,
      '--json', 'number,title,url,headRefName,baseRefName,state,isCrossRepository',
    ])
  } catch (e) {
    throw createError({
      statusCode: 404,
      data: {
        error: 'pr_not_found',
        message: `Could not find pull request ${ref} in this repository: ${String((e as { stderr?: string }).stderr ?? '').trim()}`,
      },
    })
  }

  const parsed = JSON.parse(raw) as {
    number: number
    title: string
    url: string
    headRefName: string
    baseRefName: string
    state: string
    isCrossRepository: boolean
  }

  return {
    number: parsed.number,
    title: parsed.title,
    url: parsed.url,
    headBranch: parsed.headRefName,
    baseBranch: parsed.baseRefName,
    state: parsed.state,
    isFork: parsed.isCrossRepository,
  }
}

/**
 * Bring a pull request's commits down as a local branch.
 *
 * Fetched through `pull/N/head` rather than by branch name, because that ref
 * exists whether the pull request comes from this repository or from someone's
 * fork — and a fork's branch is on a remote you do not have.
 */
export async function fetchPullRequestBranch(
  cwd: string,
  remote: string,
  number: number,
  branch: string,
): Promise<void> {
  const exists = await git(cwd, ['rev-parse', '--verify', `refs/heads/${branch}`])
    .then(() => true)
    .catch(() => false)

  // Already local: leave it alone rather than force it, since it may hold work
  // that has not been pushed.
  if (exists) return

  try {
    await git(cwd, ['fetch', remote, `pull/${number}/head:${branch}`], 180_000)
  } catch (e) {
    throw createError({
      statusCode: 502,
      data: {
        error: 'fetch_failed',
        message: `Could not fetch pull request #${number}: ${String((e as { stderr?: string }).stderr ?? '').trim()}`,
      },
    })
  }
}

export async function defaultRemote(cwd: string): Promise<string | null> {
  const remotes = await git(cwd, ['remote']).catch(() => '')
  const names = remotes.split('\n').filter(Boolean)
  if (!names.length) return null
  return names.includes('origin') ? 'origin' : names[0]!
}

/**
 * Push the branch and open the request. Committing first is opt-in for the
 * same reason it is on merge: uncommitted work is invisible to both, and
 * sweeping it up silently is not a decision this should make for you.
 */
export async function openPullRequest(options: {
  cwd: string
  branch: string
  baseBranch: string
  remote: string
  title: string
  body: string
  commitFirst?: boolean
  commitMessage?: string
  draft?: boolean
}): Promise<{ url: string; committed: boolean }> {
  const { cwd, branch, baseBranch, remote, title, body } = options
  let committed = false

  if (options.commitFirst) {
    const dirty = await git(cwd, ['status', '--porcelain'])
    if (dirty) {
      await git(cwd, ['add', '-A'])
      await git(cwd, ['commit', '-m', options.commitMessage || title])
      committed = true
    }
  }

  await git(cwd, ['push', '-u', remote, branch], 120_000)

  const url = await gh(cwd, [
    'pr', 'create',
    '--base', baseBranch,
    '--head', branch,
    '--title', title,
    '--body', body,
    ...(options.draft ? ['--draft'] : []),
  ], 120_000)

  // `gh` prints the URL on the last line, sometimes after other chatter.
  const printed = url.split('\n').filter(Boolean).pop() ?? ''
  return { url: printed.trim(), committed }
}
