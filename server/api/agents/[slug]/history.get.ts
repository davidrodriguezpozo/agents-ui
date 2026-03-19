import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

interface ConversationSummary {
  id: string
  agentSlug: string
  messageCount: number
  firstUserMessage: string
  createdAt: string
}

export default defineEventHandler(async (event): Promise<ConversationSummary[]> => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, message: 'slug is required' })

  const historyDir = resolveClaudePath('agent-history', slug)
  if (!existsSync(historyDir)) return []

  const files = await readdir(historyDir)
  const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse()

  const summaries: ConversationSummary[] = []

  for (const file of jsonFiles.slice(0, 50)) {
    try {
      const raw = await readFile(join(historyDir, file), 'utf-8')
      const session = JSON.parse(raw)
      const userMessages = (session.messages || []).filter((m: { role: string }) => m.role === 'user')
      summaries.push({
        id: session.id || file.replace('.json', ''),
        agentSlug: slug,
        messageCount: (session.messages || []).length,
        firstUserMessage: userMessages[0]?.content || '',
        createdAt: session.createdAt || file.replace('.json', ''),
      })
    } catch {
      // Skip malformed files
    }
  }

  return summaries
})
