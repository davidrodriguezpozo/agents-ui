import type { ConversationSummary, ConversationSession } from '~/types'

export function useAgentHistory(agentSlug: string) {
  const sessions = ref<ConversationSummary[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchHistory() {
    loading.value = true
    error.value = null
    try {
      sessions.value = await $fetch<ConversationSummary[]>(`/api/agents/${agentSlug}/history`)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to load history'
    } finally {
      loading.value = false
    }
  }

  async function fetchSession(id: string) {
    return await $fetch<ConversationSession>(`/api/agents/${agentSlug}/history/${id}`)
  }

  async function deleteSession(id: string) {
    await $fetch(`/api/agents/${agentSlug}/history/${id}`, { method: 'DELETE' })
    sessions.value = sessions.value.filter(s => s.id !== id)
  }

  return {
    sessions: readonly(sessions),
    loading: readonly(loading),
    error: readonly(error),
    fetchHistory,
    fetchSession,
    deleteSession,
  }
}
