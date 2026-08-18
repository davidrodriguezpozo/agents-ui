import { frequencyFor, notesFor, type Note, type SoundEvent, type SoundKind } from '~/utils/sound'

/**
 * The noise itself.
 *
 * Synthesised rather than played from files: six short sounds, each a few
 * oscillators and an envelope, is no assets at all — and this app ships none,
 * resolves nothing at install time, and is not going to start over a bell. It also
 * means the pitch can be a repository's pitch, which is the whole idea, and samples
 * would have needed one file per note.
 *
 * This is only the renderer. *When* a sound plays and *what notes it is made of*
 * are both `utils/sound.ts`, where they can be tested without a browser, a speaker
 * or a gesture — which is exactly what a backgrounded tab denies you.
 *
 * Two constraints from the platform, both load-bearing:
 *
 * **Audio needs a gesture.** A browser will not let a page make noise until
 * somebody has interacted with it, so the toggle is not only a preference — it is
 * the gesture that creates the context. Which is the right shape anyway: a screen
 * that started making noises on its own would be indefensible.
 *
 * **A hidden tab is silent.** A wall lives in a window that is often behind
 * something else, and sound from a page nobody can see is a mystery noise in a
 * room. So the master gain drops to zero while the document is hidden, and the
 * events still pass through — nothing queues up to be replayed at you when the
 * window comes forward.
 */

const ENABLED_KEY = 'agents-ui:wall-sound'

/** Quiet on purpose: this plays for hours in a room where people are talking. */
const MASTER_GAIN = 0.22

/**
 * The floor between two sounds.
 *
 * Ticks are capped per poll upstream, but a poll bringing a merge, a pass and
 * three ticks would still fire five envelopes in the same millisecond and read as
 * one dissonant thud. Spacing them is what makes a busy moment sound busy rather
 * than broken.
 */
const SPACING_MS = 90

export function useSound() {
  const enabled = ref(false)
  const supported = ref(true)

  let context: AudioContext | null = null
  let master: GainNode | null = null
  /** When the last sound was scheduled, so the next one queues after it. */
  let lastAt = 0

  function ensureContext(): AudioContext | null {
    if (context) return context

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      supported.value = false
      return null
    }

    context = new Ctor()
    master = context.createGain()
    master.gain.value = MASTER_GAIN
    master.connect(context.destination)
    return context
  }

  /**
   * One note, with an envelope.
   *
   * The envelope is the difference between a musical instrument and a beep: a
   * gain that jumps to a value and stops produces a click at each end, which is
   * exactly what makes cheap web audio unpleasant to sit next to all afternoon.
   */
  function note(at: number, options: Omit<Note, 'delay'>) {
    if (!context || !master) return

    const osc = context.createOscillator()
    const env = context.createGain()

    osc.type = options.type
    osc.frequency.setValueAtTime(options.hz, at)
    if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, at + options.length)

    const peak = options.gain
    env.gain.setValueAtTime(0.0001, at)
    env.gain.exponentialRampToValueAtTime(peak, at + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, at + options.length)

    osc.connect(env)
    env.connect(master)
    osc.start(at)
    osc.stop(at + options.length + 0.02)
  }

  /** Render one sound: its notes, from `notesFor`, scheduled from `at`. */
  function play(kind: SoundKind, repo: string | undefined, at: number) {
    for (const spec of notesFor(kind, frequencyFor(repo))) {
      note(at + spec.delay, spec)
    }
  }

  /** Play a poll's worth of events, spaced so a busy moment stays legible. */
  function emit(events: SoundEvent[]) {
    if (!enabled.value || !events.length) return

    const ctx = ensureContext()
    if (!ctx || !master) return

    // Suspended is what a context becomes when the tab is backgrounded, and what
    // it starts as if the gesture that created it was not quite enough.
    if (ctx.state === 'suspended') void ctx.resume()

    // Silent rather than queued while nobody can see the screen: a mystery noise
    // from a hidden window is worse than a missed one, and a backlog played on
    // focus would be a burst of history.
    master.gain.value = document.hidden ? 0 : MASTER_GAIN

    let at = Math.max(ctx.currentTime, lastAt + SPACING_MS / 1000)
    for (const event of events) {
      play(event.kind, event.repo, at)
      at += SPACING_MS / 1000
    }
    lastAt = at
  }

  function setEnabled(on: boolean) {
    enabled.value = on
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0')

    if (!on) {
      // Left in place rather than closed: closing and recreating a context on
      // every toggle is how you end up needing a fresh gesture to turn it back on.
      if (master) master.gain.value = 0
      return
    }

    const ctx = ensureContext()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume()
    if (master) master.gain.value = MASTER_GAIN

    // One note on turning it on, so it is obvious the speakers are the right
    // ones and the volume is sane before anything is riding on it.
    play('start', undefined, ctx.currentTime + 0.02)
  }

  function toggle() {
    setEnabled(!enabled.value)
  }

  onMounted(() => {
    // Remembered, but not resumed: the context needs a gesture, so a reloaded
    // wall comes back with sound *armed* and makes its first noise once anything
    // is pressed. Nothing is lost meanwhile except the ticks.
    if (localStorage.getItem(ENABLED_KEY) === '1') enabled.value = true
  })

  onUnmounted(() => {
    void context?.close()
    context = null
    master = null
  })

  return { enabled, supported, emit, toggle, setEnabled }
}
