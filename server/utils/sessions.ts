import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

export async function readSessions(): Promise<Session[]> {
  const path = sessionsPath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as SessionFile
    return parsed.sessions ?? []
  } catch {
    return []
  }
}

export async function writeSessions(sessions: Session[]): Promise<void> {
  const path = sessionsPath()
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify({ version: 1, sessions }, null, 2), 'utf-8')
}

export async function findSession(id: string): Promise<Session | null> {
  return (await readSessions()).find(s => s.id === id) ?? null
}

export async function saveSession(session: Session): Promise<Session> {
  const sessions = await readSessions()
  const index = sessions.findIndex(s => s.id === session.id)

  const next = { ...session, updatedAt: Date.now() }
  if (index >= 0) sessions[index] = next
  else sessions.push(next)

  await writeSessions(sessions)
  return next
}

export async function patchSession(id: string, patch: Partial<Session>): Promise<Session | null> {
  const session = await findSession(id)
  if (!session) return null
  return saveSession({ ...session, ...patch })
}

export async function deleteSession(id: string): Promise<boolean> {
  const sessions = await readSessions()
  const next = sessions.filter(s => s.id !== id)
  if (next.length === sessions.length) return false
  await writeSessions(next)
  return true
}
