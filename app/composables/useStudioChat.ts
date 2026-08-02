import type {
  ChatMessage,
  ConversationSession,
  PermissionRequest,
  RunConfig,
  RunStats,
  StreamActivity,
  TokenUsage,
  ToolCallRecord,
} from '~/types'
import { DEFAULT_RUN_CONFIG } from '~/types'

export interface ToolInvocation {
  id: string
  toolName: string
  input: unknown
  result?: string
  isError?: boolean
  startedAt: number
  completedAt?: number
}

const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useStudioChat() {
  const messages = useState<ChatMessage[]>('studio-chat-messages', () => [])
  const isStreaming = ref(false)
  const sessionId = useState<string | null>('studio-chat-session', () => null)
  const conversationId = useState<string | null>('studio-conversation-id', () => null)
  const error = ref<string | null>(null)
  const activity = ref<StreamActivity>(null)
  const toolCalls = useState<ToolCallRecord[]>('studio-tool-calls', () => [])
  const invocations = useState<ToolInvocation[]>('studio-invocations', () => [])
  const tokenUsage = useState<TokenUsage>('studio-token-usage', () => ({ ...EMPTY_USAGE }))
  const costUsd = useState('studio-cost', () => 0)
  const lastRun = useState<RunStats | null>('studio-last-run', () => null)
  const effectiveConfig = useState<Record<string, unknown> | null>('studio-effective-config', () => null)
  const runConfig = useState<RunConfig>('studio-run-config', () => ({ ...DEFAULT_RUN_CONFIG }))
  const permissions = usePermissionPrompts('studio')

  let abortController: AbortController | null = null
  let currentAgentSlug = ''

  function addMessage(role: 'user' | 'assistant', content: string): ChatMessage {
    const msg: ChatMessage = { id: newId(), role, content, timestamp: Date.now() }
    messages.value.push(msg)
    return msg
  }

  function updateMessage(id: string, updates: Partial<ChatMessage>) {
    const idx = messages.value.findIndex(m => m.id === id)
    if (idx !== -1) {
      messages.value[idx] = Object.assign({}, messages.value[idx], updates)
    }
  }

  /** Persist the conversation so it survives a refresh and shows up in history. */
  async function persist(agentSlug: string, projectDir?: string) {
    if (!agentSlug || !messages.value.length) return
    if (!conversationId.value) conversationId.value = newId()

    try {
      await $fetch(`/api/agents/${encodeURIComponent(agentSlug)}/history`, {
        method: 'POST',
        body: {
          id: conversationId.value,
          origin: 'studio',
          messages: messages.value,
          toolCalls: toolCalls.value,
          tokenUsage: tokenUsage.value,
          costUsd: costUsd.value,
          duration: lastRun.value?.durationMs ?? 0,
          model: lastRun.value?.model,
          projectDir,
          sdkSessionId: sessionId.value ?? undefined,
        } satisfies Partial<ConversationSession>,
      })
    } catch (e) {
      console.error('[useStudioChat] failed to save conversation:', e)
    }
  }

  async function sendMessage(content: string, opts: {
    agentSlug: string
    systemPromptOverride?: string
    projectDir?: string
  }) {
    if (!content.trim() || isStreaming.value) return

    currentAgentSlug = opts.agentSlug
    error.value = null
    addMessage('user', content)

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
          agentSlug: opts.agentSlug,
          ...(opts.systemPromptOverride ? { systemPromptOverride: opts.systemPromptOverride } : {}),
          ...(opts.projectDir ? { projectDir: opts.projectDir } : {}),
          allowedTools: runConfig.value.allowedTools,
          disallowedTools: runConfig.value.disallowedTools,
          permissionMode: runConfig.value.permissionMode,
          maxTurns: runConfig.value.maxTurns,
          loadProjectSettings: runConfig.value.loadProjectSettings,
          model: runConfig.value.model,
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
            } else if (data.type === 'run_config') {
              effectiveConfig.value = data
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
            } else if (data.type === 'tool_use') {
              invocations.value.push({
                id: data.id,
                toolName: data.toolName,
                input: data.input,
                startedAt: Date.now(),
              })
              activity.value = { type: 'tool', name: data.toolName, elapsed: 0 }
            } else if (data.type === 'tool_result') {
              const idx = invocations.value.findIndex(i => i.id === data.id)
              if (idx !== -1) {
                invocations.value[idx] = {
                  ...invocations.value[idx]!,
                  result: data.preview,
                  isError: data.isError,
                  completedAt: Date.now(),
                }
              }
            } else if (data.type === 'permission_request') {
              const request = data.request as PermissionRequest
              permissions.add(request)
              activity.value = { type: 'permission', name: request.toolName }
            } else if (data.type === 'permission_resolved') {
              permissions.resolve(String(data.id))
            } else if (data.type === 'tool_progress') {
              activity.value = { type: 'tool', name: data.toolName, elapsed: data.elapsed }
              toolCalls.value.push({
                toolName: data.toolName,
                elapsed: data.elapsed,
                timestamp: Date.now(),
              })
            } else if (data.type === 'result') {
              updateMessage(assistantMsg.id, { content: data.text })
              if (data.stats) {
                lastRun.value = data.stats as RunStats
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
            // Skip malformed JSON
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
      // Save even on abort or error — a partial run is still worth keeping.
      await persist(opts.agentSlug, opts.projectDir)
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
    invocations.value = []
    tokenUsage.value = { ...EMPTY_USAGE }
    costUsd.value = 0
    lastRun.value = null
    effectiveConfig.value = null
    permissions.clear()
  }

  /** Reopen a saved conversation read-only in the studio panel. */
  function loadSession(session: ConversationSession) {
    messages.value = [...session.messages]
    toolCalls.value = [...(session.toolCalls ?? [])]
    invocations.value = []
    tokenUsage.value = session.tokenUsage ?? { ...EMPTY_USAGE }
    costUsd.value = session.costUsd ?? 0
    conversationId.value = session.id
    // Resuming the SDK session would replay tool state we no longer have.
    sessionId.value = null
    error.value = null
    currentAgentSlug = session.agentSlug
  }

  return {
    messages: readonly(messages),
    isStreaming: readonly(isStreaming),
    error: readonly(error),
    activity: readonly(activity),
    toolCalls: readonly(toolCalls),
    invocations: readonly(invocations),
    tokenUsage: readonly(tokenUsage),
    costUsd: readonly(costUsd),
    lastRun: readonly(lastRun),
    effectiveConfig: readonly(effectiveConfig),
    conversationId: readonly(conversationId),
    runConfig,
    pendingPermissions: readonly(permissions.pending),
    isAnsweringPermission: permissions.isAnswering,
    answerPermission: permissions.answer,
    sendMessage,
    stopStreaming,
    clearChat,
    loadSession,
    saveNow: () => persist(currentAgentSlug),
  }
}
