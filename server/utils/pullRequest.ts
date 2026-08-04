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
