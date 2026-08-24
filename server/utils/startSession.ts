import { basename } from 'node:path'
import { gitIdentity } from './identity'
import { addProject } from './projects'
import {
  newSessionId, saveSession,
  type Session, type SessionIssueOf, type SessionTicketOf,
} from './sessions'
import type { TrustLevel } from './trust'
import type { ProviderId } from './providers/types'
import {
  branchNameFor,
  createWorktree,
  currentBranch,
  hasCommits,
  isGitRepo,
  worktreePathFor,
} from './worktrees'

/**
 * Cut a branch and an isolated worktree, and record the session that owns them.
 *
 * Shared by starting a session from scratch and by adopting one from the
 * terminal, because the two must produce the same thing: a session adopted
 * from a CLI conversation is an ordinary session that happens to remember an
 * earlier conversation.
 */
export async function startSession(options: {
  repoDir: string
  title: string
  agentSlug?: string
  baseRef?: string
  /** Set when continuing an existing conversation rather than beginning one. */
  sdkSessionId?: string
  adoptedAt?: number
  /**
   * How much this session may do without asking, chosen before it starts.
   *
   * Rituals have always decided this up front. Sessions could only be changed
   * after the fact, which meant the *first* turn — usually the longest, and the
   * one somebody most wants to leave running — ignored the intent entirely.
   */
  trust?: TrustLevel
  /**
   * Which agent this session's turns run through.
   *
   * Decided here and not changed afterwards, for the same reason trust is
   * decided up front: the conversation lives inside one provider's history, and
   * `sdkSessionId` is an id only that provider can resume. Absent means Claude
   * Code, which is what every session before this used.
   */
  provider?: ProviderId
  /** Set when this session is one entrant in a race. See `Session.raceId`. */
  raceId?: string
  /**
   * The branch to cut, when the caller has a better name than the title gives.
   *
   * The default appends the session id, which guarantees a free name and reads
   * as machinery. Work that starts from something already numbered — an issue —
   * has a name people already use for it, and `42-drop-the-cache` is worth more
   * on `git branch` than `42-drop-the-cache-mfx2ab1c` is. The caller owns the
   * collision: git refuses a name that exists, so anyone passing this has to
   * have checked, or be content to fall back to the default by passing nothing.
   */
  branch?: string
  /** The issue this came from, recorded so its row can say a session has it. */
  issueOf?: SessionIssueOf
  /** The Notion ticket this came from, for the same reason. */
  ticketOf?: SessionTicketOf
}): Promise<Session> {
  const { repoDir } = options

  if (!(await isGitRepo(repoDir))) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'not_a_repo',
        message: `${basename(repoDir)} is not a git repository, so it cannot be branched for parallel work.`,
      },
    })
  }

  // A session is a branch and a checkout, and neither can exist before there is
  // a commit to cut them from. Said here, where it is still a sentence about
  // your repository, rather than leaking out of git as an invalid object name.
  if (!(await hasCommits(repoDir))) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'no_commits',
        message: `${basename(repoDir)} has no commits yet, and a session needs one to branch from. `
          + 'Make the first commit — even an empty one — and it will work from there.',
      },
    })
  }

  const id = newSessionId()
  const title = options.title.trim() || 'Untitled session'
  const baseBranch = options.baseRef?.trim() || await currentBranch(repoDir)
  const branch = options.branch?.trim() || branchNameFor(title, id)

  const { path, baseSha } = await createWorktree({
    repoDir,
    path: worktreePathFor(repoDir, id),
    branch,
    baseRef: baseBranch,
  })

  // A repository worth branching is a project worth listing. Added rather than
  // activated: this can be reached from a session started against a path that
  // came from somewhere else, and moving what the person is looking at is not
  // part of what they asked for.
  await addProject(repoDir).catch(() => {})

  const now = Date.now()

  // Asked of the repository, not the worktree, which is seconds old and has
  // whatever config it inherited. Every route into a session comes through here
  // — typed in, adopted from the terminal, started off an issue or a ticket — so
  // the stamp lands on all of them without any of them having to remember.
  const startedBy = await gitIdentity(repoDir)

  return saveSession({
    id,
    title,
    repoDir,
    worktreePath: path,
    branch,
    baseBranch,
    baseSha,
    status: 'idle',
    agentSlug: options.agentSlug,
    // Absent when this repository names nobody, which reads as unattributed.
    startedBy,
    // Absent means the default, which is what every session had before this
    // could be chosen up front.
    trust: options.trust,
    // Absent means Claude Code. See `providerFor`.
    provider: options.provider,
    // Absent on every session that is not one entrant of several.
    raceId: options.raceId,
    issueOf: options.issueOf,
    ticketOf: options.ticketOf,
    sdkSessionId: options.sdkSessionId,
    runIds: [],
    createdAt: now,
    updatedAt: now,
    adoptedAt: options.adoptedAt,
  })
}
