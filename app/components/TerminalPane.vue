<script setup lang="ts">
import '@xterm/xterm/css/xterm.css'

/**
 * A shell, in the session's own workspace.
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
 */

const props = defineProps<{ sessionId: string }>()

const host = ref<HTMLDivElement | null>(null)
const status = ref<'connecting' | 'live' | 'ended'>('connecting')

let term: import('@xterm/xterm').Terminal | null = null
let fit: import('@xterm/addon-fit').FitAddon | null = null
let source: EventSource | null = null
let observer: ResizeObserver | null = null

const base = computed(() => `/api/sessions/${encodeURIComponent(props.sessionId)}/terminal`)

/** Straight through, byte for byte — the server does no interpreting either. */
async function send(body: Record<string, unknown>) {
  try {
    await $fetch(base.value, { method: 'POST', body })
  } catch {
    // A keystroke that did not arrive is not worth an error dialog; the shell
    // being gone shows up on the stream, which is the honest signal.
  }
}

function pushSize() {
  if (!term) return
  send({ cols: term.cols, rows: term.rows })
}

onMounted(async () => {
  // Imported here rather than at the top: xterm touches `window` on load, and
  // this page is server-rendered.
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
  ])

  term = new Terminal({
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    fontSize: 13,
    cursorBlink: true,
    // Matches the editor, which is Catppuccin Mocha and dark in both themes.
    theme: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#cdd6f4',
      selectionBackground: 'rgba(137, 180, 250, 0.3)',
    },
  })

  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host.value!)
  fit.fit()

  term.onData(data => send({ input: data }))

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
  observer.observe(host.value!)

  source = new EventSource(`${base.value}/stream`)
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data) as { type: string; data?: string; code?: number }

    if (payload.type === 'data' && payload.data) {
      status.value = 'live'
      term!.write(payload.data)
    } else if (payload.type === 'exit') {
      status.value = 'ended'
      term!.write(`\r\n\x1b[2m[shell exited${payload.code ? ` with ${payload.code}` : ''}]\x1b[0m\r\n`)
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
 * Clicking the pane focuses the shell.
 *
 * xterm only claims clicks that land on its own screen element, and this box
 * has padding around it — a click in the margin left focus on the document,
 * where the keystrokes went to the page instead and appeared to do nothing.
 */
function focusShell() {
  term?.focus()
}

/** Only ever on purpose — this kills whatever is running in it. */
async function closeShell() {
  await send({ close: true })
  status.value = 'ended'
}
</script>

<template>
  <div class="rounded-md overflow-hidden" style="border: 1px solid var(--border-subtle);">
    <div
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

    <div ref="host" class="terminal-host" @click="focusShell" />
  </div>
</template>

<style scoped>
/* Height here rather than on the xterm element: the addon measures this box to
   work out rows and columns, so it has to be the thing with a size. */
.terminal-host {
  height: clamp(16rem, 45vh, 34rem);
  padding: 8px;
  background: #1e1e2e;
}
</style>
