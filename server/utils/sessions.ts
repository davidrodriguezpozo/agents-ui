import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'

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

export async function deleteSession(id: string): Promise<boolean> {
  return sessionStore.update((sessions) => {
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return false
    sessions.splice(index, 1)
    return true
  })
}
