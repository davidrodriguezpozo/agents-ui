import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getClaudeDir } from './claudeDir'

/**
 * A session is a conversation with its own isolated copy of a repository.
 *
 * The SDK has no long-lived session object of its own — continuity comes from
 * passing `resume: sdkSessionId` on each turn. So a session here is a durable
 * record that owns a worktree, a branch, and an ordered list of runs; each
 * message the user sends becomes another run against the same SDK session.
 */

export type SessionStatus = 'idle' | 'running' | 'archived'

export interface Session {
  id: string
  title: string
  /** The repository this session branched from. */
  repoDir: string
  worktreePath: string
  branch: string
  baseBranch: string
  baseSha: string
  status: SessionStatus
  /** Continuity across turns. Set from the first run's init message. */
  sdkSessionId?: string
  agentSlug?: string
  runIds: string[]
  createdAt: number
  updatedAt: number
  /** Set when the worktree has been removed but the record is kept. */
  worktreeRemovedAt?: number
  /** Set when this record was rebuilt from a worktree rather than created. */
  recoveredAt?: number
}

interface SessionFile {
  version: number
  sessions: Session[]
}

function sessionsPath(): string {
  return join(getClaudeDir(), 'agents-ui', 'sessions.json')
}

export function newSessionId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Every session lives in one shared file, and mutating it is read-modify-write.
 * Parallel sessions save at the same time by design, so without a lock two
 * saves interleave and the slower one writes back a snapshot taken before the
 * other's change — silently dropping it. Serialising costs nothing at this
 * scale and removes the whole class of lost update.
 */
let queue: Promise<unknown> = Promise.resolve()

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.then(() => {}, () => {})
  return run
}

export class SessionStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionStoreError'
  }
}

function parseSessions(raw: string): Session[] {
  const parsed = JSON.parse(raw) as SessionFile
  return parsed.sessions ?? []
}

/**
 * A missing file means no sessions yet. A file we cannot parse means something
 * damaged it — and that must not be reported as "no sessions", because an empty
 * list makes every real worktree look orphaned and invites the user to delete
 * work that was never lost. Fall back to the backup, then fail loudly.
 */
export async function readSessions(): Promise<Session[]> {
  const path = sessionsPath()
  if (!existsSync(path)) return []

  try {
    return parseSessions(await readFile(path, 'utf-8'))
  } catch (primary) {
    try {
      return parseSessions(await readFile(`${path}.bak`, 'utf-8'))
    } catch {
      throw new SessionStoreError(
        `The session index at ${path} is unreadable (${(primary as Error).message}). `
        + 'Your worktrees and branches are untouched — sessions can be restored from them.',
      )
    }
  }
}

export async function writeSessions(sessions: Session[]): Promise<void> {
  const path = sessionsPath()
  await mkdir(dirname(path), { recursive: true })

  // Keep the last good copy before replacing it.
  if (existsSync(path)) await copyFile(path, `${path}.bak`).catch(() => {})

  // Write-then-rename: rename is atomic, so a crash or a full disk mid-write
  // leaves the previous index intact instead of a truncated file that would
  // lose every session at once.
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify({ version: 1, sessions }, null, 2), 'utf-8')
  await rename(tmp, path)
}

export async function findSession(id: string): Promise<Session | null> {
  return (await readSessions()).find(s => s.id === id) ?? null
}

export async function saveSession(session: Session): Promise<Session> {
  return exclusive(async () => {
    const sessions = await readSessions()
    const index = sessions.findIndex(s => s.id === session.id)

    const next = { ...session, updatedAt: Date.now() }
    if (index >= 0) sessions[index] = next
    else sessions.push(next)

    await writeSessions(sessions)
    return next
  })
}

export async function patchSession(id: string, patch: Partial<Session>): Promise<Session | null> {
  // Re-read inside the lock: the caller's copy may already be stale.
  return exclusive(async () => {
    const sessions = await readSessions()
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return null

    const next = { ...sessions[index]!, ...patch, id, updatedAt: Date.now() }
    sessions[index] = next
    await writeSessions(sessions)
    return next
  })
}

export async function deleteSession(id: string): Promise<boolean> {
  return exclusive(async () => {
    const sessions = await readSessions()
    const next = sessions.filter(s => s.id !== id)
    if (next.length === sessions.length) return false
    await writeSessions(next)
    return true
  })
}
