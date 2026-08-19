<script setup lang="ts">
import '@xterm/xterm/css/xterm.css'

/**
 * A shell, wherever the caller points it.
 *
 * The emulator is xterm.js because a terminal is not a text box: cursor
 * movement, colour, alternate screens and line editing are all escape
 * sequences, and anything less than a real emulator turns `top` or `git log`
 * into a mess. Pure JavaScript, bundled into `.output` like `marked` and
 * `@nuxt/ui` already are — runtime dependencies stay at zero and nothing
 * compiles at install.
 *
 * Output arrives over SSE and input goes back over POST. Two channels rather
 * than a socket because that is what the rest of this app already does for
 * runs, and a terminal is not latency-critical enough to justify a second
 * transport.
 *
 * The endpoints are props rather than a session id because there are two
 * callers now: a session's worktree, and the project selected in the Work
 * view. The shells are identical; only the id and the directory differ, and
 * both of those are the server's business.
 */

const props = withDefaults(defineProps<{
  /** Where keystrokes, sizes and close go. */
  postUrl: string
  /** The SSE endpoint to attach to. Query string included, if it needs one. */
  streamUrl: string
  /** The header with the status and the close button. Off when a parent draws its own. */
  chrome?: boolean
  /** Any CSS length. The fit addon measures the host box, so it has to have one. */
  height?: string
}>(), {
  chrome: true,
  height: 'clamp(16rem, 45vh, 34rem)',
})

const emit = defineEmits<{ status: [Status] }>()

type Status = 'connecting' | 'live' | 'ended'

const host = ref<HTMLDivElement | null>(null)
const status = ref<Status>('connecting')

const finding = ref(false)
const query = ref('')
const findInput = ref<HTMLInputElement | null>(null)

let term: import('@xterm/xterm').Terminal | null = null
let fit: import('@xterm/addon-fit').FitAddon | null = null
let search: import('@xterm/addon-search').SearchAddon | null = null
let source: EventSource | null = null
let observer: ResizeObserver | null = null

watch(status, value => emit('status', value))

/**
 * Keystrokes are coalesced rather than sent one at a time.
 *
 * A POST per keypress is one HTTP round trip per character, which is fine when
 * you are typing and silly when a key repeat or a paste arrives — and it puts
 * the ordering of the shell's input at the mercy of however the browser
 * schedules a dozen concurrent requests.
 *
 * So there is one request in flight at a time and a buffer behind it. Whatever
 * is typed while a request is out goes in the next one, joined, in order. Fast
 * typing gets *fewer* requests rather than more, which is the opposite of how
 * it behaved before, and the byte stream the pty sees is unchanged.
 */
let pending: string[] = []
let flushing = false

async function flush() {
  if (flushing || !pending.length) return

  flushing = true
  const batch = pending
  pending = []

  try {
    await $fetch(props.postUrl, { method: 'POST', body: { input: batch } })
  } catch {
    // A keystroke that did not arrive is not worth an error dialog; the shell
    // being gone shows up on the stream, which is the honest signal.
  } finally {
    flushing = false
  }

  if (pending.length) flush()
}

function queueInput(data: string) {
  pending.push(data)
  // A short timer rather than a microtask: a microtask fires before the next
  // keystroke event can possibly arrive, so it would coalesce nothing.
  if (!flushing) setTimeout(flush, 4)
}

/** Sizes and close go straight out — there is never a burst of them. */
async function send(body: Record<string, unknown>) {
  try {
    await $fetch(props.postUrl, { method: 'POST', body })
  } catch {
    // As above.
  }
}

function pushSize() {
  if (!term) return
  send({ cols: term.cols, rows: term.rows })
}

/**
 * The stack that decides whether a prompt is symbols or tofu boxes.
 *
 * Read off the document rather than handed to xterm as `var(--font-terminal)`,
 * which is what this used to do and which never worked: xterm measures a
 * character cell by setting `ctx.font` on a canvas, and `var()` does not
 * resolve there. The declared font was inert and every terminal in this app
 * silently fell back to `ui-monospace`.
 */
function terminalFont(): string {
  const declared = getComputedStyle(document.documentElement)
    .getPropertyValue('--font-terminal')
    .trim()

  return declared || 'ui-monospace, monospace'
}

/**
 * Catppuccin Mocha, all sixteen.
 *
 * The background and foreground alone were set before, so everything a program
 * actually colours — `git status`, `ls`, a diff, a test runner — came out in
 * xterm's stock ANSI palette against a Catppuccin background. Two themes at
 * once, and the half nobody chose was the half doing the talking.
 */
const THEME = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selectionBackground: 'rgba(137, 180, 250, 0.3)',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8',
}

onMounted(async () => {
  /**
   * Waited for, because a terminal measured against the wrong font stays
   * wrong.
   *
   * xterm works out the cell size once, at `open()`. If the bundled symbol
   * font is still in flight at that moment, every column is measured against
   * the fallback and the grid is off by a fraction that compounds across
   * eighty columns. On a machine with MesloLGS NF installed this resolves
   * immediately and costs nothing; the race is only ever bounded, never
   * waited on indefinitely, because `font-display: block` means a slow network
   * would otherwise hold the pane hostage.
   */
  await Promise.race([
    document.fonts?.ready ?? Promise.resolve(),
    new Promise(resolve => setTimeout(resolve, 1500)),
  ])

  // Imported here rather than at the top: xterm touches `window` on load, and
  // this page is server-rendered.
  const [{ Terminal }, { FitAddon }, { Unicode11Addon }, { WebLinksAddon }, { SearchAddon }] =
    await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-unicode11'),
      import('@xterm/addon-web-links'),
      import('@xterm/addon-search'),
    ])

  // Unmounted while the imports were in flight, which a tab switch can do.
  if (!host.value) return

  term = new Terminal({
    fontFamily: terminalFont(),
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    // The unicode provider below is proposed API in xterm's own terms.
    allowProposedApi: true,
    // Enough to scroll back through a build without holding a session's worth
    // of output per shell.
    scrollback: 10_000,
    // Option as Meta, which is what iTerm2 is configured to do for anyone whose
    // shell binds Alt-b and Alt-f to word movement.
    macOptionIsMeta: true,
    theme: THEME,
  })

  fit = new FitAddon()
  term.loadAddon(fit)

  /**
   * Nerd Font glyphs are why this is here.
   *
   * A Powerline separator or a Devicon is a Private Use Area codepoint, and
   * how many cells one occupies is a judgement the emulator has to make. On
   * xterm's default (version 6) table the answer is wrong often enough that a
   * p10k prompt draws its segments half a column out and every redraw smears.
   */
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'

  term.loadAddon(new WebLinksAddon())

  search = new SearchAddon()
  term.loadAddon(search)

  term.open(host.value)

  /**
   * The GPU renderer, loaded last and defensively.
   *
   * A build log or a `yes` is where the DOM renderer stops keeping up. But a
   * WebGL context can be taken away — a laptop switching graphics, a driver
   * reset, too many contexts on one page — and an addon that has lost its
   * context draws nothing at all. Disposing it drops xterm back to the DOM
   * renderer, which is slower and always works.
   */
  try {
    const { WebglAddon } = await import('@xterm/addon-webgl')
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
  } catch {
    // No WebGL on this machine, or the addon refused to activate. The DOM
    // renderer is already doing the job.
  }

  fit.fit()

  term.onData(queueInput)
  term.attachCustomKeyEventHandler(onKey)

  // The pane changing size has to reach the pty, or a full-screen program
  // draws to the wrong width and the display tears.
  observer = new ResizeObserver(() => {
    try {
      fit?.fit()
      pushSize()
    } catch {
      // Fires while the pane is hidden and has no size worth reporting.
    }
  })
  observer.observe(host.value)

  source = new EventSource(props.streamUrl)
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data) as { type: string; data?: string; code?: number }

    if (payload.type === 'data' && payload.data) {
      status.value = 'live'
      term!.write(payload.data)
    } else if (payload.type === 'exit') {
      status.value = 'ended'
      term!.write(`\r\n\x1b[2m[shell exited${payload.code ? ` with ${payload.code}` : ''}]\x1b[0m\r\n`)

      /**
       * Closed here, or the browser reconnects.
       *
       * EventSource retries automatically when the server ends the stream
       * without an error status, and the stream endpoint starts a shell if it
       * finds none. So a shell the user deliberately closed came straight back
       * a few seconds later — holding a process and a pty that nothing on
       * screen said was running.
       */
      source?.close()
      source = null
    }
  }
  source.onopen = () => { if (status.value === 'connecting') status.value = 'live' }

  // The size the server started with is a guess; this is the real one.
  pushSize()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  source?.close()
  term?.dispose()
  // The shell is deliberately left running: a build should survive navigating
  // away, and the server closes one nobody has watched for half an hour.
})

/**
 * Which chords belong to the shell and which to the app.
 *
 * This app binds ⌘K to global search and Escape to closing the chat drawer, both
 * on `document`. Neither is survivable in a terminal: ⌘K is how you clear the
 * screen in iTerm2, and Escape is how you leave insert mode in vim — a shell
 * where Escape opens and closes a chat panel is not one you can edit a file in.
 *
 * So the rule is that a focused terminal wins, and anything it wins is stopped
 * from reaching the document listeners rather than merely handled here.
 */
function onKey(event: KeyboardEvent): boolean {
  if (event.type !== 'keydown') return true

  const command = event.metaKey && !event.ctrlKey && !event.altKey

  if (command && event.key === 'k') {
    event.preventDefault()
    event.stopPropagation()
    clear()
    return false
  }

  if (command && event.key === 'f') {
    event.preventDefault()
    event.stopPropagation()
    openFind()
    return false
  }

  if (event.key === 'Escape') {
    if (finding.value) {
      closeFind()
      return false
    }
    // vim's, not the chat drawer's.
    event.stopPropagation()
    return true
  }

  // Every Ctrl chord is the shell's — Ctrl-C, Ctrl-K to kill a line, Ctrl-R to
  // search history. xterm sends them; the page must not also react.
  if (event.ctrlKey && !event.metaKey) {
    event.stopPropagation()
    return true
  }

  return true
}

function openFind() {
  finding.value = true
  nextTick(() => findInput.value?.focus())
}

function closeFind() {
  finding.value = false
  search?.clearDecorations()
  term?.focus()
}

function findNext() {
  if (query.value) search?.findNext(query.value)
}

function findPrevious() {
  if (query.value) search?.findPrevious(query.value)
}

/**
 * Clicking the pane focuses the shell.
 *
 * xterm only claims clicks that land on its own screen element, and this box
 * has padding around it — a click in the margin left focus on the document,
 * where the keystrokes went to the page instead and appeared to do nothing.
 */
function focusShell() {
  term?.focus()
}

/** The screen, not the shell: scrollback goes, whatever is running stays. */
function clear() {
  term?.clear()
}

/** Only ever on purpose — this kills whatever is running in it. */
async function closeShell() {
  await send({ close: true })
  status.value = 'ended'
}

defineExpose({ focus: focusShell, clear, closeShell, openFind, status })
</script>

<template>
  <div
    class="terminal-frame"
    :class="chrome ? 'rounded-md overflow-hidden' : 'h-full flex flex-col'"
    :style="chrome ? 'border: 1px solid var(--border-subtle);' : undefined"
  >
    <div
      v-if="chrome"
      class="px-3 py-2 flex items-center gap-2"
      style="background: var(--surface-raised);"
    >
      <span class="text-section-label flex-1">Terminal</span>
      <span class="type-meta">
        {{ status === 'live' ? 'running in this workspace' : status === 'ended' ? 'closed' : 'starting…' }}
      </span>
      <UButton
        label="Close shell"
        size="xs"
        variant="ghost"
        color="neutral"
        :disabled="status === 'ended'"
        @click="closeShell"
      />
    </div>

    <div class="relative" :class="chrome ? '' : 'flex-1 min-h-0'">
      <div
        ref="host"
        class="terminal-host"
        :style="{ height: chrome ? height : '100%' }"
        @click="focusShell"
      />

      <!-- ⌘F, over the top right of the buffer so it hides as little as possible. -->
      <div v-if="finding" class="find-bar">
        <input
          ref="findInput"
          v-model="query"
          class="find-input"
          placeholder="Find"
          spellcheck="false"
          @keydown.enter.prevent="findNext"
          @keydown.shift.enter.prevent="findPrevious"
          @keydown.esc.prevent.stop="closeFind"
          @input="findNext"
        >
        <button class="find-button" title="Previous" @click="findPrevious">
          <UIcon name="i-lucide-chevron-up" class="size-3.5" />
        </button>
        <button class="find-button" title="Next" @click="findNext">
          <UIcon name="i-lucide-chevron-down" class="size-3.5" />
        </button>
        <button class="find-button" title="Close" @click="closeFind">
          <UIcon name="i-lucide-x" class="size-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Height here rather than on the xterm element: the addon measures this box to
   work out rows and columns, so it has to be the thing with a size. */
.terminal-host {
  background: #1e1e2e;
}

/* The padding belongs on the xterm element, not on the box above.
 *
 * The addon reads this box's `height` for the space available and subtracts
 * only the padding it finds on `.xterm`. Everything here is `border-box`, so
 * padding out here is counted as usable and then is not — it asked for 35 rows
 * where 33 fit, and the last line sat half under the bottom edge for anyone
 * whose shell had scrolled. Padding on `.xterm` is subtracted, so the rows it
 * asks for are the rows there is room to draw. */
.terminal-host :deep(.xterm) {
  padding: 8px;
}

.find-bar {
  position: absolute;
  top: 8px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 4px;
  border-radius: 6px;
  background: #313244;
  border: 1px solid #45475a;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.35);
}

.find-input {
  width: 11rem;
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: #cdd6f4;
  background: transparent;
  border: none;
  outline: none;
}

.find-input::placeholder {
  color: #6c7086;
}

.find-button {
  display: grid;
  place-items: center;
  padding: 3px;
  border-radius: 4px;
  color: #a6adc8;
}

.find-button:hover {
  color: #cdd6f4;
  background: #45475a;
}
</style>
