/**
 * The microphone, held down.
 *
 * Push-to-talk, and that is the security model rather than a convenience: there
 * is no wake word and nothing is listening between key presses, so a room full of
 * conversation, a video call or a podcast cannot command this. `parseCommand` in
 * `utils/voice.ts` decides what the words are allowed to mean; this file decides
 * only when there are any.
 *
 * **It is not local, and that is the one thing about it worth saying twice.**
 * Chrome's `SpeechRecognition` streams the captured audio to Google for
 * transcription. Everything else this app does happens on your own machine, so
 * this is a real exception — it is disclosed in the UI before the microphone is
 * ever switched on, and it is the reason the whole feature is off until somebody
 * turns it on. A local recogniser would remove the caveat, and would not change
 * anything above.
 *
 * Speaking back is the reverse: `speechSynthesis` renders on the device, sends
 * nothing anywhere, and is what makes the loop usable from across a room where
 * reading the screen is the thing somebody is trying to avoid.
 */

const ENABLED_KEY = 'agents-ui:wall-voice'

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
}

function recognitionClass(): (new () => Recognition) | null {
  if (!import.meta.client) return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type VoiceState = 'off' | 'idle' | 'listening' | 'denied' | 'unsupported'

export function useVoice() {
  /** Whether the microphone may be used at all. Off until somebody says so. */
  const enabled = ref(false)
  const state = ref<VoiceState>('off')
  const transcript = ref('')
  const error = ref<string | null>(null)

  let recognition: Recognition | null = null
  /** Set while a key is held, so a recogniser ending by itself can be ignored. */
  let holding = false

  const supported = computed(() => Boolean(recognitionClass()))

  function setEnabled(on: boolean) {
    enabled.value = on
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0')

    if (!on) {
      stop()
      state.value = 'off'
      transcript.value = ''
      return
    }

    state.value = supported.value ? 'idle' : 'unsupported'
    if (!supported.value) {
      error.value = 'This browser has no speech recognition. Chrome does.'
    }
  }

  /**
   * Start listening. Returns nothing: what was heard arrives through
   * `transcript`, and the caller acts on it when the key comes up — never on an
   * interim result, because a command half-said is a different command.
   */
  function start() {
    if (!enabled.value || !supported.value || state.value === 'listening') return

    const Recogniser = recognitionClass()!
    recognition = new Recogniser()
    recognition.lang = navigator.language || 'en-GB'
    // One utterance per press. `continuous` would keep the microphone open past
    // the key coming up, which is the thing this design exists to avoid.
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    transcript.value = ''
    error.value = null
    holding = true

    recognition.onresult = (event: any) => {
      let heard = ''
      for (let i = 0; i < event.results.length; i++) heard += event.results[i][0].transcript
      transcript.value = heard.trim()
    }

    recognition.onerror = (event: any) => {
      const kind = String(event?.error ?? '')
      if (kind === 'not-allowed' || kind === 'service-not-allowed') {
        state.value = 'denied'
        error.value = 'The browser refused the microphone. Allow it for this page and try again.'
        return
      }

      // `no-speech` and `aborted` are what a key tapped by accident produces.
      // Reporting those would make the wall look broken by somebody's elbow.
      if (kind !== 'no-speech' && kind !== 'aborted') error.value = `Speech recognition failed: ${kind || 'unknown'}`
      state.value = enabled.value ? 'idle' : 'off'
    }

    recognition.onend = () => {
      if (state.value === 'listening') state.value = enabled.value ? 'idle' : 'off'
      recognition = null
    }

    try {
      recognition.start()
      state.value = 'listening'
    } catch {
      // Already started, which a repeated keydown produces. Harmless.
    }
  }

  /** Stop listening and hand back the final transcript for the caller to parse. */
  function stop(): string {
    holding = false
    const heard = transcript.value.trim()

    try {
      recognition?.stop()
    } catch {
      // Stopping something already stopped is not worth a word on a wall.
    }

    if (state.value === 'listening') state.value = enabled.value ? 'idle' : 'off'
    return heard
  }

  /** Said out loud, on the device. Silent when speech synthesis is unavailable. */
  function speak(text: string) {
    if (!import.meta.client || !('speechSynthesis' in window) || !text) return

    try {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.05
      // Cancel first: two answers overlapping is worse than a late one.
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
    } catch {
      // A device with no voices installed. Nothing to report.
    }
  }

  onMounted(() => {
    if (localStorage.getItem(ENABLED_KEY) === '1') setEnabled(true)
  })

  onUnmounted(() => {
    if (holding || state.value === 'listening') {
      try {
        recognition?.abort()
      } catch {
        // Leaving the page mid-utterance. There is nobody left to tell.
      }
    }
  })

  return { enabled, state, transcript, error, supported, setEnabled, start, stop, speak }
}
