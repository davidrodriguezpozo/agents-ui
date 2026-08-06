export interface Attention {
  blocked: number
  working: number
  failingRituals: number
  needsYou: number
}

const EMPTY: Attention = { blocked: 0, working: 0, failingRituals: 0, needsYou: 0 }

/**
 * What is waiting on you, kept fresh app-wide.
 *
 * Polled rather than streamed: it is one small number every few seconds, and a
 * socket that has to survive sleep, a laptop lid and a server restart is a lot
 * of machinery for a count.
 */
export function useAttention() {
  const attention = useState<Attention>('attention', () => ({ ...EMPTY }))
  const poll = useState<ReturnType<typeof setInterval> | null>('attention-poll', () => null)

  async function refresh() {
    try {
      attention.value = await $fetch<Attention>('/api/attention')
    } catch {
      // A missed poll is not worth saying anything about; the next one is due
      // in a few seconds.
    }
  }

  function watchContinuously(everyMs = 8000) {
    if (poll.value) return
    void refresh()
    poll.value = setInterval(refresh, everyMs)
  }

  function stopWatching() {
    if (!poll.value) return
    clearInterval(poll.value)
    poll.value = null
  }

  /**
   * The tab title is the one piece of this app visible from another window,
   * so it carries the count when there is one.
   */
  const title = computed(() =>
    attention.value.needsYou > 0 ? `(${attention.value.needsYou}) Agents Studio` : 'Agents Studio'
  )

  return { attention, title, refresh, watchContinuously, stopWatching }
}
