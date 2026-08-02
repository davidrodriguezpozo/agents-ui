import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import type { ConversationSession, ConversationSummary, TokenUsage } from '~/types'

const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }

/**
 * Conversations live under the user's Claude directory regardless of scope —
 * they are app data about a run, not project configuration, and we don't want
 * to drop JSON logs into someone's repository.
 */
export function historyDir(agentSlug: string): string {
  return join(getClaudeDir(), 'agent-history', sanitize(agentSlug))
}

export function historyPath(agentSlug: string, id: string): string {
  return join(historyDir(agentSlug), `${sanitize(id)}.json`)
}

/** Keep ids and slugs to a single path segment. */
function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export async function writeSession(session: ConversationSession): Promise<string> {
  const dir = historyDir(session.agentSlug)
  await mkdir(dir, { recursive: true })
  const path = historyPath(session.agentSlug, session.id)
  await writeFile(path, JSON.stringify(session, null, 2), 'utf-8')
  return path
}

export async function readSession(agentSlug: string, id: string): Promise<ConversationSession | null> {
  const path = historyPath(agentSlug, id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as ConversationSession
  } catch {
    return null
  }
}

export function summarize(session: Partial<ConversationSession>, fallbackId: string): ConversationSummary {
  const messages = session.messages ?? []
  const firstUser = messages.find(m => m.role === 'user')?.content ?? ''

  return {
    id: session.id || fallbackId,
    agentSlug: session.agentSlug || '',
    origin: session.origin === 'manager' ? 'manager' : 'studio',
    title: session.title || truncate(firstUser, 60) || 'Untitled conversation',
    messageCount: messages.length,
    toolCallCount: session.toolCalls?.length ?? 0,
    tokenUsage: session.tokenUsage ?? EMPTY_USAGE,
    costUsd: session.costUsd ?? 0,
    firstUserMessage: firstUser,
    createdAt: session.createdAt || '',
    updatedAt: session.updatedAt || session.createdAt || '',
  }
}

export async function listSessions(agentSlug: string, limit = 50): Promise<ConversationSummary[]> {
  const dir = historyDir(agentSlug)
  if (!existsSync(dir)) return []

  const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort().reverse()
  const summaries: ConversationSummary[] = []

  for (const file of files.slice(0, limit)) {
    try {
      const session = JSON.parse(await readFile(join(dir, file), 'utf-8')) as ConversationSession
      summaries.push(summarize(session, file.replace(/\.json$/, '')))
    } catch {
      // Skip malformed files
    }
  }

  return summaries.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
