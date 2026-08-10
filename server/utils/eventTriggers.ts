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
 * It is a cap all the same, so `selectNew` reports when the window did not
 * reach back as far as the cursor rather than quietly losing the difference.
 */
const LOOKBACK = 50

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
): Promise<TriggerEvent[] | null> {
  if (!repoDir || !existsSync(repoDir)) return null

  const branch = trigger.branch?.trim()

  if (trigger.kind === 'pr_opened') {
    const rows = await gh(
      ['pr', 'list', '--state', 'open', '--limit', String(LOOKBACK), '--json', 'number,title,url,headRefName'],
      repoDir,
    )
    if (!rows) return null

    return rows
      .map(row => row as { number?: number; title?: string; url?: string; headRefName?: string })
      .filter(row => typeof row.number === 'number' && row.url)
      .filter(row => !branch || row.headRefName === branch)
      .map(row => ({
        key: row.number!,
        summary: `pull request #${row.number}: ${row.title ?? '(untitled)'}`,
        url: row.url!,
      }))
  }

  if (trigger.kind === 'check_failed') {
    const rows = await gh(
      ['run', 'list', '--limit', String(LOOKBACK), '--json',
        'databaseId,status,conclusion,headBranch,workflowName,url'],
      repoDir,
    )
    if (!rows) return null

    return rows
      .map(row => row as {
        databaseId?: number; status?: string; conclusion?: string
        headBranch?: string; workflowName?: string; url?: string
      })
      // Only a finished run has a verdict. An in-flight one is not yet news,
      // and firing on it would fire again when it finishes.
      .filter(row => row.status === 'completed' && row.conclusion === 'failure')
      .filter(row => typeof row.databaseId === 'number' && row.url)
      .filter(row => !branch || row.headBranch === branch)
      .map(row => ({
        key: row.databaseId!,
        summary: `${row.workflowName ?? 'A workflow'} failed on ${row.headBranch ?? 'a branch'}`,
        url: row.url!,
      }))
  }

  if (trigger.kind === 'issue_labelled' || trigger.kind === 'review_requested') {
    return pollIssueEvents(trigger, repoDir)
  }

  return null
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
): Promise<TriggerEvent[] | null> {
  const rows = await gh(
    ['api', `repos/{owner}/{repo}/issues/events?per_page=${LOOKBACK}`],
    repoDir,
  )
  if (!rows) return null

  return issueEventsFrom(rows as IssueEventRow[], trigger)
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
