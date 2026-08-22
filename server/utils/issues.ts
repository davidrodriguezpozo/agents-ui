import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { readSessions, type Session } from './sessions'
import type { PullsRefusal } from './reviews'

const exec = promisify(execFile)

/**
 * The issues in this repository that are yours to pick up.
 *
 * `eventTriggers.ts` has been able to *start* work from an issue since rituals
 * learned about `issue_labelled` — but only ever unattended, only ever the
 * moment the label lands, and never in a way anybody could look at. So an issue
 * a colleague filed and labelled at four in the afternoon either fired a ritual
 * you did not watch or vanished, and the app had no answer at all to "what has
 * been asked of me". Every product in this field starts from a ticket; this one
 * started from a branch, and the gap was the whole of the beginning of a piece
 * of work.
 *
 * This is that list, read the same way the pull requests beside it are: `gh`,
 * read-only, run in the project directory so the repository comes from the git
 * remote and the credentials are the ones `gh` already has. No token is asked
 * for and none is stored.
 *
 * **Two questions, like the pull request band.** *Assigned to me* and *carrying
 * the label* — one setting, `studio` by default. Anything else in the tracker is
 * deliberately absent, for the reason `/land` gives about not being a worse
 * GitHub in a smaller window: the row that turns into a session is what this is
 * for, and a repository's whole backlog is not.
 *
 * **Why the preamble here is not `readPulls`'s.** The two are the same four
 * steps — is `gh` installed, who are you, which repository, then list — and the
 * duplication is on purpose: every refusal below ends in a sentence about
 * issues, and a shared version would either say "pull requests" to somebody
 * looking at issues or say nothing specific to either. The copy is the part
 * worth keeping separate. The `PullsRefusal` *kinds* are shared, so a caller
 * reading both bands can tell an unconfigured folder from a broken sign-in
 * with one set of cases.
 *
 * **Nothing is written.** No comment, no label, no assignment. Brief 09 is where
 * that argument gets had.
 */

// --- What GitHub says -------------------------------------------------------

export interface IssueLabel {
  name: string
  /** GitHub's own hex, without the `#`, so labels look like labels. */
  color: string
}

export interface Issue {
  number: number
  title: string
  url: string
  /** Who filed it. */
  author: string
  assignees: string[]
  labels: IssueLabel[]
  createdAt: number
  updatedAt: number
  /** Whether you are one of the assignees. */
  assignedToYou: boolean
  /** Whether you filed it. */
  youAuthored: boolean
  /**
   * Who spoke last, or null when GitHub was not asked.
   *
   * Null is not "nobody commented" — that is the empty string case, `comments`
   * of 0 — and the difference decides whether a row may claim somebody is
   * waiting on a reply. A count that is really "we did not check" is the kind of
   * confident wrong number that costs a page its credibility.
   */
  lastCommenter: string | null
  /** Whether you have said anything on it. False when GitHub was not asked. */
  youCommented: boolean
  comments: number
  /** The session already working on it, or null. See `sessionOnIssue`. */
  session: { id: string; title: string } | null
}

/**
 * Where an issue has got to, in one word.
 *
 * Same claim the pull request band makes: a list of issues is something GitHub
 * already gives you, and it is a list of rows. What you want standing in front
 * of it is which of these is your problem right now — and that is a question
 * about the assignees, the conversation and your own machine at once.
 */
export type IssueState =
  /** Somebody said something after you did, and it was not you. */
  | 'awaiting-reply'
  /** A session on this machine already has it. */
  | 'has-session'
  /** Yours, and nothing has happened yet. */
  | 'assigned'
  /** Somebody else has it. Here because of the label, not because of you. */
  | 'assigned-elsewhere'
  /** Nobody has it. */
  | 'unassigned'

export interface IssueVerdict {
  state: IssueState
  /** The badge. Two or three words. */
  label: string
  /** The line under the title, when there is something to add. */
  detail: string
  /**
   * Whether the next move is yours.
   *
   * The band is sorted by it, so it is worth being exact: not "you could pick
   * this up", which is true of every row here, but "this does not move until you
   * do something". An unassigned issue carrying the label is an invitation and
   * an issue assigned to you is an obligation, and a band that reads them as the
   * same thing is a band whose ordering means nothing.
   */
  onYou: boolean
}

/**
 * The order the checks are made in, which is a set of judgement calls.
 *
 * **A person outranks the machine.** `awaiting-reply` is tested before
 * `has-session`, the same way `changes-requested` beats a red build over on the
 * pull requests: somebody is sat at the other end of one of those wondering
 * whether you saw it, and a session already running does not answer them.
 *
 * **"The last comment is not yours" is not enough on its own.** Read literally
 * it makes every issue anybody has ever commented on into something waiting for
 * you, including one filed by a stranger that you have never touched and that is
 * only here because it carries the label. So it also has to be *yours in some
 * way* — assigned to you, filed by you, or one you have already spoken on. That
 * is the difference between a band that says "two things are waiting on you" and
 * one that says forty.
 *
 * **Assigned to somebody else is its own verdict.** The brief named four; this
 * is the fifth, and it exists because the label query returns issues that are
 * nobody's business but a colleague's. Calling one of those "Unassigned" is a
 * badge that is simply false, and a false badge is worse than an extra one.
 */
export function issueVerdict(issue: Issue): IssueVerdict {
  const involved = issue.assignedToYou || issue.youAuthored || issue.youCommented

  // `lastCommenter` is null when the last word was yours — `withConversation`
  // has already made that comparison, so there is exactly one place in the file
  // that decides what "not yours" means.
  if (involved && issue.lastCommenter) {
    return {
      state: 'awaiting-reply',
      label: 'Waiting on a reply',
      detail: `${issue.lastCommenter} commented last`,
      onYou: true,
    }
  }

  if (issue.session) {
    return {
      state: 'has-session',
      label: 'Has a session already',
      detail: issue.session.title,
      onYou: false,
    }
  }

  if (issue.assignedToYou) {
    return {
      state: 'assigned',
      label: 'Assigned to you',
      detail: issue.comments
        ? `${issue.comments} ${issue.comments === 1 ? 'comment' : 'comments'}`
        : 'Nobody has said anything on it yet',
      onYou: true,
    }
  }

  const others = issue.assignees
  const only = others[0]
  if (only) {
    return {
      state: 'assigned-elsewhere',
      label: others.length === 1 ? `Assigned to ${only}` : `Assigned to ${others.length} people`,
      detail: 'Here because of its label, not because of you',
      onYou: false,
    }
  }

  return {
    state: 'unassigned',
    label: 'Unassigned',
    detail: 'Nobody has picked it up',
    onYou: false,
  }
}

/**
 * The order the band draws them in.
 *
 * Yours first when it is on you, then oldest first. Age rather than last
 * activity, for the reason `sortPulls` gives: the one that has not moved in a
 * week is the one going stale, and sorting by activity buries it under whatever
 * somebody commented on five minutes ago.
 */
export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const onYou = Number(issueVerdict(b).onYou) - Number(issueVerdict(a).onYou)
    return onYou || a.createdAt - b.createdAt
  })
}

/**
 * An issue with its verdict already worked out.
 *
 * Decided here and sent down rather than recomputed in the page, for the reason
 * `DecoratedPull` gives: a second implementation of the same judgement drifts
 * from the first, and two plausible answers disagreeing on one screen is worse
 * than either being absent.
 */
export interface DecoratedIssue extends Issue {
  verdict: IssueVerdict
}

export function decorateIssue(issue: Issue): DecoratedIssue {
  return { ...issue, verdict: issueVerdict(issue) }
}

// --- Which session is already on it -----------------------------------------

/**
 * Whether a branch names an issue number.
 *
 * The only join available. A pull request has a URL recorded on the session that
 * opened it; an issue has nothing of the sort, so the branch name is the whole
 * of the evidence — `42-drop-the-cache`, `fix/issue-42`, `feat/42`.
 *
 * The digit run has to match the number **as written**, which is why this
 * compares strings rather than numbers: `plan-06-issue-band` is not work on
 * issue #6, and `Number('06') === 6` would say it was. The delimiters are every
 * non-digit, so `#420` never matches #42.
 */
export function branchNamesIssue(branch: string, number: number): boolean {
  if (!branch) return false
  const wanted = String(number)
  return (branch.match(/\d+/g) ?? []).some(run => run === wanted)
}

/**
 * What this needs of a session, so a test can hand it five fields.
 *
 * `driftedTo` is optional because it is not on the stored record — the sessions
 * *endpoint* works it out from git per request, and this reads the store. A
 * caller that has already paid for that reading can pass it; `readIssues` does
 * not, and the recorded branch is the right answer for the join it is making.
 */
export type IssueSession = Pick<Session, 'id' | 'title' | 'branch' | 'status' | 'updatedAt'>
  & Partial<Pick<Session, 'repoDir'>>
  & { driftedTo?: string | null }

/**
 * The session already working on an issue, or null.
 *
 * Archived sessions are left out: their worktree is gone, so they are history
 * rather than work in progress, and a row claiming a session on an issue
 * finished last week is a row that stops the band being trusted.
 *
 * Callers pass this repository's sessions only. #42 exists in every project on
 * the machine, and a branch name is far weaker evidence than a pull request URL
 * — matching across repositories would put somebody else's work on this row.
 *
 * `driftedTo` first when it is known, for the reason `~/utils/checkout` gives:
 * that is where the commits actually are.
 */
export function sessionOnIssue(number: number, sessions: IssueSession[]): { id: string; title: string } | null {
  const live = sessions
    .filter(s => s.status !== 'archived')
    .filter(s => branchNamesIssue(s.driftedTo || s.branch, number))
    // Most recently touched first, so two sessions on one issue show the one you
    // were last in.
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const first = live[0]
  return first ? { id: first.id, title: first.title } : null
}

// --- Turning what gh says into that -----------------------------------------

/** One row of `gh issue list --json`, with everything optional. */
export interface RawIssue {
  number?: number
  title?: string
  url?: string
  author?: { login?: string; is_bot?: boolean }
  assignees?: { login?: string }[]
  labels?: { name?: string; color?: string }[]
  createdAt?: string
  updatedAt?: string
  state?: string
  /** Present only when the "issue" is really a pull request. See below. */
  isPullRequest?: boolean
  pull_request?: unknown
}

function stamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Whether a row `gh` handed back is really a pull request.
 *
 * GitHub has one table behind both, and every search that reaches it comes back
 * with both — `eventTriggers.ts` learned the same thing about
 * `repos/{owner}/{repo}/issues/events`, where a labelled pull request arrives
 * under a field called `issue`. Left in, one would appear in this band as an
 * issue number that is really a pull request number, offering to start work on a
 * ticket that does not exist.
 *
 * Three tests because the shape depends on which of GitHub's APIs answered: the
 * REST list marks it with a `pull_request` object, the GraphQL search with a
 * type, and the URL says it outright whichever of them replied. The URL is the
 * one that is always there.
 */
export function isReallyAPull(row: RawIssue): boolean {
  if (row.isPullRequest === true) return true
  if (row.pull_request !== undefined && row.pull_request !== null) return true
  return /\/pull\/\d+/.test(row.url ?? '')
}

/**
 * The rows, as issues, with the pull requests dropped.
 *
 * `viewer` decides `assignedToYou` and `youAuthored`. An empty viewer — which is
 * what an unauthenticated read would give — makes both false rather than
 * everything, so a broken sign-in produces a band that claims nothing instead of
 * a band that claims all of it is yours.
 */
export function parseIssues(rows: RawIssue[], viewer: string): Issue[] {
  return rows
    .filter(row => typeof row.number === 'number' && row.url)
    .filter(row => !isReallyAPull(row))
    .map((row) => {
      const assignees = (row.assignees ?? []).map(a => a.login).filter(Boolean) as string[]
      const author = row.author?.login ?? 'someone'

      return {
        number: row.number!,
        title: row.title ?? '(untitled)',
        url: row.url!,
        author,
        assignees,
        labels: (row.labels ?? [])
          .filter(l => l.name)
          .map(l => ({ name: l.name!, color: l.color || '888888' })),
        createdAt: stamp(row.createdAt),
        updatedAt: stamp(row.updatedAt),
        assignedToYou: Boolean(viewer) && assignees.includes(viewer),
        youAuthored: Boolean(viewer) && author === viewer,
        lastCommenter: null,
        youCommented: false,
        comments: 0,
        session: null,
      }
    })
}

/** What the conversation query found out about one issue. */
export interface Conversation {
  /** Every login that has commented, in order, most recent last. */
  commenters: string[]
  total: number
}

/**
 * An issue with what was said on it folded in.
 *
 * `lastCommenter` is left null when the last word was yours, which is what makes
 * `issueVerdict` able to test it directly: "somebody is waiting" and "you
 * answered them" are the same field, and deciding it twice is how the badge and
 * the sort order start disagreeing.
 */
export function withConversation(issue: Issue, conversation: Conversation | undefined, viewer: string): Issue {
  if (!conversation) return issue

  const last = conversation.commenters.at(-1) ?? null

  return {
    ...issue,
    comments: conversation.total,
    youCommented: Boolean(viewer) && conversation.commenters.includes(viewer),
    lastCommenter: last && last !== viewer ? last : null,
  }
}

// --- Asking gh --------------------------------------------------------------

/** Most issues read per list. Beyond this, the band is not a band. */
const LIMIT = 30

/** Fields `gh issue list` hands back without dragging comment bodies with it. */
const LIST_FIELDS = [
  'number', 'title', 'url', 'author', 'assignees', 'labels', 'createdAt', 'updatedAt',
].join(',')

async function gh(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await exec('gh', args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

async function listIssues(cwd: string, selector: string[], viewer: string): Promise<Issue[] | null> {
  try {
    const stdout = await gh(cwd, [
      'issue', 'list', '--state', 'open', '--limit', String(LIMIT),
      ...selector, '--json', LIST_FIELDS,
    ])
    const rows = JSON.parse(stdout || '[]')
    return Array.isArray(rows) ? parseIssues(rows, viewer) : null
  } catch {
    return null
  }
}

/**
 * Who has spoken on each issue, in one GraphQL round trip.
 *
 * `gh issue list --json comments` would answer this and returns every body of
 * every comment to do it — megabytes to find out one login, on a band that
 * refreshes on a timer. So it is aliased per issue, the same shape
 * `readThreadCounts` uses for pull requests, asking for nothing but authors.
 *
 * Twenty rather than one, because "did you ever speak on this" is half the
 * question — an issue you answered in March and nobody has touched since is not
 * waiting on you, and a query for the last comment alone cannot tell that from
 * an issue you have never seen.
 *
 * Failure is not an error: every issue keeps `lastCommenter: null` and the band
 * reads as though it never asked, which is the only honest fallback for a claim
 * that somebody is waiting.
 *
 * **One alias failing must not lose the other twenty-nine.** GraphQL answers a
 * partly-bad query with the data it *did* resolve alongside an `errors` array,
 * and `gh` exits non-zero when that array is there — having already printed the
 * good half to stdout. An issue transferred to another repository between the
 * list and this query is enough to trigger it. So the error path re-reads
 * whatever came back rather than throwing the batch away; see `conversationsIn`,
 * which is fed from either.
 */
async function readConversations(
  cwd: string,
  repo: { owner: string; name: string },
  numbers: number[],
): Promise<Map<number, Conversation>> {
  if (!numbers.length) return new Map()

  const aliases = numbers.map(n => `i${n}: issue(number: ${n}) { ...C }`).join('\n')
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        ${aliases}
      }
    }
    fragment C on Issue {
      number
      comments(last: 20) { totalCount nodes { author { login } } }
    }
  `

  try {
    return conversationsIn(await gh(cwd, [
      'api', 'graphql', '-f', `query=${query}`, '-F', `owner=${repo.owner}`, '-F', `name=${repo.name}`,
    ], 45_000))
  } catch (e: any) {
    // Whatever GitHub did resolve, if it resolved anything. An empty map when it
    // did not — every caller treats a missing entry as "not asked".
    return conversationsIn(typeof e?.stdout === 'string' ? e.stdout : '')
  }
}

/**
 * The aliased answer, as a map. Anything unparseable is an empty map rather
 * than a throw, because both callers above are already the failure path.
 */
export function conversationsIn(stdout: string): Map<number, Conversation> {
  const out = new Map<number, Conversation>()

  let parsed: {
    data?: {
      repository?: Record<string, {
        number?: number
        comments?: { totalCount?: number; nodes?: ({ author?: { login?: string } | null } | null)[] }
      } | null>
    }
  }
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return out
  }

  for (const node of Object.values(parsed.data?.repository ?? {})) {
    // Null is an alias GitHub could not resolve — an issue since transferred or
    // deleted. Skipped, so its neighbours in the same query still count.
    if (!node || typeof node.number !== 'number') continue

    const nodes = node.comments?.nodes ?? []
    out.set(node.number, {
      // A deleted account comes back as a null author. Dropped rather than
      // named "ghost", since nobody is waiting on the other end of one.
      commenters: nodes.map(c => c?.author?.login).filter(Boolean) as string[],
      total: node.comments?.totalCount ?? nodes.length,
    })
  }

  return out
}

/**
 * Why a reading could not be taken.
 *
 * The same five kinds `readPulls` reports, deliberately: a page drawing both
 * bands has one set of cases to write, and `not-github` stays the ordinary fact
 * about a folder rather than a fault worth warning about forever.
 */
export type IssuesRefusal = PullsRefusal

export interface IssuesReading {
  /** False when the question could not be asked, with `reason` saying why. */
  ok: boolean
  reason?: string
  refusal?: IssuesRefusal
  /** `owner/name`, so the band can say which repository it is talking about. */
  repo: string | null
  /** Your login, which is what "assigned to you" is decided against. */
  viewer: string | null
  /** The label that was asked for. The empty state names it. */
  label: string
  issues: DecoratedIssue[]
  /** How many will not move until you do something. */
  onYou: number
  /** When this was read, so the page can say how stale it is. */
  readAt: number
}

function unavailable(refusal: IssuesRefusal, reason: string, label: string): IssuesReading {
  return { ok: false, refusal, reason, repo: null, viewer: null, label, issues: [], onYou: 0, readAt: Date.now() }
}

/**
 * The issues that are yours to pick up, and what is missing when they cannot be
 * read.
 *
 * Every failure returns a reason rather than an empty list, for the reason
 * `readPulls` gives: telling somebody nothing is waiting when really nobody
 * asked is how a page teaches you not to trust it.
 *
 * `label` empty means do not ask for one — the band becomes "assigned to me"
 * alone, which is a real choice for anybody whose tracker already has a
 * convention and does not want a second one.
 */
export async function readIssues(repoDir: string | null, label: string): Promise<IssuesReading> {
  const wanted = label.trim()

  if (!repoDir || !existsSync(repoDir)) {
    return unavailable('no-project', 'Pick a project folder first — issues are read from its git remote.', wanted)
  }

  try {
    await exec('gh', ['--version'], { timeout: 10_000 })
  } catch {
    return unavailable('no-gh', 'The GitHub CLI (`gh`) is not installed, so there is nothing to read issues with.', wanted)
  }

  let viewer: string
  try {
    viewer = (await gh(repoDir, ['api', 'user', '--jq', '.login'], 20_000)).trim()
  } catch {
    return unavailable('no-auth', 'The GitHub CLI is installed but not signed in. Run `gh auth login` and try again.', wanted)
  }

  let nameWithOwner: string
  try {
    nameWithOwner = JSON.parse(await gh(repoDir, ['repo', 'view', '--json', 'nameWithOwner']))?.nameWithOwner ?? ''
  } catch {
    return unavailable('not-github', 'This project has no GitHub repository behind it, so there are no issues to read.', wanted)
  }

  const [owner = '', name = ''] = nameWithOwner.split('/')

  const [assigned, labelled] = await Promise.all([
    listIssues(repoDir, ['--assignee', '@me'], viewer),
    wanted ? listIssues(repoDir, ['--label', wanted], viewer) : Promise.resolve([]),
  ])

  if (!assigned && !labelled) {
    return unavailable(
      'unreachable',
      `GitHub could not be reached for ${nameWithOwner}. The list below is not empty — it is unknown.`,
      wanted,
    )
  }

  // One issue, not two. An issue assigned to you that also carries the label is
  // in both answers, and the number is the identity within one repository.
  const byNumber = new Map<number, Issue>()
  for (const issue of [...(assigned ?? []), ...(labelled ?? [])]) {
    if (!byNumber.has(issue.number)) byNumber.set(issue.number, issue)
  }

  const found = [...byNumber.values()]

  const conversations = await readConversations(repoDir, { owner, name }, found.map(i => i.number))

  // Sessions are read here rather than joined in the page, unlike the pull
  // requests: `workByPull` can do it client-side because both halves are already
  // loaded there, and the *verdict* does not depend on the answer. Here it does
  // — "has a session already" is one of the five states — so it has to be known
  // before the verdict is decided.
  const sessions = await readSessions().catch(() => [] as Session[])
  const here = sessions.filter(s => s.repoDir === repoDir)

  const decided = found.map((issue) => {
    const withTalk = withConversation(issue, conversations.get(issue.number), viewer)
    return { ...withTalk, session: sessionOnIssue(issue.number, here) }
  })

  const issues = sortIssues(decided).map(decorateIssue)

  return {
    ok: true,
    repo: nameWithOwner || null,
    viewer,
    label: wanted,
    issues,
    onYou: issues.filter(i => i.verdict.onYou).length,
    readAt: Date.now(),
  }
}
