import type { RunSummary } from '~/composables/useRuns'

export interface TimelineWindow {
  from: number
  to: number
  hours: number
  runs: RunSummary[]
  truncated: boolean
}

/**
 * The window the night shift draws.
 *
 * Polled rather than streamed, and slowly: the chart is a picture of a day, and
 * a day does not change meaningfully in thirty seconds. The one thing that does
 * move between polls is `now`, so that is tracked separately and faster — it is
 * what makes a running block's right edge creep and the "now" line advance
 * without refetching anything.
 */
export function useNightShift() {
  const data = useState<TimelineWindow | null>('night-shift', () => null)
  const loading = useState('night-shift-loading', () => false)
  const error = useState<string | null>('night-shift-error', () => null)
  const hours = useState('night-shift-hours', () => 24)

  /** Advanced on a timer so an in-flight run's block grows without a refetch. */
  const now = ref(Date.now())

  async function fetchWindow(nextHours = hours.value) {
    hours.value = nextHours
    // Not cleared on refetch: the previous render is held at reduced opacity
    // instead, because a skeleton flash on a chart that redraws every half
    // minute is a page that never sits still.
    loading.value = true
    error.value = null

    try {
      data.value = await $fetch<TimelineWindow>('/api/timeline', { query: { hours: nextHours } })
      now.value = Date.now()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Could not load the timeline'
    } finally {
      loading.value = false
    }
  }

  /**
   * Poll while mounted. Both timers are cleared on unmount — a chart left
   * refetching after you navigated away is a background cost with no reader.
   */
  function watchWindow(intervalMs = 30_000) {
    let poll: ReturnType<typeof setInterval> | null = null
    let tick: ReturnType<typeof setInterval> | null = null

    onMounted(() => {
      fetchWindow()
      poll = setInterval(() => fetchWindow(), intervalMs)
      tick = setInterval(() => { now.value = Date.now() }, 1000)
    })

    onUnmounted(() => {
      if (poll) clearInterval(poll)
      if (tick) clearInterval(tick)
    })
  }

  return { data, loading, error, hours, now, fetchWindow, watchWindow }
}
