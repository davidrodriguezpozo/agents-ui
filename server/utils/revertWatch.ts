import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { patchSession, readSessions, type Session } from './sessions'

const exec = promisify(execFile)

/**
 * When landed work is taken back out again.
 *
 * "It merged" was the last thing this app knew about a piece of work, and it was
 * treated as the end of the story — the session went green, the ledger counted a
 * merge, and the cost-per-merge figure that the whole ledger rests on quietly
 * assumed every merge was one somebody wanted. Nothing looked again. A merge
 * reverted an hour later still read as a merge that held, so the one number
 * anybody would use to judge unattended work was the flattering one.
 *
 * A revert is the cheapest honest signal available. It costs no model call and no
 * network: it is a commit sitting on the base branch of a repository already on
 * this disk. And it is only available *here* — nobody else recorded that this
 * machine made that merge commit, so nobody else can notice the undo.
 *
 * **This records. It does nothing about it.** No turn, no notification, no
 * reopening. That restraint is the design and not an omission: a revert is
 * frequently the right thing to have happened — a release being cut, a feature
 * flag being pulled, somebody sequencing two changes differently — and an app
 * that treated it as a failure to be repaired would be arguing with the person
 * who reverted. So the wording everywhere is what happened, not whose fault it is.
 *
 * **What it can and cannot see.** Worth being blunt about, because the honest
 * shape of this is narrower than "we detect reverts":
 *
 *   - *It reads the commit message*, which is what `git revert` writes: a line
 *     saying `This reverts commit <sha>`. **A revert whose diff is the inverse of
 *     the landing but whose message does not say so is not detected.** That would
 *     mean diffing every commit on the base branch against every landing, and
 *     nothing about the result would be certain either — two commits can undo
 *     each other's effect without either being a revert of the other.
 *   - *It reads the local base branch*, and never fetches. A landing whose merge
 *     commit is not on this machine yet — a pull request merged on github.com and
 *     not pulled since — is simply not asked about, and starts being asked about
 *     as soon as somebody pulls.
 *   - *It needs the landing to name a commit.* `SessionLanded.sha` is written by
 *     the two routes that produce a merge commit here; landings recorded before
 *     that field existed have none and are skipped for good.
 *   - *A rewritten base branch loses the thread.* If the merge commit is rebased
 *     away, its sha is not in the history any more and nothing is found.
 *
 * **A revert of a revert puts the work back**, and that is followed rather than
 * being a one-way flag: the record is cleared again when the revert that produced
 * it has itself been undone. Otherwise the first mistaken revert would mark a
 * session permanently, and the correction — which is the more common half of that
 * pair — would never show up anywhere.
 *
 * Polled on the scheduler's existing two-minute tick rather than on a timer of
 * its own, for the reason `tickInbox` gives: one `git log` per repository is not
 * worth a loop of its own, and a second loop is a second thing to reason about.
 */

// --- The record -------------------------------------------------------------

export interface SessionReverted {
  /** When this machine noticed. Not when it happened — see `committedAt`. */
  at: number
  /** The commit that took the work back out. */
  sha: string
  /** When that commit was made, from git. */
  committedAt: number
  /**
   * Who committed it, when git records a name. Absent rather than guessed: a
   * revert pushed from CI or applied by a bot has no useful person behind it, and
   * naming the wrong one is worse than naming nobody.
   */
  by?: string
  /** Its subject line, so a row can say what the revert called itself. */
  subject: string
  /** The landing it undoes — the `sha` on `SessionLanded`. */
  landedSha: string
  /** The branch this happened on. */
  branch: string
}

/**
 * What happened, in one line, with nobody blamed for it.
 *
 * "Reverted out of", not "reverted by" as the headline: the fact worth leading
 * with is that the base branch no longer has the work. Who did it comes second,
 * and only when git knows — see `by`.
 */
export function describeReverted(reverted: SessionReverted): string {
  const by = reverted.by ? ` by ${reverted.by}` : ''
  return `reverted out of ${reverted.branch}${by}`
}

// --- Reading the base branch ------------------------------------------------

/** A commit on the base branch, as far as this needs one. */
export interface BaseCommit {
  sha: string
  /** Committed at, in milliseconds. */
  at: number
  /** The committer's name, when git has one. */
  by?: string
  subject: string
  /**
   * The commits this one says it reverts. Usually one; `git revert a b c` writes
   * a line per commit into a single message, so it can be several.
   */
  reverts: string[]
}

/**
 * The commits a message says it reverts.
 *
 * `git revert` writes `This reverts commit <sha>.` into the body, and reverting a
 * merge extends the same line with `, reversing changes made to <sha>.` — so the
 * first sha on the line is the target and the second, when there is one, is the
 * parent it was reverted against. Only the first is captured.
 *
 * Anchored to the start of a line and requiring a hex sha is what keeps this from
 * matching prose. A commit whose subject is "Revert the retry logic", or whose
 * body argues about whether to revert something, says nothing that git wrote and
 * is not a revert of anything.
 */
export function revertedCommits(message: string): string[] {
  const found: string[] = []
  const pattern = /^[ \t]*This reverts commit ([0-9a-f]{7,40})\b/gim

  for (const match of message.matchAll(pattern)) found.push(match[1]!.toLowerCase())

  return found
}

/**
 * Enough of a sha to index on.
 *
 * Git writes the full forty characters into a revert message, but a
 * hand-written one can be abbreviated, and the recorded landing sha is always
 * full — so the two are compared on the shortest thing git itself guarantees to
 * be unambiguous in a repository of any size.
 */
function key(sha: string): string {
  return sha.slice(0, 7).toLowerCase()
}

/** Field and record separators, so a commit body can contain anything but these. */
const FIELD = '\x1f'
const RECORD = '\x1e'

/** Newest first, the way `git log` hands them over. */
export function parseBaseLog(stdout: string): BaseCommit[] {
  const commits: BaseCommit[] = []

  for (const entry of stdout.split(RECORD)) {
    const [sha = '', seconds = '', by = '', subject = '', body = ''] = entry
      // A leading newline between records, from the format's own trailing one.
      .replace(/^\n+/, '')
      .split(FIELD)

    if (!/^[0-9a-f]{7,40}$/i.test(sha)) continue

    commits.push({
      sha: sha.toLowerCase(),
      at: (Number(seconds) || 0) * 1000,
      ...(by ? { by } : {}),
      subject,
      reverts: revertedCommits(body),
    })
  }

  return commits
}

/**
 * How far back to look, at most.
 *
 * This runs every two minutes against every repository with a landing in it, so
 * the log it reads has to be bounded by something. Both bounds are here: commits
 * older than the earliest landing being asked about cannot revert it, and beyond
 * a few hundred of them the answer is not worth the read. A landing whose revert
 * is further back than this is not found — see the block comment.
 */
const MAX_COMMITS = 500

/**
 * A day of slack on the window, because two clocks are involved: `landed.at` is
 * this process's, and a commit date is whatever made the commit.
 */
const SLACK_MS = 24 * 60 * 60 * 1000

/**
 * The base branch's recent history.
 *
 * Null means the question could not be asked — no such branch, not a repository,
 * git unhappy. That is emphatically not "nothing reverted anything": a caller
 * that treated it as an answer would clear every revert it had recorded the first
 * time a repository was moved.
 */
export async function readBaseLog(
  repoDir: string,
  branch: string,
  since: number,
): Promise<BaseCommit[] | null> {
  try {
    const { stdout } = await exec('git', [
      'log',
      branch,
      `--max-count=${MAX_COMMITS}`,
      // ISO rather than a unix stamp: git parses dates through approxidate, which
      // would read a bare number as something else entirely.
      `--since=${new Date(Math.max(0, since - SLACK_MS)).toISOString()}`,
      `--format=%H${FIELD}%ct${FIELD}%cn${FIELD}%s${FIELD}%B${RECORD}`,
    ], { cwd: repoDir, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })

    return parseBaseLog(stdout)
  } catch {
    return null
  }
}

// --- The decision -----------------------------------------------------------

/**
 * The revert that currently stands against a commit, if one does.
 *
 * Pure, and the whole of the policy. Reverts chain: a revert of a revert puts the
 * work back, and a revert of *that* takes it out again, so the question is not
 * "was this ever reverted" but "does the last word on it say the work is out".
 * That is answered by walking the chain rather than by counting, because two
 * independent reverts of the same commit are one revert's worth of undo and
 * counting them would read as two.
 *
 * The `seen` set is a cycle guard. Nothing sane produces one, and an infinite
 * loop inside a poll would take the scheduler's whole tick with it.
 */
export function standingRevert(sha: string, commits: BaseCommit[]): BaseCommit | null {
  const byTarget = new Map<string, BaseCommit[]>()

  for (const commit of commits) {
    for (const target of commit.reverts) {
      const at = byTarget.get(key(target))
      if (at) at.push(commit)
      else byTarget.set(key(target), [commit])
    }
  }

  const standing = (of: string, seen: Set<string>): BaseCommit | null => {
    if (seen.has(key(of))) return null
    seen.add(key(of))

    for (const candidate of byTarget.get(key(of)) ?? []) {
      // A revert that has not itself been reverted is the one that stands.
      if (!standing(candidate.sha, seen)) return candidate
    }

    return null
  }

  return standing(sha, new Set())
}

// --- The watch --------------------------------------------------------------

/**
 * How long after a landing a revert is still looked for.
 *
 * Not because a later revert would not matter — it would — but because the
 * alternative is reading a growing window of history every two minutes forever.
 * Thirty days is well past the point where a revert is about last night's
 * unattended work, which is the thing this exists to measure.
 */
const WATCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** A landing worth asking about: it named a commit, and it is recent enough. */
function watchable(session: Session, now: number): boolean {
  const landed = session.landed
  if (!landed?.sha) return false

  // A session already marked reverted stays in the poll, so the revert being
  // reverted is noticed too — see the block comment.
  return now - landed.at <= WATCH_WINDOW_MS
}

/** One `git log` per repository and base branch, not per session. */
function groupKey(session: Session): string {
  return `${session.repoDir} ${session.baseBranch}`
}

/** Repositories with a poll in flight, so a slow one cannot stack up. */
const inFlight = new Set<string>()

/**
 * Every landing still in the window, checked against its base branch once.
 *
 * Never throws. This rides a tick that other things ride too, and one repository
 * that git is unhappy about must not stop the others being read.
 */
export async function pollReverts(now = Date.now()): Promise<void> {
  let sessions: Session[]

  try {
    sessions = (await readSessions()).filter(session => watchable(session, now))
  } catch (e) {
    console.error('[reverts] could not read sessions', e)
    return
  }

  const groups = new Map<string, Session[]>()
  for (const session of sessions) {
    const existing = groups.get(groupKey(session))
    if (existing) existing.push(session)
    else groups.set(groupKey(session), [session])
  }

  for (const [group, members] of groups) {
    if (inFlight.has(group)) continue
    inFlight.add(group)

    try {
      await checkRepo(members, now)
    } catch (e: any) {
      console.log(`[reverts] ${members[0]!.repoDir} could not be read: ${e?.message ?? e}`)
    } finally {
      inFlight.delete(group)
    }
  }
}

async function checkRepo(members: Session[], now: number): Promise<void> {
  const { repoDir, baseBranch } = members[0]!

  // A repository that has been moved or deleted. Nothing to say about it, and
  // certainly not that its landings are fine.
  if (!existsSync(repoDir)) return

  const earliest = Math.min(...members.map(session => session.landed!.at))
  const commits = await readBaseLog(repoDir, baseBranch, earliest)

  // Could not ask. See `readBaseLog` — acting on this would clear real records.
  if (!commits) return

  const inView = new Set(commits.map(commit => key(commit.sha)))

  for (const session of members) {
    const landedSha = session.landed!.sha!
    const revert = standingRevert(landedSha, commits)

    if (revert) {
      // Already recorded, and the same commit. Nothing has changed.
      if (session.reverted && key(session.reverted.sha) === key(revert.sha)) continue

      const reverted: SessionReverted = {
        at: now,
        sha: revert.sha,
        committedAt: revert.at,
        ...(revert.by ? { by: revert.by } : {}),
        subject: revert.subject,
        landedSha,
        branch: baseBranch,
      }

      await patchSession(session.id, { reverted })
      console.log(`[reverts] "${session.title}": ${describeReverted(reverted)} (${revert.sha.slice(0, 8)})`)
      continue
    }

    if (!session.reverted) continue

    /*
     * Nothing stands against the landing any more, and the recorded revert is in
     * front of us — so it has been reverted in turn and the work is back. Cleared
     * rather than kept, because the record is now a claim about the base branch
     * that the base branch contradicts.
     *
     * The second half of that condition is load-bearing. A recorded revert that
     * has simply fallen out of the window this poll read is not a revert that was
     * undone, and clearing on that basis would erase every record older than the
     * log it happened to look at.
     */
    if (!inView.has(key(session.reverted.sha))) continue

    await patchSession(session.id, { reverted: undefined })
    console.log(`[reverts] "${session.title}": the revert was itself reverted, so the work is back in ${baseBranch}`)
  }
}
