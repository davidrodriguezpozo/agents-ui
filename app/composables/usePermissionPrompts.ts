import type { PermissionAnswer, PermissionRequest } from '~/types'

/**
 * A queue of tool calls the agent is blocked on. Both the chat panel and the
 * run view feed the same queue — the server routes answers by request id, so
 * neither needs to know where the prompt came from.
 *
 * State is shared per `scope` because `useChat()` is instantiated separately in
 * every component that touches it; a plain `ref` would give the panel rendering
 * the prompts a different queue from the stream producing them.
 */
export function usePermissionPrompts(scope: string) {
  const pending = useState<PermissionRequest[]>(`permissions-${scope}`, () => [])
  const answering = useState<string[]>(`permissions-answering-${scope}`, () => [])

  function add(request: PermissionRequest) {
    if (pending.value.some(p => p.id === request.id)) return
    pending.value = [...pending.value, request]
  }

  function resolve(id: string) {
    pending.value = pending.value.filter(p => p.id !== id)
    answering.value = answering.value.filter(a => a !== id)
  }

  function clear() {
    pending.value = []
    answering.value = []
  }

  function isAnswering(id: string) {
    return answering.value.includes(id)
  }

  /**
   * The server also emits `permission_resolved`, but the prompt is dropped here
   * too so the buttons don't sit spinning while that round-trips.
   */
  async function answer(id: string, decision: PermissionAnswer) {
    if (isAnswering(id)) return
    answering.value = [...answering.value, id]

    try {
      await $fetch(`/api/permissions/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: decision,
      })
    } catch (e) {
      console.error('[usePermissionPrompts] failed to answer', id, e)
    } finally {
      resolve(id)
    }
  }

  return { pending, answering, add, resolve, clear, answer, isAnswering }
}
