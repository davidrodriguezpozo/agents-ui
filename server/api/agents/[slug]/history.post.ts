import { readSession, writeSession } from '../../../utils/history'
import type { ConversationSession } from '~/types'

/**
 * Upsert a conversation. The client posts the same session id as a run
 * progresses, so a conversation is saved incrementally rather than only at the
 * end — a run that is stopped halfway still ends up in the history.
 */
export default defineEventHandler(async (event) => {
  const agentSlug = getRouterParam(event, 'slug')!
  const body = await readBody<Partial<ConversationSession>>(event)

  if (!body?.id) {
    throw createError({ statusCode: 400, message: 'id is required' })
  }
  if (!body.messages?.length) {
    throw createError({ statusCode: 400, message: 'messages is required' })
  }

  const existing = await readSession(agentSlug, body.id)
  const now = new Date().toISOString()

  const session: ConversationSession = {
    id: body.id,
    agentSlug,
    origin: body.origin === 'manager' ? 'manager' : 'studio',
    title: body.title || existing?.title || deriveTitle(body.messages),
    messages: body.messages,
    toolCalls: body.toolCalls ?? existing?.toolCalls ?? [],
    tokenUsage: body.tokenUsage ?? existing?.tokenUsage ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    costUsd: body.costUsd ?? existing?.costUsd ?? 0,
    duration: body.duration ?? existing?.duration ?? 0,
    model: body.model ?? existing?.model,
    projectDir: body.projectDir ?? existing?.projectDir,
    sdkSessionId: body.sdkSessionId ?? existing?.sdkSessionId,
    createdAt: existing?.createdAt || body.createdAt || now,
    updatedAt: now,
  }

  const filePath = await writeSession(session)
  return { id: session.id, filePath, createdAt: session.createdAt, updatedAt: session.updatedAt }
})

function deriveTitle(messages: ConversationSession['messages']): string {
  const first = messages.find(m => m.role === 'user')?.content ?? ''
  const flat = first.replace(/\s+/g, ' ').trim()
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat || 'Untitled conversation'
}
