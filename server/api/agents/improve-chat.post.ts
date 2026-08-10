import { query } from '@anthropic-ai/claude-agent-sdk'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ImproveChatRequest {
  messages: ChatMessage[]
  name: string
  description: string
  currentInstructions: string
  sessionId?: string
}

const SYSTEM_PROMPT = `You are an expert at writing Claude Code agent instructions. You are helping the user improve the system prompt (instructions) for their agent.

Your job is to have a conversation about what the agent should do and how the instructions can be improved. Be concise and direct.

When you propose updated instructions, wrap them in a special block so the UI can offer an "Apply" button:

\`\`\`instructions
<the full updated instructions go here>
\`\`\`

Rules:
- Start by briefly analyzing the current instructions (or lack thereof) and asking what the user wants to improve or add. Keep this short — 2-3 sentences max.
- When the user gives direction, propose concrete changes using the \`\`\`instructions\`\`\` block.
- Always include the FULL instructions in the block, not just the changed parts.
- If the user asks for a specific change, make that change and nothing else.
- Don't be preachy. Don't over-explain. Be a collaborator, not a lecturer.
- If the instructions are empty, ask what the agent should do before generating anything.`

export default defineEventHandler(async (event) => {
  const body = await readBody<ImproveChatRequest>(event)

  if (!body.messages?.length) {
    throw createError({ statusCode: 400, message: 'messages is required' })
  }

  const lastUserMessage = body.messages.filter(m => m.role === 'user').pop()
  if (!lastUserMessage) {
    throw createError({ statusCode: 400, message: 'No user message found' })
  }

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const sendEvent = (type: string, data: unknown) => {
    if (event.node.res.writableEnded) return
    event.node.res.write(`data: ${JSON.stringify({ type, ...data as object })}\n\n`)
  }

  const abortController = new AbortController()
  event.node.req.on('close', () => abortController.abort())

  const contextBlock = [
    `Agent name: ${body.name}`,
    `Agent description: ${body.description}`,
    body.currentInstructions.trim()
      ? `Current instructions:\n\`\`\`\n${body.currentInstructions}\n\`\`\``
      : 'Current instructions: (empty — this is a new agent)',
  ].join('\n')

  // Build the conversation history for context, prepending the instructions context to the first user message
  const conversationMessages = body.messages.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      return { role: m.role, content: `${contextBlock}\n\n${m.content}` }
    }
    return m
  })

  const prompt = conversationMessages.map(m => `${m.role}: ${m.content}`).join('\n\n')

  let sessionId = body.sessionId || null

  try {
    for await (const message of query({
      prompt,
      options: {
        maxTurns: 1,
        allowedTools: [],
        systemPrompt: SYSTEM_PROMPT,
        ...(sessionId ? { resume: sessionId } : {}),
        abortController,
      },
    })) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id
        sendEvent('session', { sessionId })
      }

      if (message.type === 'stream_event' && message.event) {
        const evt = message.event as {
          type: string
          delta?: { type: string; text?: string; thinking?: string }
        }
        if (evt.type === 'content_block_delta') {
          if (evt.delta?.type === 'text_delta' && evt.delta.text) {
            sendEvent('text_delta', { text: evt.delta.text })
          }
        }
      }

      if ('result' in message) {
        sendEvent('result', { text: message.result })
      }
    }
  } catch (err: unknown) {
    if (!(err instanceof Error && err.name === 'AbortError')) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      sendEvent('error', { message: errorMessage })
    }
  } finally {
    sendEvent('done', { sessionId })
    event.node.res.end()
  }
})
