import type { WallSnapshot } from '~/utils/wall'

/**
 * The wall's own poll.
 *
 * Deliberately not `useState`: there is one wall per screen and nothing else
 * reads it, so sharing it app-wide would only mean the poll outliving the page
 * that wanted it — the exact background cost with no reader that `useNightShift`
 * takes care to avoid.
 *
 * Two clocks, for the same reason that one has: the snapshot arrives every few
 * seconds, and `now` advances every second so a turn's elapsed time counts up
 * between polls instead of stepping.
 *
 * The third thing it tracks is whether the server is still answering. A wall is
 * unattended, and the failure mode of an unattended screen is that it goes on
 * showing a picture of nine minutes ago and nobody can tell. So a poll that
 * throws is remembered rather than swallowed, and the page says so.
 */
export function useWall(intervalMs = 2500) {
  const snapshot = ref<WallSnapshot | null>(null)
  const now = ref(Date.now())
  const lastOkAt = ref(0)
  const error = ref<string | null>(null)

  async function refresh() {
    try {
      snapshot.value = await $fetch<WallSnapshot>('/api/wall')
      lastOkAt.value = Date.now()
      error.value = null
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'The server did not answer'
    }
  }

  /**
   * Stale after three missed polls rather than one: a single slow answer on a
   * machine building six worktrees is normal, and a wall that cries wolf about
   * it is a wall people stop believing.
   */
  const connected = computed(() =>
    Boolean(lastOkAt.value) && now.value - lastOkAt.value < intervalMs * 3,
  )

  function watchWall() {
    let poll: ReturnType<typeof setInterval> | null = null
    let tick: ReturnType<typeof setInterval> | null = null

    onMounted(() => {
      void refresh()
      poll = setInterval(() => void refresh(), intervalMs)
      tick = setInterval(() => { now.value = Date.now() }, 1000)
    })

    onUnmounted(() => {
      if (poll) clearInterval(poll)
      if (tick) clearInterval(tick)
    })
  }

  return { snapshot, now, error, connected, refresh, watchWall }
}
