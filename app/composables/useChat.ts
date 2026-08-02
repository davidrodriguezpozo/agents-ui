import type { SkillInvocation, ChatMessage, PermissionRequest, StreamActivity, TokenUsage, ToolCallRecord } from '~/types'

/** Agent slug the global assistant panel files its conversations under. */
export const MANAGER_SLUG = '__manager'

export function useChat() {
  const messages = useState<ChatMessage[]>('chat-messages', () => [])
  const isStreaming = ref(false)
  const sessionId = useState<string | null>('chat-session', () => null)
  const conversationId = useState<string | null>('chat-conversation-id', () => null)
  const error = ref<string | null>(null)
  const activity = ref<StreamActivity>(null)
  const toolCalls = useState<ToolCallRecord[]>('chat-tool-calls', () => [])
  const tokenUsage = useState<TokenUsage>('chat-token-usage', () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }))
  const costUsd = useState('chat-cost', () => 0)

  const permissions = usePermissionPrompts('chat')

  const isPanelOpen = useState<boolean>('chat-panel-open', () => false)
  const activeAgent = useState<{ slug: string; name: string; color?: string } | null>('chat-active-agent', () => null)
  const pendingInput = useState<string>('chat-pending-input', () => '')

  let abortController: AbortController | null = null

  /** Persist the panel conversation so it shows up in history like studio runs. */
  async function persist(projectDir?: string) {
    if (!messages.value.length) return
    if (!conversationId.value) {
      conversationId.value = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    }

    const slug = activeAgent.value?.slug || MANAGER_SLUG
    try {
      await $fetch(`/api/agents/${encodeURIComponent(slug)}/history`, {
        method: 'POST',
        body: {
          id: conversationId.value,
          origin: activeAgent.value ? 'studio' : 'manager',
          messages: messages.value,
          toolCalls: toolCalls.value,
          tokenUsage: tokenUsage.value,
          costUsd: costUsd.value,
          projectDir,
          sdkSessionId: sessionId.value ?? undefined,
        },
      })
    } catch (e) {
      console.error('[useChat] failed to save conversation:', e)
    }
  }

  function addMessage(role: 'user' | 'assistant', content: string): ChatMessage {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: Date.now(),
    }
    messages.value.push(msg)
    return msg
  }

  function updateMessage(id: string, updates: Partial<ChatMessage>) {
    const idx = messages.value.findIndex(m => m.id === id)
    if (idx !== -1) {
      messages.value[idx] = Object.assign({}, messages.value[idx], updates)
    }
  }

  const usedTools = ref(false)

  async function sendMessage(content: string) {
    if (!content.trim() || isStreaming.value) return

    error.value = null
    usedTools.value = false
    addMessage('user', content)

    // Parse slash command
    let invoke: SkillInvocation | undefined
    const trimmed = content.trim()
    if (trimmed.startsWith('/')) {
      const withoutSlash = trimmed.slice(1)
      const spaceIdx = withoutSlash.indexOf(' ')
      if (spaceIdx === -1) {
        invoke = { skill: withoutSlash, args: null }
      } else {
        invoke = {
          skill: withoutSlash.slice(0, spaceIdx),
          args: withoutSlash.slice(spaceIdx + 1).trim() || null,
        }
      }
    }

    const { workingDir } = useWorkingDir()

    const assistantMsg = addMessage('assistant', '')
    isStreaming.value = true
    activity.value = null

    abortController = new AbortController()

    try {
      const response = await $fetch<ReadableStream>('/api/chat', {
        method: 'POST',
        body: {
          messages: messages.value
            .filter(m => m.content)
            .map(m => ({ role: m.role, content: m.content })),
          sessionId: sessionId.value,
          ...(invoke ? { invoke } : {}),
          ...(activeAgent.value ? { agentSlug: activeAgent.value.slug } : {}),
          ...(workingDir.value ? { projectDir: workingDir.value } : {}),
        },
        signal: abortController.signal,
        responseType: 'stream',
      })

      const reader = (response as unknown as ReadableStream).getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamedText = ''
      let streamedThinking = ''

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
            } else if (data.type === 'thinking_start') {
              activity.value = { type: 'thinking' }
              streamedThinking = ''
            } else if (data.type === 'thinking_delta') {
              streamedThinking += data.text
              activity.value = { type: 'thinking' }
              updateMessage(assistantMsg.id, { thinking: streamedThinking })
            } else if (data.type === 'text_delta') {
              streamedText += data.text
              activity.value = { type: 'writing' }
              updateMessage(assistantMsg.id, { content: streamedText })
            } else if (data.type === 'tool_progress') {
              usedTools.value = true
              activity.value = { type: 'tool', name: data.toolName, elapsed: data.elapsed }
              toolCalls.value.push({
                toolName: data.toolName,
                elapsed: data.elapsed,
                timestamp: Date.now(),
              })
            } else if (data.type === 'permission_request') {
              const request = data.request as PermissionRequest
              permissions.add(request)
              activity.value = { type: 'permission', name: request.toolName }
            } else if (data.type === 'permission_resolved') {
              permissions.resolve(String(data.id))
            } else if (data.type === 'result') {
              updateMessage(assistantMsg.id, { content: data.text })
              if (data.stats) {
                tokenUsage.value = {
                  input: tokenUsage.value.input + data.stats.usage.input,
                  output: tokenUsage.value.output + data.stats.usage.output,
                  cacheRead: tokenUsage.value.cacheRead + data.stats.usage.cacheRead,
                  cacheCreation: tokenUsage.value.cacheCreation + data.stats.usage.cacheCreation,
                }
                costUsd.value += data.stats.costUsd
              }
            } else if (data.type === 'error') {
              error.value = data.message
            } else if (data.type === 'done') {
              sessionId.value = data.sessionId
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        error.value = err instanceof Error ? err.message : 'Failed to send message'
      }
    } finally {
      isStreaming.value = false
      activity.value = null
      abortController = null
      // Nothing is listening for answers once the stream is gone.
      permissions.clear()
      await persist(workingDir.value || undefined)
    }
  }

  function stopStreaming() {
    abortController?.abort()
    isStreaming.value = false
    activity.value = null
    permissions.clear()
  }

  function clearChat() {
    messages.value = []
    sessionId.value = null
    conversationId.value = null
    error.value = null
    activity.value = null
    toolCalls.value = []
    tokenUsage.value = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
    costUsd.value = 0
    permissions.clear()
  }

  function startWithPrompt(prompt: string) {
    clearChat()
    nextTick(() => sendMessage(prompt))
  }

  function startAgentChat(agent: { slug: string; name: string; color?: string }) {
    activeAgent.value = agent
    clearChat()
    isPanelOpen.value = true
  }

  function prefillSkill(skillName: string) {
    pendingInput.value = `/${skillName} `
    isPanelOpen.value = true
  }

  /**
   * Run an installed slash command the way it would be typed in the CLI.
   * `invocation` already carries its namespace (e.g. `/hd:address-pr`), so the
   * agent session resolves it from the real settings sources.
   */
  function runCommand(invocation: string, args = '') {
    const prompt = args.trim() ? `${invocation} ${args.trim()}` : invocation
    activeAgent.value = null
    clearChat()
    isPanelOpen.value = true
    nextTick(() => sendMessage(prompt))
  }

  function clearAgent() {
    activeAgent.value = null
  }

  return {
    messages: readonly(messages),
    isStreaming: readonly(isStreaming),
    error: readonly(error),
    activity: readonly(activity),
    sessionId: readonly(sessionId),
    usedTools: readonly(usedTools),
    tokenUsage: readonly(tokenUsage),
    costUsd: readonly(costUsd),
    isPanelOpen,
    activeAgent: readonly(activeAgent),
    pendingInput,
    pendingPermissions: readonly(permissions.pending),
    isAnsweringPermission: permissions.isAnswering,
    answerPermission: permissions.answer,
    sendMessage,
    stopStreaming,
    clearChat,
    startWithPrompt,
    startAgentChat,
    prefillSkill,
    runCommand,
    clearAgent,
  }
}
