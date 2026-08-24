import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'
import { clearQueuedAttachments } from './queuedAttachments'
import type { SessionCheck } from './checks'
import type { SessionSummary } from './sessionSummary'
import type { SessionLanded } from './landed'
import type { SessionReverted } from './revertWatch'
import type { SessionRepair } from './sessionRepair'
import type { SessionPrWatch } from './prWatch'
import type { SessionIssueReply } from './issueReply'
import type { QueuedMessage } from './sessionQueue'
import type { TrustLevel } from './trust'
import type { Identity } from './identity'
import type { ProviderId } from './providers/types'

/**
 * A session is a conversation with its own isolated copy of a repository.
 *
 * The SDK has no long-lived session object of its own — continuity comes from
 * passing `resume: sdkSessionId` on each turn. So a session here is a durable
 * record that owns a worktree, a branch, and an ordered list of runs; each
 * message the user sends becomes another run against the same SDK session.
 */

export type SessionStatus = 'idle' | 'running' | 'archived'

/** Which pull request a session is reading, and at which commit. */
export interface SessionReviewOf {
  number: number
  /** The head commit checked out here — what the findings are about. */
  headSha: string
  url?: string
}

/** Which issue a session was started from. */
export interface SessionIssueOf {
  number: number
  url: string
  /** What the issue was called when the session began. Only for reading. */
  title?: string
}

/**
 * Which Notion ticket a session was started from.
 *
 * Beside `issueOf` rather than folded into it, because the two identify their
 * work with different things and there is nothing to gain from a field that is a
 * number here and a page id there. `id` is the page id — the only stable thing
 * about a Notion page, since the title gets edited and the status is the part
 * that moves.
 */
export interface SessionTicketOf {
  id: string
  url: string
  /** What the ticket was called when the session began. Only for reading. */
  title?: string
}

export interface Session {
  id: string
  title: string
  /** The repository this session branched from. */
  repoDir: string
  worktreePath: string
  branch: string
  baseBranch: string
  baseSha: string
  /**
   * Set when this workspace is a detached checkout of a commit rather than a
   * branch — how a review is taken, so that reading a pull request does not
   * take its branch away from whatever is working on it. `branch` still names
   * the pull request's head branch, because that is what a person needs to see;
   * nothing here has that branch checked out. See `createDetachedWorktree`.
   */
  detached?: true
  /**
   * Set when the branch existed before this session: somebody's pull request,
   * a colleague's branch, a workspace this session took over. Closing such a
   * session must not delete the branch — it is not this session's to destroy,
   * and `close-empty` will happily do it otherwise, taking unpushed commits
   * that were never this session's work with it.
   */
  borrowedBranch?: true
  status: SessionStatus
  /**
   * Which agent this session's turns run through. **Absent means Claude Code.**
   *
   * Chosen when the session is created and not changed afterwards: the
   * conversation lives inside one provider's history, and `sdkSessionId` is an
   * id only that provider can resume. Switching mid-session would silently
   * start a second conversation in a worktree already half-finished.
   */
  provider?: ProviderId
  /**
   * That this session is one of several started together on one instruction,
   * one per agent, to see which of them does it best.
   *
   * Shared by every entrant and by nothing else, so it is both the grouping and
   * the answer to "why are there three of these". Absent on every ordinary
   * session, which is nearly all of them.
   *
   * The entrants are otherwise completely independent — their own worktree,
   * branch, turns, checks and record — and that is the design rather than a
   * shortcut. A race is a way of *starting* work and a way of *reading* it; it
   * is deliberately not a thing that runs, because every mechanism it would need
   * already exists per session and a second one that coordinated them would be a
   * second place for a session to get stuck.
   */
  raceId?: string
  /**
   * Continuity across turns. Set from the first run's init message.
   *
   * "The id this provider resumes with" — a Claude Code `session_id`, or a
   * `cursor-agent` chat id. It keeps the SDK's name because it is on disk in
   * every session record ever written here.
   */
  sdkSessionId?: string
  agentSlug?: string
  /**
   * Who cut this workspace, as git names them at the moment it was cut. See
   * `identity.ts`.
   *
   * Not the same fact as who sent any given turn — a session started by one
   * person and picked up by another is an ordinary Tuesday, and each turn
   * carries its own. This one answers "whose branch is that", which is the
   * question a list of twenty worktrees raises. Absent on every session recorded
   * before this existed, which reads as unattributed.
   */
  startedBy?: Identity
  runIds: string[]
  createdAt: number
  updatedAt: number
  /** Set when the worktree has been removed but the record is kept. */
  worktreeRemovedAt?: number
  /** Set when this record was rebuilt from a worktree rather than created. */
  recoveredAt?: number
  /**
   * How much this session is trusted without asking. Absent means `edits`,
   * which is what every session did before the setting existed.
   */
  trust?: TrustLevel
  /** Set once this session's branch has a pull request open. */
  prUrl?: string
  /**
   * The pull request this session was opened to *read*, and the commit it read.
   *
   * Not the same fact as `prUrl`, which says this session's own work has a pull
   * request open. This one says the opposite: the session is a review of
   * somebody else's, holding a detached checkout of their head commit.
   *
   * It exists because the review has to be postable afterwards. Everything
   * needed to do that — which pull request, and which commit the findings
   * describe — was known at the moment the workspace was cut and then thrown
   * away, leaving a session whose whole purpose was a pull request it could not
   * name. The commit is the load-bearing half: a review composed against a head
   * the author has since pushed past is anchored to lines that no longer exist,
   * and posting it would attach real comments to the wrong code.
   */
  reviewOf?: SessionReviewOf
  /**
   * The issue this session was started from.
   *
   * The band on Land has to be able to say **Has a session already**, and until
   * this existed the only evidence was the branch name — `42-drop-the-cache`
   * looks like work on #42 and so does `fix-login-42abc`, and neither is proof.
   * A recorded number is. The branch is still read as a fallback, for the
   * sessions that started before this and for a branch cut by hand.
   *
   * Nothing here is written back to GitHub by recording it. It says where the
   * work came from, which is what a row needs to stop offering to start it
   * again. The one thing that *is* written back is `issueReply`, and it is a
   * separate field for exactly that reason.
   */
  issueOf?: SessionIssueOf
  /**
   * That the issue has been told, once, and what was said.
   *
   * The only thing in this app that writes to a tracker, so it is on the record
   * rather than inferred: without it, a session opening a second pull request
   * would comment a second time, and "one comment per session per issue" would
   * be a claim nothing enforced. Absent means nothing has been posted — which is
   * the ordinary case, since `issueWriteback` is off by default. See
   * `issueReply.ts`, which is the only writer.
   */
  issueReply?: SessionIssueReply
  /**
   * The Notion ticket this session was started from.
   *
   * The same job `issueOf` does for the GitHub half of the band: without it a
   * ticket's row cannot say **Has a session already**, and pressing it twice cuts
   * two worktrees on one piece of work. Unlike an issue there is no fallback — a
   * page id is not something anybody puts in a branch name — so a session started
   * before this field existed reads as unstarted, which is at least honest.
   *
   * Nothing here is ever written back to Notion. It says where the work came
   * from, which is what a row needs to stop offering to start it again.
   */
  ticketOf?: SessionTicketOf
  /**
   * Whether this session is still following the pull request it opened —
   * reading the checks GitHub ran, fixing them when they go red, and landing it
   * when they come good. Absent means it is not, which is what opening a pull
   * request did before this existed.
   */
  prWatch?: SessionPrWatch
  /**
   * How the project's own checks last went in this session's workspace.
   * Absent means they have never run here — which is not the same as passing,
   * and is shown as the difference it is.
   */
  check?: SessionCheck
  /** What this session did, in a sentence, written by a small model. */
  summary?: SessionSummary
  /**
   * That its work is in, and how it got there.
   *
   * Absent means it has not landed — which, before this existed, was what a
   * landed session looked like too. See `landed.ts` for the three routes in.
   */
  landed?: SessionLanded
  /**
   * That its work was taken back out of the base branch again.
   *
   * Set beside `landed` rather than replacing it, because both are true: the work
   * did land, and it did not hold. Absent is the ordinary case, and is also what
   * a landing that cannot be followed looks like — see `revertWatch.ts` for which
   * ones those are. Cleared again if the revert is itself reverted.
   */
  reverted?: SessionReverted
  /**
   * Whether this session is trying to fix its own failing checks, and how far
   * it has got. Absent means it is not, and never has been on this instruction.
   */
  repair?: SessionRepair
  /**
   * When the person said they were done with this session.
   *
   * Not a state a session can reach on its own, and deliberately so: every
   * automatic reading of "finished" available here — the process has stopped,
   * nothing is committed, no pull request exists — is also what a session looks
   * like halfway through a conversation, waiting on the next instruction. So
   * this is the one that is asked for rather than inferred. Cleared when a turn
   * starts, since sending one says it plainly enough.
   *
   * Nothing else reads it: the worktree stays, the branch stays, the record
   * stays. It moves the row from In flight to History and does nothing more.
   */
  filedAt?: number
  /**
   * Set when the session continues a conversation started in the terminal.
   * The work has moved to a fresh checkout, which the conversation does not
   * know yet — see the note the session offers to send first.
   */
  adoptedAt?: number
  /**
   * What was typed while a turn was running, waiting its turn.
   *
   * Kept on the record rather than in the page because the turn being waited
   * for outlasts the tab — see `sessionQueue.ts` for the whole of it. Drained
   * one message per turn, oldest first.
   */
  queued?: QueuedMessage[]
}

/**
 * Parallel sessions save at the same time by design, so this is exactly the
 * case the store's lock exists for.
 */
export const sessionStore = defineJsonStore<Session[]>({
  label: 'sessions',
  path: () => join(getClaudeDir(), 'agents-ui', 'sessions.json'),
  empty: () => [],
  decode: parsed => parsed?.sessions ?? [],
  encode: sessions => ({ version: 1, sessions }),
})

/** Long enough to be distinguishable, short enough to scan a list of them. */
const TITLE_MAX = 70

/**
 * A name for a session, from the thing it was asked to do.
 *
 * Sessions used to be named by hand and then told what to do separately, which
 * meant typing the same intent twice. Now the instruction is the only thing
 * typed, and this is what turns a paragraph into something a list can show —
 * the first line, cut at a word rather than mid-word, with the rest implied.
 */
export function titleFromPrompt(prompt: string): string {
  const firstLine = prompt
    .split('\n')
    .map(line => line.trim())
    // Skip anything that carries no words of its own: a prompt opening with a
    // markdown heading marker or a bullet would otherwise be titled "#".
    .find(line => /[a-z0-9]/i.test(line.replace(/^[#>*\-\d.\s]+/, '')))

  const cleaned = (firstLine ?? '').replace(/^[#>*\-\s]+/, '').trim()
  if (!cleaned) return 'Untitled session'
  if (cleaned.length <= TITLE_MAX) return cleaned

  const cut = cleaned.slice(0, TITLE_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  // Only respect the word boundary if it leaves something worth reading.
  return `${(lastSpace > TITLE_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export function newSessionId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export async function readSessions(): Promise<Session[]> {
  return sessionStore.read()
}

export async function writeSessions(sessions: Session[]): Promise<void> {
  return sessionStore.write(sessions)
}

export async function findSession(id: string): Promise<Session | null> {
  return (await readSessions()).find(s => s.id === id) ?? null
}

export async function saveSession(session: Session): Promise<Session> {
  return sessionStore.update((sessions) => {
    const next = { ...session, updatedAt: Date.now() }
    const index = sessions.findIndex(s => s.id === session.id)

    if (index >= 0) sessions[index] = next
    else sessions.push(next)

    return next
  })
}

export async function patchSession(id: string, patch: Partial<Session>): Promise<Session | null> {
  return sessionStore.update((sessions) => {
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return null

    const next = { ...sessions[index]!, ...patch, id, updatedAt: Date.now() }
    sessions[index] = next
    return next
  })
}

/**
 * Hand a session back to the person after a turn is stopped early.
 *
 * The turn's own `finally` already does this when the run unwinds, but a
 * cancelled run is reported to the browser the moment it aborts — before the
 * SDK has returned. Reloading in that window would find the session still
 * marked `running` and leave the composer disabled with nothing left to wait
 * for. An archived session is left alone: closing one is a deliberate end
 * state, not something a late cancellation should undo.
 */
export async function releaseRunningSession(id: string): Promise<Session | null> {
  return sessionStore.update((sessions) => {
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return null

    const current = sessions[index]!
    if (current.status !== 'running') return current

    const next: Session = { ...current, status: 'idle', updatedAt: Date.now() }
    sessions[index] = next
    return next
  })
}

export async function deleteSession(id: string): Promise<boolean> {
  const deleted = await sessionStore.update((sessions) => {
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return false
    sessions.splice(index, 1)
    return true
  })

  // Anything its queue was still holding. Nothing will ever look these up
  // again, and images are the one thing a session leaves behind that is
  // measured in megabytes.
  if (deleted) await clearQueuedAttachments(id)

  return deleted
}
