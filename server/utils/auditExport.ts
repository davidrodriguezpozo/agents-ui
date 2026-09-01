import type { Identity } from './identity'
import type { RunEvent } from './runStore'
import { repositoryRootOf } from './worktrees'

/**
 * The record, as one file somebody sceptical can read.
 *
 * Every governance conversation about agents assumes a vendor console: a company
 * asks who ran what, and the answer is a dashboard somebody else hosts. A team
 * running this has the opposite problem and the better position — nothing ever
 * left the building, and *therefore* there is no console. This turns that from
 * the weakness in the conversation into the argument, by making the record a
 * file: every run, what it cost, what it touched, what the sandbox refused, and
 * every merge that went in with the checks red and who took it.
 *
 * Five decisions, each of which is the difference between a record and a claim:
 *
 *   - **JSON Lines, not something clever.** One object per line, greppable with
 *     the tools an auditor already has, and readable a line at a time by
 *     anything. A format that needs a parser is a format somebody has to trust.
 *   - **A header line that says what is *not* here, and why.** Silent redaction
 *     is the failure that makes a record worthless: a reader who finds one
 *     omission stops believing the rest. So the exclusions are declared, in the
 *     file, with a reason each.
 *   - **Transcripts are referenced, never embedded.** One file containing every
 *     conversation is a liability nobody asked for — and it is the file that
 *     would leak. The export says where they are on this disk instead.
 *   - **Absent is `null`, and never zero.** A run with no cost recorded is not a
 *     free run; a run from before identity existed has no person, not an unknown
 *     one. Reporting either as a number is how a record becomes a lie.
 *   - **Pure over records somebody else loaded**, so every field can be tested
 *     against fixtures and nothing here depends on what a `git` call answered.
 */

/** Bumped when a line gains or loses a field. Read it before parsing. */
export const AUDIT_FORMAT = 'agents-studio.audit.v1'

/** Beyond this a run's file list is a diff, and a diff belongs in git. */
const MAX_FILES = 50

/**
 * What started a run.
 *
 * `workflow` is kept after the feature was removed, and on purpose: an audit
 * file is built from the run history already on disk, and relabelling runs that
 * really were workflow steps as `unknown` would put a gap in the record to save
 * one line of code.
 */
export type AuditSource = 'session' | 'ritual' | 'workflow' | 'chat' | 'agent' | 'command' | 'unknown'

export interface AuditExclusion {
  field: string
  why: string
}

/**
 * How much of the file is missing a field, counted in the file.
 *
 * The thing a sceptical reader notices first and trusts least: a governance
 * record where almost every row has no person in it. The reason is real —
 * identity is newer than most of these records, and a run written before it has
 * nobody rather than an unknown somebody — but "the reason is real" is not
 * something a reader can check. A count they can, so the file does the noticing
 * for them instead of leaving it to be discovered.
 */
export interface AuditNulls {
  runsWithoutPerson: number
  runsWithoutModel: number
  runsWithoutCost: number
  mergesWithoutPerson: number
  mergesWithoutCommit: number
  note: string
}

export interface AuditHeaderLine {
  type: 'header'
  format: typeof AUDIT_FORMAT
  producedAt: number
  window: { since: number; until: number }
  counts: { runs: number; merges: number }
  /** What is absent from the records themselves, counted. */
  nulls: AuditNulls
  /** What this export leaves out on purpose. Declared, never silent. */
  excluded: AuditExclusion[]
  transcripts: { embedded: false; where: string }
}

export interface AuditRunLine {
  type: 'run'
  id: string
  /** When it was asked for. */
  at: number
  /** When it began, which is not when it was asked for — runs queue. */
  startedAt: number | null
  durationMs: number | null
  /** `personKey` — an address. Null on a ritual and on anything older than identity. */
  who: string | null
  source: AuditSource
  model: string | null
  /** Null when nothing was recorded. Never 0 for "unknown". */
  costUsd: number | null
  outcome: string
  sessionId: string | null
  scheduleId: string | null
  /**
   * The repository, not the workspace. A session's run happens in a worktree,
   * and a reader grepping for a repository would miss every one of them.
   */
  repo: string | null
  /** Where it actually ran, which for a session is its own worktree. */
  workspace: string | null
  /** Files a tool call wrote, from the event log. See `filesTouched`. */
  files: string[]
  /** How many more there were, when the list was cut. */
  filesOmitted: number
  /** Hosts the sandbox refused. */
  hostsRefused: string[]
  /** Tools refused because nobody was there to approve them. */
  toolsDenied: string[]
  /** Set when a limit cut it short, so the record does not read as a finished job. */
  stoppedBy: string | null
}

export interface AuditMergeLine {
  type: 'merge'
  sessionId: string
  at: number
  /** How it went in. `elsewhere` means somebody merged it on github.com. */
  route: string
  /** What the checks said at the time. `none` means no verdict was recorded. */
  checks: 'passing' | 'failing' | 'errored' | 'running' | 'none'
  /** It went in over a failing check. The line this export exists for. */
  override: boolean
  who: string | null
  sha: string | null
  into: string | null
  repo: string | null
}

export type AuditLine = AuditHeaderLine | AuditRunLine | AuditMergeLine

// --- What it is given -------------------------------------------------------

export interface AuditRun {
  id: string
  kind: string
  createdAt: number
  startedAt?: number
  endedAt?: number
  status: string
  sessionId?: string
  scheduleId?: string
  projectDir?: string
  invocation?: string
  stats?: { costUsd?: number; model?: string; durationMs?: number }
  by?: Identity
  events?: RunEvent[]
  refusedHosts?: string[]
  deniedTools?: string[]
  stoppedBy?: string
}

export interface AuditSession {
  id: string
  repoDir?: string
  landed?: {
    at: number
    how: string
    into?: string
    sha?: string
    overrodeChecks?: boolean
    by?: Identity
  }
  check?: { status: string } | null
}

export interface AuditInput {
  since: number
  until: number
  now: number
  runs: AuditRun[]
  sessions: AuditSession[]
  /** Where transcripts live on this machine, for the header to point at. */
  transcriptsAt: string
}

/**
 * What is deliberately not in the file.
 *
 * Written into every export whether or not anybody asks, because the point is
 * that a reader does not have to wonder. Each one is a field a reasonable person
 * would expect and a reason they would accept.
 */
export const AUDIT_EXCLUSIONS: AuditExclusion[] = [
  {
    field: 'run.input',
    why: 'The prompt as sent. It regularly quotes a ticket, an issue or a customer '
      + 'message, so including it would make this file the most sensitive thing on the disk. '
      + 'It is in the transcript.',
  },
  {
    field: 'run.output',
    why: 'What the run said back, for the same reason. The transcript has it.',
  },
  {
    field: 'transcript',
    why: 'Referenced, not embedded — see `transcripts.where`. One file containing every '
      + 'conversation is a liability nobody asked for.',
  },
  {
    field: 'files.contents',
    why: 'Which files a run wrote is here; what it wrote to them is in git, where it can be '
      + 'reviewed against a diff rather than trusted from a log.',
  },
]

// --- Building ---------------------------------------------------------------

/** Tool calls that mean a file on disk is different afterwards. */
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/**
 * The files a run wrote, from its event log.
 *
 * The same reading `turnChangedFiles` does and the same honest limits: an edit
 * whose result came back an error did not happen, and `Bash` is not read at all
 * because a shell line that patches a file is indistinguishable here from one
 * that runs the tests. So this **undercounts**, which is the direction an
 * audit record should err in — and the header does not claim otherwise.
 */
export function filesTouched(events: RunEvent[] = []): string[] {
  const byId = new Map<string, string>()

  for (const event of events) {
    if (event.type === 'tool_use' && EDIT_TOOLS.has(String(event.toolName))) {
      const input = event.input as Record<string, unknown> | undefined
      const path = input?.file_path ?? input?.notebook_path
      if (typeof path === 'string' && path) byId.set(String(event.id), path)
      continue
    }

    if (event.type === 'tool_result' && event.isError) byId.delete(String(event.id))
  }

  return [...new Set(byId.values())].sort()
}

/** What kind of thing asked for this run. */
export function sourceOf(run: AuditRun): AuditSource {
  if (run.scheduleId) return 'ritual'
  if (run.sessionId) return 'session'
  if (run.kind === 'chat') return 'chat'
  if (run.kind === 'agent') return 'agent'
  // Only ever true of a run from before workflows were removed. See `AuditSource`.
  if (run.invocation?.startsWith('workflow:')) return 'workflow'
  // A command invoked from the app is a thing somebody ran, and calling it
  // `unknown` in an audit file invites the one question the file exists to
  // answer.
  if (run.kind === 'command') return 'command'

  return 'unknown'
}

/** The person, as an address, or null. Never a guess — see `identity.ts`. */
function personOf(identity?: Identity): string | null {
  const email = identity?.email?.trim().toLowerCase()
  if (email) return email

  return identity?.name?.trim() || null
}

/** A number only when one was recorded. `undefined` and `0` are not the same fact. */
function numberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The whole export, in order: header, then runs oldest first, then merges.
 *
 * Runs before merges rather than interleaved by time, because the two are read
 * for different questions — "what ran" and "what went in" — and a reader
 * grepping for one should not have to skip the other.
 */
export function auditLines(input: AuditInput): AuditLine[] {
  const runs = input.runs
    .filter(run => within(run.startedAt ?? run.createdAt, input))
    .sort((a, b) => (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt))
    .map(run => runLine(run))

  const merges = input.sessions
    .filter(session => session.landed && within(session.landed.at, input))
    .sort((a, b) => a.landed!.at - b.landed!.at)
    .map(session => mergeLine(session))

  const header: AuditHeaderLine = {
    type: 'header',
    format: AUDIT_FORMAT,
    producedAt: input.now,
    window: { since: input.since, until: input.until },
    counts: { runs: runs.length, merges: merges.length },
    nulls: {
      runsWithoutPerson: runs.filter(line => line.who === null).length,
      runsWithoutModel: runs.filter(line => line.model === null).length,
      runsWithoutCost: runs.filter(line => line.costUsd === null).length,
      mergesWithoutPerson: merges.filter(line => line.who === null).length,
      mergesWithoutCommit: merges.filter(line => line.sha === null).length,
      note: 'A null is a field the record never held, not a zero and not an unknown person. '
        + 'Runs and merges written before this app recorded identity have no person; a merge '
        + 'found already done on github.com has no commit here and no person, because nothing '
        + 'on this machine did it.',
    },
    excluded: AUDIT_EXCLUSIONS,
    transcripts: { embedded: false, where: input.transcriptsAt },
  }

  return [header, ...runs, ...merges]
}

function within(at: number, input: AuditInput): boolean {
  return at >= input.since && at <= input.until
}

function runLine(run: AuditRun): AuditRunLine {
  const all = filesTouched(run.events)
  const started = numberOrNull(run.startedAt)

  return {
    type: 'run',
    id: run.id,
    at: run.createdAt,
    startedAt: started,
    durationMs: numberOrNull(run.stats?.durationMs)
      ?? (run.endedAt && started ? run.endedAt - started : null),
    who: personOf(run.by),
    source: sourceOf(run),
    model: run.stats?.model ?? null,
    costUsd: numberOrNull(run.stats?.costUsd),
    outcome: run.status,
    sessionId: run.sessionId ?? null,
    scheduleId: run.scheduleId ?? null,
    repo: run.projectDir ? repositoryRootOf(run.projectDir) : null,
    workspace: run.projectDir ?? null,
    files: all.slice(0, MAX_FILES),
    filesOmitted: Math.max(0, all.length - MAX_FILES),
    hostsRefused: [...new Set(run.refusedHosts ?? [])].sort(),
    toolsDenied: [...new Set(run.deniedTools ?? [])].sort(),
    stoppedBy: run.stoppedBy ?? null,
  }
}

function mergeLine(session: AuditSession): AuditMergeLine {
  const landed = session.landed!
  const status = session.check?.status

  return {
    type: 'merge',
    sessionId: session.id,
    at: landed.at,
    route: landed.how,
    checks: status === 'passing' || status === 'failing' || status === 'errored' || status === 'running'
      ? status
      : 'none',
    override: landed.overrodeChecks === true,
    who: personOf(landed.by),
    sha: landed.sha ?? null,
    into: landed.into ?? null,
    repo: session.repoDir ?? null,
  }
}

/**
 * The file. One object per line, newline-terminated.
 *
 * `JSON.stringify` per line and nothing else: no pretty printing, because a line
 * that wraps is a line `grep` cannot find.
 */
export function toJsonl(lines: AuditLine[]): string {
  return `${lines.map(line => JSON.stringify(line)).join('\n')}\n`
}

/** What to call the file, so two exports do not overwrite each other. */
export function auditFilename(since: number, until: number): string {
  const day = (at: number) => new Date(at).toISOString().slice(0, 10)

  return `agents-studio-audit-${day(since)}-to-${day(until)}.jsonl`
}
