import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { fixPrompt, rollupVerdict, type FailingCheck, type PrChecksVerdict, type RollupRow } from './prWatch'

const exec = promisify(execFile)

/**
 * The pull requests in this repository that have your name on them.
 *
 * The app already knew about exactly one pull request at a time — the one the
 * session in front of you opened. That is the wrong half of the picture. Most
 * of what a pull request costs you happens after it is opened and away from the
 * session that wrote it: somebody asks for a change, CI goes red on the third
 * push, a review is requested from you while you are inside something else. All
 * of that lives on github.com, which is a tab you have to remember to open, and
 * remembering is the thing this product exists to not require.
 *
 * So this reads the same two questions you would open that tab for — **what is
 * waiting on me** and **where has my own work got to** — and answers them next
 * to the sessions that can act on them. A red pull request here is one click
 * from a session on its branch; a review requested from you is one click from a
 * session that has the diff checked out.
 *
 * Everything is `gh`, read-only, run in the project directory so it resolves
 * the repository from the git remote exactly as it would if you typed it. No
 * token is asked for and none is stored: the credentials are the ones `gh`
 * already has. Same reasoning as `eventTriggers` — this app is bound to
 * loopback with nothing in front of it, and webhooks would mean opening a port
 * to the internet, which is a different product with a different threat model.
 */

// --- What GitHub says -------------------------------------------------------

export interface Reviewer {
  /** A person's login, or a team's slug. */
  name: string
  team: boolean
}

export interface PullLabel {
  name: string
  /** GitHub's own hex, without the `#`. Used as-is so labels look like labels. */
  color: string
}

/** GitHub's verdict across all submitted reviews. */
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'NONE'

export interface Pull {
  number: number
  title: string
  url: string
  author: string
  /** Whether you opened it. The two lists are read differently. */
  mine: boolean
  draft: boolean
  headBranch: string
  baseBranch: string
  /** The commit the checks describe, which is what a fix prompt has to name. */
  headSha: string
  createdAt: number
  updatedAt: number
  additions: number
  deletions: number
  changedFiles: number
  reviewDecision: ReviewDecision
  /** GitHub's word: MERGEABLE, CONFLICTING, or UNKNOWN while it works it out. */
  mergeable: string
  checks: PrChecksVerdict
  failing: FailingCheck[]
  /** Who has been asked and has not answered. */
  awaiting: Reviewer[]
  labels: PullLabel[]
  /**
   * Review threads nobody has resolved, or null when GitHub could not be asked.
   *
   * Null is not zero, and the difference matters: "no unanswered comments" is
   * news, and "the second request failed" is not something to report as good.
   */
  unresolved: number | null
  /** Reviews that took a position, latest one per person. Null like `unresolved`. */
  approvals: number | null
  changesRequested: number | null
}

/**
 * Where a pull request has got to, in one word.
 *
 * This is the whole point of the page: a list of pull requests is something
 * GitHub already gives you, and it is a list of *rows*. What you actually want
 * to know standing in front of it is which of these is your problem right now,
 * and that is a question about several fields at once — a review decision, a
 * check rollup, a mergeability flag and a count of comments nobody replied to.
 */
export type PullState =
  /** Not asking for anything yet. */
  | 'draft'
  /** Conflicts with its base. Nothing downstream of that means much. */
  | 'conflicted'
  /** Somebody reviewed it and wants something changed. */
  | 'changes-requested'
  /** Comments left on the diff that nobody has resolved. */
  | 'unanswered'
  /** CI went red. */
  | 'checks-failing'
  /** CI has not finished. */
  | 'checks-running'
  /** Approved, green, and mergeable. */
  | 'ready'
  /** Open and nobody has said anything yet. */
  | 'awaiting-review'

export interface PullVerdict {
  state: PullState
  /** The badge. Two or three words. */
  label: string
  /** The line under the title, when there is something to add. */
  detail: string
  /**
   * Whether the next move is yours.
   *
   * The whole list is sorted by this, so it is worth being exact about what it
   * means: not "you are involved", which is true of everything here, but "this
   * does not move until you do something". A pull request of yours waiting on a
   * reviewer is not on you. One that has been approved is — it is sitting there
   * asking to be merged.
   */
  onYou: boolean
}

/**
 * The order the checks below are made in, which is a set of judgement calls.
 *
 * **A person outranks a robot.** `changes-requested` and `unanswered` are
 * tested before the check rollup, so a pull request that is both red and has a
 * reviewer waiting reads as the second. Somebody is sitting on the other end of
 * one of those and not the other, and you will fix the build on your way to
 * answering them regardless.
 *
 * **A conflict outranks everything except a draft.** Not because it is the
 * worst news, but because it is the news that makes the rest unreliable: checks
 * ran against a merge that cannot happen, and an approval was given for a diff
 * that is about to change.
 *
 * **Approved with nothing reported is still shown as ready, and says so.** The
 * house rule elsewhere is that silence is not success, and it is why `prWatch`
 * refuses to land on an empty rollup. That rule is about acting unattended. A
 * person reading a page and pressing merge themselves is entitled to the
 * distinction rather than to a refusal, so it is in the detail line.
 */
export function verdictFor(pull: Pull): PullVerdict {
  const mine = pull.mine

  if (pull.draft) {
    return {
      state: 'draft',
      label: 'Draft',
      detail: mine ? 'Not asking for review yet' : 'Marked draft — not ready for you',
      onYou: mine,
    }
  }

  if (pull.mergeable === 'CONFLICTING') {
    return {
      state: 'conflicted',
      label: 'Conflicts',
      detail: `Conflicts with ${pull.baseBranch}, so nothing here can land until it is brought forward`,
      onYou: mine,
    }
  }

  if (pull.reviewDecision === 'CHANGES_REQUESTED') {
    return {
      state: 'changes-requested',
      label: 'Changes requested',
      detail: pull.unresolved
        ? `${pull.unresolved} ${pull.unresolved === 1 ? 'thread' : 'threads'} still open`
        : 'A reviewer asked for something',
      onYou: mine,
    }
  }

  if (pull.unresolved) {
    return {
      state: 'unanswered',
      label: 'Unanswered',
      detail: `${pull.unresolved} review ${pull.unresolved === 1 ? 'comment' : 'comments'} nobody has resolved`,
      onYou: mine,
    }
  }

  if (pull.checks === 'failing') {
    const named = pull.failing.slice(0, 2).map(c => c.name).join(', ')
    const more = pull.failing.length > 2 ? ` and ${pull.failing.length - 2} more` : ''
    return {
      state: 'checks-failing',
      label: 'CI red',
      detail: named ? `${named}${more} failing` : 'A check failed',
      onYou: mine,
    }
  }

  if (pull.checks === 'pending') {
    return {
      state: 'checks-running',
      label: 'Checks running',
      detail: 'No verdict yet',
      // Nothing to do but wait, and that is true whoever opened it.
      onYou: false,
    }
  }

  if (pull.reviewDecision === 'APPROVED') {
    return {
      state: 'ready',
      label: 'Ready to merge',
      detail: pull.checks === 'none'
        ? 'Approved, with no checks reporting'
        : pull.mergeable === 'MERGEABLE'
          ? 'Approved and green'
          : 'Approved and green — GitHub is still working out whether it merges cleanly',
      onYou: mine,
    }
  }

  const waiting = pull.awaiting.map(r => r.name).join(', ')
  return {
    state: 'awaiting-review',
    label: mine ? 'In review' : 'Your review',
    detail: mine
      ? waiting ? `Waiting on ${waiting}` : 'Waiting on a reviewer'
      : 'Nobody has reviewed it yet',
    onYou: !mine,
  }
}

/**
 * The order the page draws them in.
 *
 * Yours first when it is on you, then by how long it has been sitting. Age is
 * the right tiebreak rather than most-recently-updated: a pull request that has
 * not moved in a week is the one going stale, and sorting by activity would
 * bury it under whatever somebody pushed to five minutes ago.
 */
export function sortPulls(pulls: Pull[]): Pull[] {
  return [...pulls].sort((a, b) => {
    const onYou = Number(verdictFor(b).onYou) - Number(verdictFor(a).onYou)
    return onYou || a.createdAt - b.createdAt
  })
}

export interface PullsSummary {
  /** Will not move until you do something. What the sidebar badge counts. */
  onYou: number
  /** Asked of you specifically. */
  toReview: number
  /** Yours, approved and green. */
  toMerge: number
  /** Yours, waiting on somebody else. */
  waiting: number
}

export function summarizePulls(reviewing: Pull[], mine: Pull[]): PullsSummary {
  const all = [...reviewing, ...mine]
  return {
    onYou: all.filter(p => verdictFor(p).onYou).length,
    toReview: reviewing.length,
    toMerge: mine.filter(p => verdictFor(p).state === 'ready').length,
    waiting: mine.filter(p => !verdictFor(p).onYou).length,
  }
}

// --- Turning one into work --------------------------------------------------

/**
 * What pressing the button on a row means.
 *
 * Three, not one, because the useful turn is completely different depending on
 * which way the pull request is stuck, and a single "do something about this"
 * prompt would be the vaguest possible instruction handed to the most expensive
 * possible worker.
 */
export type WorkIntent =
  /** Somebody else's, asked of you: read it and say what you think. */
  | 'review'
  /** Yours, with a reviewer waiting: do what they asked. */
  | 'address'
  /** Yours, with CI red: work out why and fix it. */
  | 'fix'
  /** Yours, conflicting: bring the base forward and settle the collisions. */
  | 'update'

/**
 * Which one a row offers, from where the pull request has got to.
 *
 * Only ever one. Two buttons on a row is a question, and the answer is always
 * the same as what the badge already says.
 */
export function intentFor(pull: Pull): WorkIntent | null {
  if (!pull.mine) return pull.draft ? null : 'review'

  const state = verdictFor(pull).state
  if (state === 'conflicted') return 'update'
  if (state === 'changes-requested' || state === 'unanswered') return 'address'
  if (state === 'checks-failing') return 'fix'
  return null
}

/**
 * A pull request with its verdict already worked out.
 *
 * Derived here and sent down rather than recomputed in the page, for the reason
 * `mergeTrain` learned the hard way: a second implementation of the same
 * judgement drifts from the first, and two plausible answers disagreeing on one
 * screen is worse than either being absent. The page draws what it is given.
 */
export interface DecoratedPull extends Pull {
  verdict: PullVerdict
  /** What the button does, or null when the row has no button. */
  intent: WorkIntent | null
}

export function decorate(pull: Pull): DecoratedPull {
  return { ...pull, verdict: verdictFor(pull), intent: intentFor(pull) }
}

export const INTENT_LABELS: Record<WorkIntent, string> = {
  review: 'Review it',
  address: 'Address it',
  fix: 'Fix CI',
  update: 'Resolve conflicts',
}

/**
 * The turn each intent sends.
 *
 * All three end the same way and it is the most important line in the file:
 * **nothing is posted to GitHub.** A session started from here has `gh` and a
 * shell, so "leave a review" and "reply to the thread" are one tool call away
 * — and a review posted under your name that you have not read is the single
 * worst thing this feature could do. The output comes back into the session,
 * where you read it and decide. Posting it is still one sentence away; it is
 * just a sentence you have to say.
 */
export function workPrompt(pull: Pull, intent: WorkIntent): string {
  const head = `Pull request #${pull.number} — "${pull.title}"\n${pull.url}`

  if (intent === 'fix') {
    return fixPrompt(
      {
        number: pull.number,
        url: pull.url,
        state: 'OPEN',
        headSha: pull.headSha,
        mergeable: pull.mergeable,
        checks: pull.checks,
        failing: pull.failing,
      },
      1,
      1,
    )
  }

  if (intent === 'update') {
    return `${head}

This branch conflicts with \`${pull.baseBranch}\`, so nobody can merge it until the collisions are settled.

Fetch the base and merge it in — \`git fetch origin ${pull.baseBranch}\` then \`git merge origin/${pull.baseBranch}\` — and resolve what comes back. Read both sides of every conflict before you pick one. A conflict is two people changing the same lines for two different reasons, and taking either side wholesale usually loses one of them; the resolution is often neither version as written.

Run the project's checks afterwards. A merge that resolves cleanly and breaks the build is the most expensive kind, because it looks finished.

Commit the merge. Do not push it, and do not merge the pull request — I will look at what you did first.

If a conflict is one you should not be deciding — somebody else's work you do not understand — stop, say which file, and leave it.`
  }

  if (intent === 'address') {
    return `${head}

A reviewer is waiting on this one. Read what they actually said before you change anything: \`gh pr view ${pull.number} --comments\` for the conversation, and \`gh api repos/{owner}/{repo}/pulls/${pull.number}/comments\` for the comments left on specific lines, which is where the substance usually is.

Work out what each one is asking for and do it. Commit what you change — the commit is what gets pushed and what the reviewer sees, and work left uncommitted will look like nothing happened.

Where you think a comment is wrong, leave the code alone and say so here with your reasoning. Changing something you believe is correct, because somebody senior asked, is how a review makes code worse.

Do not reply on GitHub and do not resolve any threads. Tell me what you did and what you disagreed with, and I will answer them.`
  }

  return reviewPrompt(pull, head)
}

/**
 * The one prompt whose workspace has no branch in it.
 *
 * A review reads and reports; it does not commit and does not push. So the
 * workspace is a detached checkout of the head commit rather than the branch —
 * which is what lets you review the same pull request twice, and review one
 * while a session is fixing it. The prompt says the commit out loud for the
 * same reason the fix prompt does: a review of "the branch" is a review of
 * whatever it happened to say, and by the time you read the findings that may
 * be a different change.
 */
function reviewPrompt(pull: Pull, head: string): string {
  // Empty when `gh` did not give one, which is rare and not worth a sentence
  // about — the workspace is still the right code either way.
  const at = pull.headSha ? ` at \`${pull.headSha.slice(0, 12)}\`` : ''

  return `${head}

Opened by ${pull.author}, ${pull.changedFiles} ${pull.changedFiles === 1 ? 'file' : 'files'} changed against \`${pull.baseBranch}\`. My review was requested. The pull request's code is checked out in this workspace, detached${at} — no branch, on purpose, so reviewing it does not take the branch away from anything working on it. Do not commit, push, or make a branch here; if something needs changing, that is a separate session.

Read the change — \`git diff ${pull.baseBranch}...HEAD\` — and then read around it. Most of what is wrong with a diff is not visible in the diff: a caller this now breaks, an assumption two files away that no longer holds, an error path nobody added.

Come back here with what you found, worst first. For each thing say where it is, what goes wrong, and how sure you are. Say plainly what is fine as well — a review that lists only problems reads as though everything is one, and I cannot tell the difference between "this is solid apart from X" and "I only looked at X".

Do not post anything to GitHub. This is for me to read and decide on.`
}

/**
 * A person's own command for an action, filled in with this pull request.
 *
 * The point of the setting: a quick action can run `/hd:review {url}` instead of
 * the built-in prompt, so it lands in a session already invoking your own
 * command. The template is sent verbatim as the opening turn — a leading slash
 * is what makes the agent resolve it as a command rather than read it as prose,
 * so this does not touch it.
 *
 * Placeholders are the only edit. `{url}`, `{number}`, `{title}`, `{branch}`
 * (the head) and `{base}` are replaced wherever they appear. A template that
 * names none of them almost always still means "on this pull request", so the
 * URL is appended rather than left off — `/hd:review` becomes `/hd:review
 * <url>`, which is the difference between a command that knows which pull
 * request and one that asks.
 */
export function renderPullCommand(template: string, pull: Pull): string {
  const trimmed = template.trim()
  if (!trimmed) return ''

  const filled = trimmed
    .replaceAll('{url}', pull.url)
    .replaceAll('{number}', String(pull.number))
    .replaceAll('{title}', pull.title)
    .replaceAll('{branch}', pull.headBranch)
    .replaceAll('{base}', pull.baseBranch)

  // No placeholder used means nothing here names the pull request, so the one
  // fact the session cannot do without is added rather than assumed.
  const named = /\{(url|number|title|branch|base)\}/.test(trimmed)
  return named ? filled : `${filled} ${pull.url}`
}

/**
 * What the opening turn should be, given a person's settings.
 *
 * The custom command wins when there is one; otherwise the built-in prompt,
 * which is what every action did before the setting existed.
 */
export function turnForIntent(
  pull: Pull,
  intent: WorkIntent,
  commands?: Partial<Record<WorkIntent, string>>,
): string {
  const custom = renderPullCommand(commands?.[intent] ?? '', pull)
  return custom || workPrompt(pull, intent)
}

// --- Asking gh --------------------------------------------------------------

/** Most pull requests read per list. Beyond this, the page is not a page. */
const LIMIT = 30

/** Fields `gh pr list` will hand back without dragging comment bodies with it. */
const LIST_FIELDS = [
  'number', 'title', 'url', 'author', 'isDraft', 'createdAt', 'updatedAt',
  'headRefName', 'headRefOid', 'baseRefName', 'reviewDecision', 'mergeable',
  'additions', 'deletions', 'changedFiles', 'statusCheckRollup',
  'reviewRequests', 'labels',
].join(',')

interface RawPull {
  number?: number
  title?: string
  url?: string
  author?: { login?: string }
  isDraft?: boolean
  createdAt?: string
  updatedAt?: string
  headRefName?: string
  headRefOid?: string
  baseRefName?: string
  reviewDecision?: string
  mergeable?: string
  additions?: number
  deletions?: number
  changedFiles?: number
  statusCheckRollup?: RollupRow[] | null
  reviewRequests?: { login?: string; name?: string; slug?: string; __typename?: string }[]
  labels?: { name?: string; color?: string }[]
}

function stamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * A requested reviewer, whichever of the two shapes GitHub used.
 *
 * A person arrives as `{ login }` and a team as `{ name, slug }`, in the same
 * array. Reading only `login` — which is the obvious thing to write — silently
 * drops every team request, and a review requested from your team is the most
 * common way one reaches you at all.
 */
function toReviewer(raw: { login?: string; name?: string; slug?: string }): Reviewer | null {
  if (raw.login) return { name: raw.login, team: false }
  const team = raw.slug || raw.name
  return team ? { name: team, team: true } : null
}

export function parsePulls(rows: RawPull[], viewer: string): Pull[] {
  return rows
    .filter(row => typeof row.number === 'number' && row.url)
    .map((row) => {
      const { verdict, failing } = rollupVerdict(row.statusCheckRollup ?? [])
      const author = row.author?.login ?? 'someone'

      return {
        number: row.number!,
        title: row.title ?? '(untitled)',
        url: row.url!,
        author,
        mine: Boolean(viewer) && author === viewer,
        draft: Boolean(row.isDraft),
        headBranch: row.headRefName ?? '',
        baseBranch: row.baseRefName ?? '',
        headSha: row.headRefOid ?? '',
        createdAt: stamp(row.createdAt),
        updatedAt: stamp(row.updatedAt),
        additions: row.additions ?? 0,
        deletions: row.deletions ?? 0,
        changedFiles: row.changedFiles ?? 0,
        reviewDecision: (row.reviewDecision || 'NONE').toUpperCase() as ReviewDecision,
        mergeable: (row.mergeable ?? 'UNKNOWN').toUpperCase(),
        checks: verdict,
        failing,
        awaiting: (row.reviewRequests ?? []).map(toReviewer).filter(Boolean) as Reviewer[],
        labels: (row.labels ?? [])
          .filter(l => l.name)
          .map(l => ({ name: l.name!, color: l.color || '888888' })),
        unresolved: null,
        approvals: null,
        changesRequested: null,
      }
    })
}

async function gh(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await exec('gh', args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

/** Which of the two questions a list answers. */
type Which = 'mine' | 'reviewing'

async function listPulls(cwd: string, which: Which, viewer: string): Promise<Pull[] | null> {
  const selector = which === 'mine'
    ? ['--author', '@me']
    // Broader than `user-review-requested`, on purpose: it also matches a
    // review asked of a team you are in, which is how most of them arrive.
    : ['--search', 'review-requested:@me']

  try {
    const stdout = await gh(cwd, [
      'pr', 'list', '--state', 'open', '--limit', String(LIMIT),
      ...selector, '--json', LIST_FIELDS,
    ])
    const rows = JSON.parse(stdout || '[]')
    return Array.isArray(rows) ? parsePulls(rows, viewer) : null
  } catch {
    return null
  }
}

/**
 * The two things `gh pr list` will not tell you, in one GraphQL round trip.
 *
 * Unresolved review threads are the closest thing GitHub has to "somebody is
 * waiting for you to reply", and there is no `--json` field for them at any
 * price — `gh pr list --json comments` returns every body of every comment,
 * which is megabytes to count a number. Opinionated reviews are here for the
 * same reason: `latestReviews` carries the full text of each one, and all this
 * needs is how many said yes.
 *
 * Aliased per pull request rather than paged, because the set is already known
 * and small. Failure is not an error: every field it fills stays null and the
 * page reads as if it never asked, which is the only honest fallback for a
 * count.
 */
async function readThreadCounts(
  cwd: string,
  repo: { owner: string; name: string },
  numbers: number[],
): Promise<Map<number, { unresolved: number; approvals: number; changesRequested: number }>> {
  const out = new Map<number, { unresolved: number; approvals: number; changesRequested: number }>()
  if (!numbers.length) return out

  const aliases = numbers.map(n => `p${n}: pullRequest(number: ${n}) { ...T }`).join('\n')
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        ${aliases}
      }
    }
    fragment T on PullRequest {
      number
      reviewThreads(first: 100) { nodes { isResolved isOutdated } }
      latestOpinionatedReviews(first: 25) { nodes { state } }
    }
  `

  try {
    const stdout = await gh(cwd, [
      'api', 'graphql', '-f', `query=${query}`, '-F', `owner=${repo.owner}`, '-F', `name=${repo.name}`,
    ], 45_000)

    const parsed = JSON.parse(stdout) as {
      data?: {
        repository?: Record<string, {
          number?: number
          reviewThreads?: { nodes?: { isResolved?: boolean; isOutdated?: boolean }[] }
          latestOpinionatedReviews?: { nodes?: { state?: string }[] }
        } | null>
      }
    }

    for (const node of Object.values(parsed.data?.repository ?? {})) {
      if (!node || typeof node.number !== 'number') continue

      const threads = node.reviewThreads?.nodes ?? []
      const reviews = node.latestOpinionatedReviews?.nodes ?? []

      out.set(node.number, {
        // Outdated threads are left out. A comment on a line that has since
        // been rewritten has been dealt with in the only way that matters, and
        // counting it would leave a pull request permanently owing a reply it
        // already made.
        unresolved: threads.filter(t => !t.isResolved && !t.isOutdated).length,
        approvals: reviews.filter(r => (r.state ?? '').toUpperCase() === 'APPROVED').length,
        changesRequested: reviews.filter(r => (r.state ?? '').toUpperCase() === 'CHANGES_REQUESTED').length,
      })
    }
  } catch {
    // Left empty. Every caller treats a missing entry as "not asked".
  }

  return out
}

/**
 * Why a reading could not be taken, as something other than prose.
 *
 * The reason is written for a person and is the only thing the reviews page needs.
 * A caller reading *several* repositories needs to tell these apart rather than
 * match on the sentence: `not-github` is an ordinary fact about a folder that
 * happens not to be a GitHub project, and `no-auth` is something somebody has to
 * go and fix. See `wallPulls.ts`, which reports the second and stays quiet about
 * the first — a screen that warns about a repository forever, for a state that is
 * not a fault, is a screen whose warnings get ignored.
 */
export type PullsRefusal =
  /** No project directory was given. */
  | 'no-project'
  /** `gh` is not installed. */
  | 'no-gh'
  /** `gh` is installed and not signed in. */
  | 'no-auth'
  /** The folder has no GitHub repository behind it. Not a fault. */
  | 'not-github'
  /** GitHub itself could not be reached. */
  | 'unreachable'

export interface PullsReading {
  /** False when the question could not be asked, with `reason` saying why. */
  ok: boolean
  reason?: string
  /** Which kind of refusal it was, for a caller reading more than one repository. */
  refusal?: PullsRefusal
  /** `owner/name`, so the page can say which repository it is talking about. */
  repo: string | null
  /** Your login, which is what "mine" is decided against. */
  viewer: string | null
  reviewing: DecoratedPull[]
  mine: DecoratedPull[]
  summary: PullsSummary
  /** When this was read, so a page can say how stale it is. */
  readAt: number
}

const EMPTY_SUMMARY: PullsSummary = { onYou: 0, toReview: 0, toMerge: 0, waiting: 0 }

function unavailable(refusal: PullsRefusal, reason: string): PullsReading {
  return { ok: false, refusal, reason, repo: null, viewer: null, reviewing: [], mine: [], summary: EMPTY_SUMMARY, readAt: Date.now() }
}

/**
 * Both lists, and what is missing when they cannot be read.
 *
 * Every failure below returns a reason rather than an empty list, for the
 * reason `listOpenPullRequests` gives: telling somebody they have nothing
 * waiting when really nobody asked is how a page teaches you not to trust it.
 */
export async function readPulls(repoDir: string | null): Promise<PullsReading> {
  if (!repoDir || !existsSync(repoDir)) {
    return unavailable('no-project', 'Pick a project folder first — pull requests are read from its git remote.')
  }

  try {
    await exec('gh', ['--version'], { timeout: 10_000 })
  } catch {
    return unavailable('no-gh', 'The GitHub CLI (`gh`) is not installed, so there is nothing to read pull requests with.')
  }

  let viewer: string
  try {
    viewer = (await gh(repoDir, ['api', 'user', '--jq', '.login'], 20_000)).trim()
  } catch {
    return unavailable('no-auth', 'The GitHub CLI is installed but not signed in. Run `gh auth login` and try again.')
  }

  let nameWithOwner: string
  try {
    nameWithOwner = JSON.parse(await gh(repoDir, ['repo', 'view', '--json', 'nameWithOwner']))?.nameWithOwner ?? ''
  } catch {
    return unavailable('not-github', 'This project has no GitHub repository behind it, so there are no pull requests to read.')
  }

  const [owner = '', name = ''] = nameWithOwner.split('/')

  const [reviewing, mine] = await Promise.all([
    listPulls(repoDir, 'reviewing', viewer),
    listPulls(repoDir, 'mine', viewer),
  ])

  if (!reviewing && !mine) {
    return unavailable('unreachable', `GitHub could not be reached for ${nameWithOwner}. The list below is not empty — it is unknown.`)
  }

  const found = [...(reviewing ?? []), ...(mine ?? [])]

  // One request for both lists: a pull request you opened *and* were asked to
  // review is one pull request, and asking about it twice is a round trip spent
  // to get the same answer.
  const counts = await readThreadCounts(repoDir, { owner, name }, [...new Set(found.map(p => p.number))])

  for (const pull of found) {
    const count = counts.get(pull.number)
    if (!count) continue
    pull.unresolved = count.unresolved
    pull.approvals = count.approvals
    pull.changesRequested = count.changesRequested
  }

  // Yours never appears twice. GitHub lets you request a review on your own
  // pull request, and the reviewing list is the one that would be surprising.
  const mineNumbers = new Set((mine ?? []).map(p => p.number))

  const reviewingList = sortPulls((reviewing ?? []).filter(p => !mineNumbers.has(p.number)))
  const mineList = sortPulls(mine ?? [])

  return {
    ok: true,
    repo: nameWithOwner || null,
    viewer,
    reviewing: reviewingList.map(decorate),
    mine: mineList.map(decorate),
    summary: summarizePulls(reviewingList, mineList),
    readAt: Date.now(),
  }
}
