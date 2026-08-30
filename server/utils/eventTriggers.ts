import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * Rituals that fire because something happened, rather than because it is 08:00.
 *
 * The clock caps a ritual at roughly one a morning. Events do not, and they are
 * what scheduled agents are mostly adopted for: a pull request appears and
 * wants reviewing, CI goes red and wants looking at. Neither of those is a time
 * of day.
 *
 * Polled through `gh` rather than through webhooks, deliberately. This app is
 * bound to loopback and has no authentication in front of it — taking webhooks
 * would mean opening a port to the internet, which is a different product with
 * a different threat model. Polling asks the same question from behind your own
 * firewall using the credentials you already have.
 *
 * Everything here is read-only: `gh pr list` and `gh run list`, run in the
 * project directory so `gh` resolves the repository from the git remote the way
 * it would if you typed it.
 */

export type GithubEventKind =
  | 'pr_opened'
  | 'check_failed'
  | 'issue_labelled'
  | 'review_requested'

/**
 * Which failing runs a `check_failed` trigger counts as its own.
 *
 * `any` and `branch` are the two settings this trigger has always had — every
 * failing run in the repository, or one branch named in advance. Both are the
 * wrong question in a repository shared with other people: the first fires on
 * everybody's failures, and the second names a branch that changes with every
 * pull request you open.
 *
 * `mine` is the question actually being asked, which the run records show typed
 * by hand five times in a month: a check that failed on a branch with an open
 * pull request *you* authored.
 */
export type CheckScope = 'any' | 'branch' | 'mine'

export interface EventTrigger {
  kind: GithubEventKind
  /** Only fire for this branch, when set. Empty means any. `pr_opened`, `check_failed`. */
  branch?: string
  /** Only fire for this label, when set. Empty means any. `issue_labelled`. */
  label?: string
  /**
   * Only fire when this person or team was the one asked, when set. Empty means
   * anyone. `review_requested`.
   */
  reviewer?: string
  /**
   * Which failures count. `check_failed`. Absent is every schedule written
   * before this field existed, and means whatever `branch` already said — see
   * `checkScopeOf`.
   */
  scope?: CheckScope
}

/**
 * What a trigger with no `scope` on it means.
 *
 * Every `check_failed` schedule already on disk predates the field, and has to
 * go on firing exactly as it does now: `branch` set was "that branch", `branch`
 * empty was "the whole repository". So the absent case is read off `branch`
 * rather than defaulting to a constant, and no stored record needs rewriting.
 *
 * Once set, `scope` wins outright — `any` alongside a leftover branch means the
 * branch is not a filter any more, and both the poll and the sentence on the row
 * have to agree about that.
 */
export function checkScopeOf(trigger: EventTrigger): CheckScope {
  if (trigger.scope) return trigger.scope
  return trigger.branch?.trim() ? 'branch' : 'any'
}

/**
 * One thing that happened, in the shape the scheduler needs.
 *
 * `key` is the ordering identity — a PR number or a workflow run's
 * `databaseId`, both of which GitHub hands out monotonically, which is what
 * makes a high-water mark enough to avoid firing twice for the same thing.
 */
export interface TriggerEvent {
  key: number
  summary: string
  url: string
}

/**
 * Most a single poll will start at once.
 *
 * Ten pull requests appearing while a laptop was shut should not become ten
 * agents the moment it wakes. The high-water mark only advances past what
 * actually fired, so the rest are not dropped — they arrive on the next poll.
 */
export const MAX_EVENTS_PER_POLL = 3

/**
 * How far back a poll looks.
 *
 * A poll every two minutes never needs this many, but a laptop that was shut
 * for a weekend does: everything that happened while it slept arrives at once,
 * and anything past this window is never seen. Fifty is generous for a small
 * team's repository and still one cheap request.
 *
 * It is a cap all the same. When the window comes back full and every item in
 * it is newer than the cursor, the poll cannot see back to where it had got to
 * — so something happened in between that it will never fire on. `reachedBack`
 * is what makes that sayable instead of silent; see `hasGap`.
 */
const LOOKBACK = 50

/**
 * What one poll saw.
 *
 * `reachedBack` is the oldest key the window contained, and only when the
 * window came back *full* — a short window saw everything there was, so there
 * is nothing to worry about. It is taken from the raw listing rather than from
 * the filtered events, because how far back we looked is a property of the
 * request, not of how many rows survived the filter: a window of fifty
 * workflow runs containing two failures still only reached as far as its
 * fiftieth run.
 */
export interface TriggerPoll {
  events: TriggerEvent[]
  reachedBack?: number
}

/**
 * Whether this poll skipped over something it will never come back for.
 *
 * True when the window was full and its oldest item is *newer* than the cursor:
 * everything between where we had got to and the bottom of the window happened
 * unseen, and the cursor is about to move past it.
 *
 * A first poll has no cursor and cannot have a gap — it is establishing the
 * baseline, and deliberately fires nothing.
 *
 * This is the same class of bug as a ritual missed while the laptop was shut,
 * and gets the same treatment: nothing failed, so it must not be recorded as a
 * failure, but it must not be silent either.
 */
export function hasGap(cursor: number | undefined, reachedBack: number | undefined): boolean {
  if (cursor === undefined || reachedBack === undefined) return false
  return reachedBack > cursor
}

export const EVENT_LABELS: Record<GithubEventKind, string> = {
  pr_opened: 'a pull request is opened',
  check_failed: 'a workflow run fails',
  issue_labelled: 'an issue is labelled',
  review_requested: 'a review is requested',
}

/**
 * What this trigger waits for, narrowing included.
 *
 * Each kind narrows by a different thing, so the sentence has to know which —
 * "on main" and "labelled bug" are both filters, and reading one as the other
 * would describe the ritual wrongly on the row that exists to describe it.
 */
export function describeTrigger(trigger: EventTrigger): string {
  const what = EVENT_LABELS[trigger.kind] ?? trigger.kind

  if (trigger.kind === 'issue_labelled' && trigger.label?.trim()) {
    return `When an issue is labelled ${trigger.label.trim()}`
  }

  if (trigger.kind === 'review_requested' && trigger.reviewer?.trim()) {
    return `When a review is requested from ${trigger.reviewer.trim()}`
  }

  if (trigger.kind === 'check_failed') {
    // The scope is what the poll filters on, so it is what the row must say. A
    // branch left on a trigger scoped to `any` or `mine` is not a filter any
    // more, and naming it here would describe a ritual that does not exist.
    const scope = checkScopeOf(trigger)
    if (scope === 'mine') return 'When a workflow run fails on a pull request you opened'
    if (scope === 'any') return `When ${what}`
  }

  return trigger.branch ? `When ${what} on ${trigger.branch}` : `When ${what}`
}

async function gh(args: string[], cwd: string): Promise<unknown[] | null> {
  try {
    const { stdout } = await exec('gh', args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    })
    const parsed = JSON.parse(stdout || '[]')
    return Array.isArray(parsed) ? parsed : null
  } catch {
    // `gh` missing, not logged in, no remote, rate limited, offline. None of
    // these are worth failing a tick over: the next poll asks again, and a
    // ritual that cannot see GitHub simply does not fire.
    return null
  }
}

/**
 * What has happened that this trigger cares about, newest first.
 *
 * Returns null when the question could not be asked at all, which is different
 * from "nothing happened" — the caller must not advance its cursor on null, or
 * a transient `gh` failure would silently swallow every event that arrived
 * during it.
 */
export async function pollTrigger(
  trigger: EventTrigger,
  repoDir: string | undefined,
): Promise<TriggerPoll | null> {
  if (!repoDir || !existsSync(repoDir)) return null

  const branch = trigger.branch?.trim()

  if (trigger.kind === 'pr_opened') {
    const rows = await gh(
      ['pr', 'list', '--state', 'open', '--limit', String(LOOKBACK), '--json', 'number,title,url,headRefName'],
      repoDir,
    )
    if (!rows) return null

    const typed = rows
      .map(row => row as { number?: number; title?: string; url?: string; headRefName?: string })
      .filter(row => typeof row.number === 'number' && row.url)

    return {
      reachedBack: reachedBackOf(rows, typed.map(row => row.number!)),
      events: typed
        .filter(row => !branch || row.headRefName === branch)
        .map(row => ({
          key: row.number!,
          summary: `pull request #${row.number}: ${row.title ?? '(untitled)'}`,
          url: row.url!,
        })),
    }
  }

  if (trigger.kind === 'check_failed') {
    const rows = await gh(
      ['run', 'list', '--limit', String(LOOKBACK), '--json',
        'databaseId,status,conclusion,headBranch,workflowName,url'],
      repoDir,
    )
    if (!rows) return null

    const typed = (rows as CheckRunRow[])
      .filter(row => typeof row.databaseId === 'number' && row.url)

    /**
     * One extra question per poll, and only for `mine`.
     *
     * One call rather than one per run — the failing runs are intersected with
     * the head branches it comes back with — and it happens on a poll that was
     * already asking GitHub something. `LOOKBACK` rather than `gh`'s default
     * thirty, so the two windows agree: a truncated listing here would look
     * exactly like a pull request that is not yours.
     */
    const authored = checkScopeOf(trigger) === 'mine'
      ? await gh(
          ['pr', 'list', '--author', '@me', '--state', 'open', '--limit', String(LOOKBACK),
            '--json', 'number,url,headRefName,title'],
          repoDir,
        ) as AuthoredPull[] | null
      : null

    const events = checkEventsFrom(typed, trigger, authored)
    // Not knowing which pull requests are yours is not the same as none of them
    // being yours. Returning a poll here would advance the cursor past every
    // failure that arrived while `gh pr list` was unhappy, and none of them
    // would ever fire.
    if (!events) return null

    return {
      // Every run in the window, not only the failing ones: how far back we
      // looked is a property of the request. Fifty runs containing two
      // failures still only reached as far as the fiftieth run.
      reachedBack: reachedBackOf(rows, typed.map(row => row.databaseId!)),
      events,
    }
  }

  if (trigger.kind === 'issue_labelled' || trigger.kind === 'review_requested') {
    return pollIssueEvents(trigger, repoDir)
  }

  return null
}

/**
 * How far back this window reached, or undefined when it did not need to.
 *
 * Only a full window can have cut anything off. A short one returned
 * everything there was, so there is nothing behind it to have missed.
 */
function reachedBackOf(raw: unknown[], keys: number[]): number | undefined {
  if (raw.length < LOOKBACK || !keys.length) return undefined
  return Math.min(...keys)
}

/** One row of `gh run list`. Only the fields actually read. */
export interface CheckRunRow {
  databaseId?: number
  status?: string
  conclusion?: string
  headBranch?: string
  workflowName?: string
  url?: string
}

/** One row of `gh pr list --author @me`. Only the fields actually read. */
export interface AuthoredPull {
  number?: number
  title?: string
  url?: string
  headRefName?: string
}

/**
 * The failing runs this trigger cares about, given what the two listings said.
 *
 * Split from the request the same way `issueEventsFrom` is, and for the same
 * reason: the intersection is where the mistakes are, and a session cannot make
 * a real check go red on demand to find them.
 *
 * `null` means the question could not be asked — `mine` needs to know which
 * pull requests are yours, and being told nothing is not the same as being told
 * none. The caller must not advance a cursor on it.
 *
 * The key stays the workflow run's `databaseId` rather than becoming the pull
 * request's number, under every scope. A pull request goes red, gets pushed to,
 * and goes red again; keyed by pull request that second failure is not news and
 * would never fire.
 */
export function checkEventsFrom(
  rows: CheckRunRow[],
  trigger: EventTrigger,
  authored: AuthoredPull[] | null,
): TriggerEvent[] | null {
  const scope = checkScopeOf(trigger)
  const branch = trigger.branch?.trim()

  if (scope === 'mine' && !authored) return null

  /**
   * Your open pull requests by head branch, which is the only thing `gh run
   * list` gives us to match on. Two of your own pull requests can only share a
   * head branch name across forks, and the first one wins — matching the wrong
   * one of your own pull requests is a worse summary, not a wrong ritual.
   */
  const mine = new Map<string, AuthoredPull>()
  for (const pull of authored ?? []) {
    if (typeof pull.number !== 'number' || !pull.url || !pull.headRefName) continue
    if (!mine.has(pull.headRefName)) mine.set(pull.headRefName, pull)
  }

  const events: TriggerEvent[] = []

  for (const row of rows) {
    // A row with no id has no ordering identity and one with no url has nowhere
    // to send anybody. The caller filters these out before measuring how far
    // back the window reached; checked again here so the fixtures a test writes
    // are the same rows this function defends against.
    if (typeof row.databaseId !== 'number' || !row.url) continue

    // Only a finished run has a verdict. An in-flight one is not yet news, and
    // firing on it would fire again when it finishes.
    if (row.status !== 'completed' || row.conclusion !== 'failure') continue

    if (scope === 'branch' && branch && row.headBranch !== branch) continue

    if (scope !== 'mine') {
      events.push({
        key: row.databaseId,
        summary: `${row.workflowName ?? 'A workflow'} failed on ${row.headBranch ?? 'a branch'}`,
        url: row.url,
      })
      continue
    }

    const pull = row.headBranch ? mine.get(row.headBranch) : undefined
    if (!pull) continue

    /**
     * The pull request, not the branch or the run.
     *
     * The instruction this carries is "let's fix the CI here", and what a
     * person opening the row wants — and what the instruction will quote — is
     * the pull request. The workflow's own name is still in the sentence,
     * because which check went red is the first thing you need to know.
     */
    events.push({
      key: row.databaseId,
      summary: `#${pull.number} ${pull.title ?? '(untitled)'} — ${row.workflowName ?? 'a workflow'} failed`,
      url: pull.url!,
    })
  }

  return events
}

/**
 * One row of `repos/{owner}/{repo}/issues/events`.
 *
 * Only the fields actually read, and every one of them was confirmed against a
 * real response before anything was designed around it — see `pollIssueEvents`
 * for what that turned up.
 */
export interface IssueEventRow {
  id?: number
  event?: string
  label?: { name?: string }
  requested_reviewer?: { login?: string }
  requested_team?: { name?: string }
  issue?: {
    number?: number
    title?: string
    html_url?: string
    /** Present only when the "issue" is really a pull request. */
    pull_request?: unknown
  }
}

/**
 * Things that happened *to* an issue or pull request, rather than things that
 * were opened.
 *
 * A different shape of question from the two triggers above, and it needs a
 * different source. "An issue is labelled" is not a property of the issue — it
 * is something done to one, possibly long after it was opened and possibly
 * more than once. Listing issues and watching them change cannot express that:
 * an old issue labelled today has a low number, so a high-water mark on issue
 * numbers would never see it, and `updatedAt` moves for every comment and edit
 * as well, so a trigger built on it would fire on things that are not labels.
 *
 * `repos/{owner}/{repo}/issues/events` is the event log itself. Each entry has
 * a monotonically increasing `id`, which is exactly what the cursor here wants,
 * and says which kind of thing happened — so both kinds below come from one
 * request rather than two.
 *
 * `{owner}` and `{repo}` are resolved by `gh` from the git remote, the same way
 * `gh pr list` does, so this stays "the question you would have typed".
 */
async function pollIssueEvents(
  trigger: EventTrigger,
  repoDir: string,
): Promise<TriggerPoll | null> {
  const rows = await gh(
    ['api', `repos/{owner}/{repo}/issues/events?per_page=${LOOKBACK}`],
    repoDir,
  )
  if (!rows) return null

  const typed = rows as IssueEventRow[]

  return {
    // Every event in the log, not only the labels: the window is shared by
    // every kind of thing that can happen to an issue, so a repository busy
    // with comments and closures reaches back less far than its label count
    // suggests.
    reachedBack: reachedBackOf(
      rows,
      typed.map(row => row.id).filter((id): id is number => typeof id === 'number'),
    ),
    events: issueEventsFrom(typed, trigger),
  }
}

/**
 * The events this trigger cares about, from what the log returned.
 *
 * Split from the request so the filtering can be tested against the real
 * payload without a repository — and the filtering is where the mistakes are.
 */
export function issueEventsFrom(rows: IssueEventRow[], trigger: EventTrigger): TriggerEvent[] {
  const wanted = trigger.kind === 'issue_labelled' ? 'labeled' : 'review_requested'
  const label = trigger.label?.trim().toLowerCase()
  const reviewer = trigger.reviewer?.trim().toLowerCase()

  return rows
    .filter(row => row.event === wanted)
    .filter(row => typeof row.id === 'number' && row.issue?.html_url)
    .filter((row) => {
      if (trigger.kind === 'issue_labelled') {
        return !label || (row.label?.name ?? '').toLowerCase() === label
      }

      // A review can be asked of a person or of a team, and somebody filtering
      // by their own login should still be told when their team was asked.
      if (!reviewer) return true
      const asked = [row.requested_reviewer?.login, row.requested_team?.name]
        .filter(Boolean)
        .map(name => name!.toLowerCase())
      return asked.includes(reviewer)
    })
    .map(row => ({
      key: row.id!,
      summary: summarizeIssueEvent(trigger.kind, row),
      url: row.issue!.html_url!,
    }))
}

function summarizeIssueEvent(kind: GithubEventKind, row: IssueEventRow): string {
  const number = row.issue?.number
  const title = row.issue?.title ?? '(untitled)'

  /**
   * A pull request is an issue as far as this endpoint is concerned — both
   * arrive under a field called `issue`, and both can be labelled. So the
   * summary asks which it actually was rather than assuming, since telling
   * somebody "issue #14117" about a pull request sends them looking for the
   * wrong thing.
   */
  const what = row.issue?.pull_request ? 'pull request' : 'issue'

  if (kind === 'issue_labelled') {
    const name = row.label?.name
    const labelled = name ? ` ${name}` : ''
    return `${what} #${number} labelled${labelled}: ${title}`
  }

  const asked = row.requested_reviewer?.login ?? row.requested_team?.name
  const from = asked ? ` from ${asked}` : ''
  return `review requested${from} on ${what} #${number}: ${title}`
}

/**
 * Which of these are new, oldest first, and how far the cursor may advance.
 *
 * Oldest first because they are fired in order and a queue of pull requests
 * should be handled in the order they arrived.
 *
 * `cursor === undefined` is the first sight of this ritual, and fires nothing:
 * turning on "when a pull request is opened" must not immediately start work on
 * every pull request already open. The baseline is recorded and the ritual fires
 * on what happens next, which is what the sentence promises.
 */
export function selectNew(
  events: TriggerEvent[],
  cursor: number | undefined,
): { fire: TriggerEvent[]; cursor: number; deferred: number } {
  const highest = events.reduce((max, event) => Math.max(max, event.key), cursor ?? 0)

  if (cursor === undefined) return { fire: [], cursor: highest, deferred: 0 }

  const fresh = events
    .filter(event => event.key > cursor)
    .sort((a, b) => a.key - b.key)

  const fire = fresh.slice(0, MAX_EVENTS_PER_POLL)

  return {
    fire,
    // Only past what actually fired, so the remainder is picked up next time
    // rather than skipped. Nothing here is dropped silently.
    cursor: fire.length ? fire[fire.length - 1]!.key : cursor,
    deferred: fresh.length - fire.length,
  }
}

/**
 * The prompt, with what happened appended.
 *
 * A ritual written for events is written for a class of thing — "review the
 * pull request" — and needs to be told which one. Kept as plain trailing text
 * rather than injected into the middle, so the instruction somebody wrote is
 * still the instruction that arrives.
 */
export function promptFor(input: string, event: TriggerEvent): string {
  return `${input}\n\nTriggered by ${event.summary}\n${event.url}`
}

/**
 * What to call the run this event produced.
 *
 * A ritual firing on five pull requests produced five rows in Activity with
 * the same name on each, so telling them apart meant opening one and reading
 * its prompt. The ritual's name says what the work *is*; the event says which
 * one it was about, and a list needs both.
 */
export function titleFor(ritualTitle: string, event: TriggerEvent): string {
  const suffix = event.summary.length > 60 ? `${event.summary.slice(0, 59)}…` : event.summary
  return `${ritualTitle} · ${suffix}`
}
