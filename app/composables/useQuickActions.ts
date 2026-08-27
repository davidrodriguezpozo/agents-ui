/**
 * What a quick action does with you once it has started the session.
 *
 * Every button that turns a row into work — "Review it" on a pull request,
 * "Address it" on an issue, a row in the Needs you queue — used to end in a
 * navigation to the full-screen conversation. That is right for one press and
 * wrong for the press this app is actually used for: dispatching reviews. You
 * send five, you read none of the five transcripts, and each one took you off
 * the page holding the other four.
 *
 * So the arrival is a preference, remembered on the server next to the commands
 * those buttons run (`openStartedSessions` in `server/utils/preferences.ts`),
 * and off by default.
 *
 * `arrive` is the whole of it, and the reason this is a composable rather than a
 * flag each page reads: staying is not just "do not navigate" — it is a toast
 * that has to carry the way in, and a re-read of the sessions store so the row
 * you are still looking at can say a session has it. Written per page, that was
 * the same three-line decision in three places, one of them with `router.push`
 * where the others had `navigateTo`.
 */

/** The words for a press that kept you where you are. */
export interface Arrival {
  title: string
  description: string
  /**
   * Something the server did that nobody asked for — a workspace continued, a
   * turn that would not start. Said whichever way the press goes, because it is
   * the reason the session is not the one you were expecting; when it is there,
   * it is what the toast says instead of the plain confirmation.
   */
  note?: { title: string; description: string; color: 'info' | 'warning' } | null
}

/**
 * Module-level rather than `useState`, because it holds a promise: this is one
 * browser tab's in-flight request, not state worth carrying across a render.
 * Only ever reached from `onMounted`, so it never spans two server requests.
 */
let inFlight: Promise<void> | null = null

export function useQuickActions() {
  /**
   * False until the server says otherwise, which is also the default — so a
   * request that never comes back leaves the buttons doing the quiet thing
   * rather than navigating on a guess.
   */
  const openStarted = useState('quick-action-open', () => false)
  const loaded = useState('quick-action-loaded', () => false)
  const { fetchAll: fetchSessions } = useSessions()
  const toast = useToast()

  /**
   * Once per page. The request is held rather than the result, because two
   * components on the same screen both call this in the same tick and a flag
   * set after the reply would let both through.
   */
  async function load() {
    if (loaded.value) return
    inFlight ??= $fetch<{ openStartedSessions?: boolean }>('/api/preferences')
      .then(preferences => hydrate(preferences.openStartedSessions))
      .catch((e) => { console.error('[useQuickActions] load:', e) })
      .finally(() => { inFlight = null })

    await inFlight
  }

  /**
   * The one place the stored value is read as a switch, so the page that
   * fetches the whole of `/api/preferences` for its own reasons can hand this
   * one over rather than fetching it again a route later.
   */
  function hydrate(value: unknown) {
    openStarted.value = value === true
    loaded.value = true
  }

  /**
   * Where the press leaves you: in the conversation, or here, with a toast that
   * says what happened and links to it.
   */
  async function arrive(sessionId: string, arrival: Arrival) {
    const to = `/sessions/${sessionId}`

    if (openStarted.value) {
      if (arrival.note) toast.add({ ...arrival.note })
      await navigateTo(to)
      return
    }

    // Staying means the row has to grow its own "a session has it" chip: the
    // press is the only thing that changed the sessions store, and the polls
    // that would notice only run for sessions already known to be working.
    void fetchSessions()

    toast.add({
      title: arrival.note?.title ?? arrival.title,
      description: arrival.note?.description ?? arrival.description,
      color: arrival.note?.color ?? 'success',
      actions: [{ label: 'Open it', onClick: () => void navigateTo(to) }],
    })
  }

  return { openStarted, load, hydrate, arrive }
}
