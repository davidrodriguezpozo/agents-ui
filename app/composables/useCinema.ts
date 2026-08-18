import type { LocationQuery } from 'vue-router'
import {
  actById,
  actsFor,
  isDue,
  nextAct,
  prevAct,
  progressOf,
  type Act,
  type ActId,
  type CinemaInput,
} from '~/utils/cinema'

const STORAGE_KEY = 'agents-ui:wall-cinema'

/** Long enough for the first poll of everything the interrupts watch. */
const SETTLING_MS = 5000

/**
 * The clock behind cinema mode.
 *
 * Driven by the wall's existing one-second tick rather than a timer of its own,
 * so there is a single source of "now" on the page and an act cannot advance
 * against a clock the progress bar disagrees with.
 *
 * It remembers whether it was on. A display machine that reboots at 04:00 should
 * come back to the same screen it was showing, and somebody who turned the
 * rotation off to read one act should not find it back on tomorrow because the
 * page reloaded. The URL wins over the memory, so a `?cinema=1` bookmark is a
 * reliable way to launch a screen into it.
 */
export function useCinema(input: Ref<CinemaInput>, now: Ref<number>) {
  const route = useRoute()
  const router = useRouter()

  const enabled = ref(false)
  const actId = ref<ActId>('fleet')
  const startedAt = ref(now.value)

  /**
   * When this wall was opened.
   *
   * The interrupts below are about *news*, and the first few seconds of a freshly
   * opened page are not news: every count starts at zero and then jumps to
   * whatever was already true, which looks identical to something breaking. A
   * display that restarts at 04:00 would otherwise come back cut to the attention
   * act about a ritual that broke on Tuesday.
   */
  const openedAt = Date.now()
  const settling = () => Date.now() - openedAt < SETTLING_MS

  /**
   * When the rotation was paused, which is what freezes the bar.
   *
   * Held as a moment rather than a boolean so the progress the bar draws and the
   * decision to advance read the same elapsed time. Resuming credits the pause
   * back, so pressing space to read an act does not cost you the rest of it.
   */
  const pausedAt = ref<number | null>(null)
  const paused = computed(() => pausedAt.value !== null)

  const acts = computed<Act[]>(() => actsFor(input.value))
  const act = computed(() => actById(actId.value))
  const index = computed(() => acts.value.findIndex(a => a.id === actId.value))

  const progress = computed(() =>
    progressOf(startedAt.value, pausedAt.value ?? now.value, act.value.dwellMs),
  )

  function show(id: ActId) {
    actId.value = id
    startedAt.value = Date.now()
    if (pausedAt.value !== null) pausedAt.value = startedAt.value
  }

  function togglePause() {
    if (pausedAt.value === null) {
      pausedAt.value = Date.now()
      return
    }

    startedAt.value += Date.now() - pausedAt.value
    pausedAt.value = null
  }

  function next() {
    show(nextAct(actId.value, acts.value).id)
  }

  function previous() {
    show(prevAct(actId.value, acts.value).id)
  }

  function setEnabled(on: boolean) {
    enabled.value = on
    pausedAt.value = null
    startedAt.value = Date.now()
    if (on) show(acts.value[0]?.id ?? 'fleet')
    else actId.value = 'fleet'

    if (import.meta.client) localStorage.setItem(STORAGE_KEY, on ? '1' : '0')

    // Kept in the URL so the address of a screen showing the rotation is the
    // address you can send to the machine that should be showing it.
    void router.replace({ query: on ? { ...route.query, cinema: '1' } : omitCinema(route.query) })
  }

  function toggle() {
    setEnabled(!enabled.value)
  }

  onMounted(() => {
    const asked = route.query.cinema
    if (asked === '1' || asked === 'true') enabled.value = true
    else if (asked === '0') enabled.value = false
    else enabled.value = localStorage.getItem(STORAGE_KEY) === '1'

    show(acts.value[0]?.id ?? 'fleet')
  })

  /** Advance when the act has had its time. One decision per tick of `now`. */
  watch(now, () => {
    if (!enabled.value || pausedAt.value !== null) return
    if (isDue(startedAt.value, now.value, act.value.dwellMs)) next()
  })

  /**
   * An act that leaves the rotation cannot stay on screen — most often because
   * the thing that was waiting on you has been answered, and `needs-you` has
   * gone. Cutting immediately is right: what is on screen has stopped being
   * true, and waiting out its dwell would show a stale claim for ten seconds.
   */
  watch(acts, (available) => {
    if (!enabled.value) return
    if (!available.some(a => a.id === actId.value)) show(available[0]?.id ?? 'fleet')
  })

  /**
   * News interrupts. A session that has just failed, or one that has just
   * stopped to ask, is worth cutting to the fleet for — the alternative is a
   * screen calmly reporting yesterday's spending while something breaks behind
   * it. Only on an *increase*: a wall with three broken sessions must not sit on
   * the fleet act forever, or the rotation is over for the rest of the week.
   */
  watch(() => input.value.needsYou, (count, before) => {
    if (settling()) return
    if (enabled.value && count > (before ?? 0)) show('needs-you')
  })

  function interruptFor(kind: 'broken') {
    if (!enabled.value || settling()) return
    if (kind === 'broken') show('fleet')
  }

  return {
    enabled, paused, act, acts, index, progress, settling,
    show, next, previous, toggle, togglePause, setEnabled, interruptFor,
  }
}

function omitCinema(query: LocationQuery): LocationQuery {
  const { cinema, ...rest } = query
  return rest
}
