import { errorMessage } from '~/utils/errors'

interface ImproveChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/**
 * Extract the content of ```instructions ... ``` blocks from a message.
 * Returns null if no such block exists.
 */
export function extractInstructionsBlock(text: string): string | null {
  const match = text.match(/```instructions\s*\n([\s\S]*?)```/)
  return match?.[1]?.trim() ?? null
}

export function useImproveChat() {
  const messages = ref<ImproveChatMessage[]>([])
  const isStreaming = ref(false)
  const error = ref<string | null>(null)
  const isOpen = ref(false)
  const sessionId = ref<string | null>(null)

  let abortController: AbortController | null = null

  function newId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  async function sendMessage(content: string, context: {
    name: string
    description: string
    currentInstructions: string
  }) {
    if (!content.trim() || isStreaming.value) return

    error.value = null
    messages.value.push({
      id: newId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    })

    const assistantMsg: ImproveChatMessage = {
      id: newId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }
    messages.value.push(assistantMsg)
    isStreaming.value = true

    abortController = new AbortController()

    try {
      const response = await $fetch<ReadableStream>('/api/agents/improve-chat', {
        method: 'POST',
        body: {
          messages: messages.value
            .filter(m => m.role === 'user')
            .map(m => ({ role: m.role, content: m.content })),
          name: context.name,
          description: context.description,
          currentInstructions: context.currentInstructions,
          sessionId: sessionId.value,
        },
        signal: abortController.signal,
        responseType: 'stream',
      })

      const reader = (response as unknown as ReadableStream).getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamedText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'session') {
              sessionId.value = data.sessionId
            } else if (data.type === 'text_delta') {
              streamedText += data.text
              const idx = messages.value.findIndex(m => m.id === assistantMsg.id)
              if (idx !== -1) {
                messages.value[idx] = { ...messages.value[idx]!, content: streamedText }
              }
            } else if (data.type === 'result') {
              const idx = messages.value.findIndex(m => m.id === assistantMsg.id)
              if (idx !== -1) {
                messages.value[idx] = { ...messages.value[idx]!, content: data.text }
              }
            } else if (data.type === 'error') {
              error.value = data.message
            } else if (data.type === 'done') {
              sessionId.value = data.sessionId
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        error.value = errorMessage(err, 'Failed to get response')
      }
    } finally {
      isStreaming.value = false
      abortController = null
    }
  }

  function stop() {
    abortController?.abort()
    isStreaming.value = false
  }

  function open(initialPrompt?: string) {
    isOpen.value = true
    // If opening fresh with no history, we'll let the user type first
    if (initialPrompt && !messages.value.length) {
      // Auto-send handled by the caller
    }
  }

  function close() {
    isOpen.value = false
  }

  function reset() {
    messages.value = []
    sessionId.value = null
    error.value = null
    isStreaming.value = false
    abortController?.abort()
    abortController = null
  }

  return {
    messages: readonly(messages),
    isStreaming: readonly(isStreaming),
    error: readonly(error),
    isOpen,
    sendMessage,
    stop,
    open,
    close,
    reset,
  }
}
