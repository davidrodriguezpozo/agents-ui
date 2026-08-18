import { EMPTY_PULLS, type WallPullsReading } from '~/utils/wall'

/**
 * The wall's other poll — the one that leaves the machine.
 *
 * Separate from `useWall` because the two answer questions of completely
 * different cost and change at completely different rates, and merging them would
 * force one of the two wrong choices: pull requests polled every two seconds, or
 * the fleet polled every minute.
 *
 * The server holds a reading for a minute (see `wallPulls.ts`), so this interval
 * is really "how soon after the cache expires does the screen notice". Asking on
 * the same period as the cache means a reading is at worst two minutes old before
 * it is replaced, which is why the panel stamps its age rather than implying it is
 * current.
 *
 * Not `useState`: like the wall's own poll, there is one of these per screen and
 * nothing else reads it. Sharing it app-wide would only let the poll outlive the
 * page that wanted it.
 */
export function useWallPulls(intervalMs = 60_000) {
  const reading = ref<WallPullsReading>({ ...EMPTY_PULLS })
  /** Whether it has ever answered, so the panel can tell empty from unasked. */
  const loaded = ref(false)
  const refreshing = ref(false)
  const error = ref<string | null>(null)

  /**
   * `force` bypasses the server's minute, for somebody standing in front of the
   * screen who has just merged something and does not want to wait it out.
   */
  async function refresh(force = false) {
    refreshing.value = true
    try {
      reading.value = await $fetch<WallPullsReading>('/api/wall/pulls', {
        query: force ? { force: '1' } : undefined,
      })
      loaded.value = true
      error.value = null
    } catch (e: unknown) {
      // The previous reading stays on screen with its own age stamp. Blanking it
      // because one request failed would turn "a minute old" into "nothing
      // waiting", which is the more expensive of the two to be wrong about.
      error.value = e instanceof Error ? e.message : 'GitHub could not be asked'
    } finally {
      refreshing.value = false
    }
  }

  function watchPulls() {
    let poll: ReturnType<typeof setInterval> | null = null

    onMounted(() => {
      void refresh()
      poll = setInterval(() => void refresh(), intervalMs)
    })

    onUnmounted(() => {
      if (poll) clearInterval(poll)
    })
  }

  return { reading, loaded, refreshing, error, refresh, watchPulls }
}
