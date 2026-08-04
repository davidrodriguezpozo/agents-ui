import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'
import type { SessionCheck } from './checks'
import type { TrustLevel } from './trust'

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
  /**
   * How much this session is trusted without asking. Absent means `edits`,
   * which is what every session did before the setting existed.
   */
  trust?: TrustLevel
  /** Set once this session's branch has a pull request open. */
  prUrl?: string
  /**
   * How the project's own checks last went in this session's workspace.
   * Absent means they have never run here — which is not the same as passing,
   * and is shown as the difference it is.
   */
  check?: SessionCheck
  /**
   * Set when the session continues a conversation started in the terminal.
   * The work has moved to a fresh checkout, which the conversation does not
   * know yet — see the note the session offers to send first.
   */
  adoptedAt?: number
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
  return sessionStore.update((sessions) => {
    const index = sessions.findIndex(s => s.id === id)
    if (index < 0) return false
    sessions.splice(index, 1)
    return true
  })
}
