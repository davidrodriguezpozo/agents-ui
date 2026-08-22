<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { isSendKey } from '~/utils/keys'
import { composePointNotes, type PickedElement, type PointNote } from '~/utils/previewNotes'

/**
 * The session's own app, running and on screen — and pointable at.
 *
 * A diff says what changed and the checks say whether it still passes. Neither
 * answers "does it look right", which is why the last step out of this app was
 * a terminal, a dev server and a trip to localhost.
 *
 * Its own port per session, because the point of worktrees is that several run
 * at once and two dev servers fighting over 3000 is the thrash the check queue
 * already exists to prevent.
 *
 * Point mode is the other half. Looking at it tells you the button is the wrong
 * colour; saying so used to mean finding that button again in the source by hand
 * and describing it in prose. Now you click it and type the complaint, and the
 * turn carries a selector. The clicking happens inside the previewed page — see
 * `server/utils/previewPicker.ts` for the script and how it is injected — and
 * the two sides talk by `postMessage`, because the preview is served from its
 * own port and is therefore a different origin.
 */

/**
 * `sessionBusy` rather than `busy`: there is already a `busy` in here for
 * starting and stopping the server, and the two mean different things.
 */
const props = defineProps<{ sessionId: string, sessionBusy?: boolean }>()

/** Emitted once a turn carrying the notes exists, so the page can follow it. */
const emit = defineEmits<{ sent: [{ runId: string | null, count: number }] }>()

interface Status {
  command: string | null
  source: 'configured' | 'detected' | null
  from: string | null
  preview: {
    state: 'starting' | 'ready' | 'failed' | 'stopped'
    port: number
    command: string
    output: string
    pickerPort: number | null
  } | null
}

const toast = useToast()
const { send } = useSessions()

const status = ref<Status | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
/** Bumped to force the iframe to reload rather than show a cached failure. */
const frameKey = ref(0)

const base = computed(() => `/api/sessions/${encodeURIComponent(props.sessionId)}/preview`)
const state = computed(() => status.value?.preview?.state ?? null)
/*
 * `localhost` rather than a literal: a dev server asked for `localhost` can
 * bind `::1` alone while something else on the same port answers IPv4, and the
 * proxy below resolves that properly. This is only the fallback for when the
 * proxy would not start, so it leaves the choice to the browser's resolver
 * instead of guessing the family here.
 */
const url = computed(() => (status.value?.preview ? `http://localhost:${status.value.preview.port}` : ''))
/** Where the iframe actually points: the dev server with the picker in it. */
const pickerOrigin = computed(() => {
  const port = status.value?.preview?.pickerPort
  return port ? `http://127.0.0.1:${port}` : ''
})
const frameSrc = computed(() => pickerOrigin.value || url.value)

let poll: ReturnType<typeof setInterval> | null = null

async function load() {
  try {
    status.value = await $fetch<Status>(base.value)
  } catch (e) {
    error.value = errorMessage(e)
  }
}

async function start() {
  busy.value = true
  error.value = null
  try {
    await $fetch(base.value, { method: 'POST', body: {} })
    await load()
    // A cold build can take half a minute, so this follows rather than asking
    // somebody to keep pressing refresh.
    poll ??= setInterval(async () => {
      await load()
      if (state.value !== 'starting') {
        clearInterval(poll!)
        poll = null
        if (state.value === 'ready') frameKey.value++
      }
    }, 1000)
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

async function stop() {
  busy.value = true
  try {
    await $fetch(base.value, { method: 'POST', body: { stop: true } })
    await load()
    resetPicker()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

// --- Pointing at things ------------------------------------------------------

/**
 * Whether the page will answer at all, and if not, why not.
 *
 * `asking` is the window between the iframe loading and the picker saying
 * hello. It matters because the honest states are three, not two: it works, it
 * does not work and here is the reason, and we do not know yet. Drawing a Point
 * button that silently does nothing is the failure this replaces.
 */
type PickerState = 'idle' | 'asking' | 'ready' | 'unavailable'

const picker = ref<PickerState>('idle')
const pickerReason = ref<string | null>(null)
const pointing = ref(false)
const picked = ref<PickedElement | null>(null)
const draft = ref('')
const notes = ref<PointNote[]>([])
const sending = ref(false)
const frame = ref<HTMLIFrameElement | null>(null)
const noteBox = ref<HTMLTextAreaElement | null>(null)

/** How long to keep saying hello before calling the page unreachable. */
const HANDSHAKE_TRIES = 12
const HANDSHAKE_EVERY_MS = 250

let handshake: ReturnType<typeof setInterval> | null = null

function stopHandshake() {
  if (handshake) clearInterval(handshake)
  handshake = null
}

function resetPicker() {
  stopHandshake()
  picker.value = 'idle'
  pickerReason.value = null
  pointing.value = false
  picked.value = null
}

function toPage(message: Record<string, unknown>) {
  const target = frame.value?.contentWindow
  if (!target || !pickerOrigin.value) return
  target.postMessage({ ...message, source: 'agents-ui-host' }, pickerOrigin.value)
}

/**
 * Ask the page whether the picker is in it.
 *
 * Repeatedly, because a deferred script in a page still parsing has not run
 * yet and the iframe's `load` event is not a promise that it has. Twelve
 * quarter-seconds is three seconds, which is longer than any page takes to
 * parse and short enough that "unavailable" arrives while somebody is still
 * looking at the pane.
 */
function askPage() {
  stopHandshake()

  if (!pickerOrigin.value) {
    picker.value = 'unavailable'
    pickerReason.value = 'This preview is served straight from the dev server, so nothing could be '
      + 'added to the page. Stop it and run it again.'
    return
  }

  picker.value = 'asking'
  pickerReason.value = null

  let left = HANDSHAKE_TRIES
  const ping = () => {
    if (picker.value === 'ready') {
      stopHandshake()
      return
    }
    if (left-- <= 0) {
      stopHandshake()
      picker.value = 'unavailable'
      pickerReason.value = 'The preview page did not answer. It may not be an HTML page, or its '
        + 'Content-Security-Policy blocked the picker — reload the preview to try again.'
      return
    }
    toPage({ type: 'ping' })
  }

  ping()
  handshake = setInterval(ping, HANDSHAKE_EVERY_MS)
}

function onMessage(event: MessageEvent) {
  if (!pickerOrigin.value || event.origin !== pickerOrigin.value) return

  const data = event.data as { source?: string, type?: string, element?: PickedElement } | null
  if (!data || data.source !== 'agents-ui-picker') return

  if (data.type === 'ready') {
    stopHandshake()
    picker.value = 'ready'
    pickerReason.value = null
    // A navigation inside the preview loads a fresh copy of the script, which
    // has no idea Point mode was on. Ask again rather than lie about it.
    if (pointing.value) toPage({ type: 'point', on: true })
    return
  }

  if (data.type === 'off') {
    pointing.value = false
    return
  }

  if (data.type === 'picked' && data.element) {
    pointing.value = false
    picked.value = data.element
    draft.value = ''
    nextTick(() => noteBox.value?.focus())
  }
}

function togglePoint() {
  if (picker.value !== 'ready') return
  pointing.value = !pointing.value
  picked.value = null
  toPage({ type: 'point', on: pointing.value })
}

function noteId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Keep the note and go back to pointing.
 *
 * Held in the page rather than on the server, unlike the diff notes: a note
 * here is written against a preview that is running in front of you, and the
 * preview does not survive a reload either. Outliving the thing it describes
 * would make it a note about a port that has moved on.
 */
function keepNote() {
  const body = draft.value.trim()
  const element = picked.value
  if (!body || !element) return

  notes.value = [...notes.value, { ...element, id: noteId(), body, at: Date.now() }]
  picked.value = null
  draft.value = ''

  // Straight back into Point mode: two notes on one screen is the normal case.
  pointing.value = true
  toPage({ type: 'point', on: true })
}

function cancelNote() {
  picked.value = null
  draft.value = ''
}

function dropNote(id: string) {
  notes.value = notes.value.filter(note => note.id !== id)
}

function discardNotes() {
  notes.value = []
}

/**
 * Hand every note over as one turn.
 *
 * Never refused for a session that is busy: the server keeps the message and
 * releases it when the turn ends, and which of the two happened is its answer
 * rather than a guess made here — same as the diff notes and the chat box.
 */
async function sendNotes() {
  const composed = composePointNotes(notes.value)
  if (!composed.instruction || sending.value) return

  const count = composed.sent.length
  sending.value = true
  try {
    const result = await send(props.sessionId, composed.instruction)
    notes.value = []
    pointing.value = false
    toPage({ type: 'point', on: false })

    toast.add({
      title: result.runId ? 'Sent' : 'Queued',
      description: result.runId
        ? `${count} note${count === 1 ? '' : 's'} about the preview went as this turn.`
        : `${count} note${count === 1 ? '' : 's'} about the preview will go when this turn ends.`,
    })
    emit('sent', { runId: result.runId ?? null, count })
  } catch (e) {
    toast.add({ title: 'Could not send the notes', description: errorMessage(e), color: 'error' })
  } finally {
    sending.value = false
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  load()
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  stopHandshake()
  if (poll) clearInterval(poll)
  // The server keeps running deliberately: closing the pane is not the same as
  // being finished with it, and a cold start is expensive to repeat.
})

watch(state, (next) => {
  if (next !== 'ready') resetPicker()
})
</script>

<template>
  <div class="rounded-md overflow-hidden" style="border: 1px solid var(--border-subtle);">
    <div class="px-3 py-2 flex items-center gap-2" style="background: var(--surface-raised);">
      <span class="text-section-label flex-1">Preview</span>

      <span v-if="state" class="type-meta">
        {{ state === 'ready' ? `on port ${status!.preview!.port}`
          : state === 'starting' ? 'starting…'
            : state === 'failed' ? 'did not start' : 'stopped' }}
      </span>

      <!--
        Says what the press will do, and is disabled with the reason beside it
        rather than present-and-inert when the page cannot answer.
      -->
      <UButton
        v-if="state === 'ready'"
        :label="pointing ? 'Stop pointing' : 'Point'"
        :icon="pointing ? 'i-lucide-x' : 'i-lucide-crosshair'"
        size="xs"
        :variant="pointing ? 'solid' : 'ghost'"
        :color="pointing ? 'primary' : 'neutral'"
        :disabled="picker !== 'ready'"
        :loading="picker === 'asking'"
        @click="togglePoint"
      />

      <a
        v-if="state === 'ready'"
        :href="url"
        target="_blank"
        rel="noopener"
        class="type-meta hover:underline"
        style="color: var(--accent);"
      >Open in a tab</a>

      <UButton
        v-if="state === 'ready' || state === 'starting'"
        label="Stop"
        size="xs"
        variant="ghost"
        color="neutral"
        :loading="busy"
        @click="stop"
      />
      <UButton
        v-else-if="status?.command"
        label="Run it"
        icon="i-lucide-play"
        size="xs"
        :loading="busy"
        @click="start"
      />
    </div>

    <div v-if="!status?.command" class="px-3 py-6 text-center space-y-1">
      <p class="type-meta">No dev command set for this project.</p>
      <p class="field-hint">
        Set one in <NuxtLink to="/settings" class="underline ink-accent">Settings</NuxtLink>
        — the same place as the check and setup commands.
      </p>
    </div>

    <template v-else>
      <p v-if="error" class="px-3 py-2 type-meta ink-error">{{ error }}</p>

      <!--
        The output is the whole value of a failure: "did not start" on its own
        sends somebody to a terminal to find out why, which is the trip this
        was built to remove.
      -->
      <pre
        v-if="state === 'failed' && status.preview?.output"
        class="font-mono fs-micro leading-relaxed overflow-x-auto max-h-48 p-2.5 m-3 rounded"
        style="background: var(--surface-inset); color: var(--text-secondary);"
      >{{ status.preview.output }}</pre>

      <template v-else-if="state === 'ready'">
        <!-- Why the Point button is dead, in the place you looked for it -->
        <p
          v-if="picker === 'unavailable'"
          class="px-3 py-2 type-meta"
          style="background: var(--surface-inset); color: var(--text-secondary);"
        >
          The picker is unavailable. {{ pickerReason }}
        </p>
        <p v-else-if="pointing" class="px-3 py-2 type-meta" style="background: var(--surface-inset);">
          Click the element you want to talk about. Esc to stop pointing.
        </p>

        <iframe
          ref="frame"
          :key="frameKey"
          :src="frameSrc"
          class="preview-frame"
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          title="The session's app"
          @load="askPage"
        />

        <!-- What was clicked, and the box for what is wrong with it -->
        <div v-if="picked" class="px-3 py-2.5 space-y-1.5" style="border-top: 1px solid var(--accent-glow);">
          <div class="flex items-baseline gap-2 min-w-0">
            <span class="type-mono-meta ink-accent truncate">{{ picked.selector }}</span>
            <span v-if="picked.text" class="type-meta truncate">“{{ picked.text }}”</span>
          </div>
          <textarea
            ref="noteBox"
            v-model="draft"
            rows="2"
            class="field-textarea w-full"
            placeholder="What should change about this element?"
            @keydown="e => { if (isSendKey(e)) { e.preventDefault(); keepNote() } }"
            @keydown.esc="cancelNote"
          />
          <div class="flex items-center gap-2">
            <UButton label="Add note" size="xs" :disabled="!draft.trim()" @click="keepNote" />
            <UButton label="Cancel" size="xs" variant="ghost" color="neutral" @click="cancelNote" />
            <span class="type-meta">↵ to add · ⇧↵ for a new line</span>
          </div>
        </div>

        <!--
          What you have pointed at so far, and the one action that uses it. The
          button says which of send and queue will happen, because a session
          mid-turn keeps the notes rather than refusing them.
        -->
        <div
          v-if="notes.length"
          class="px-3 py-2.5 space-y-2"
          style="border-top: 1px solid var(--border-subtle); background: var(--surface-raised);"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="type-strong text-body">
              {{ notes.length }} note{{ notes.length === 1 ? '' : 's' }} to send
            </span>
            <div class="flex items-center gap-2">
              <UButton
                label="Discard"
                size="xs"
                variant="ghost"
                color="neutral"
                :disabled="sending"
                @click="discardNotes"
              />
              <UButton
                :label="props.sessionBusy ? 'Queue for the next turn' : 'Send as the next turn'"
                :icon="props.sessionBusy ? 'i-lucide-list-plus' : 'i-lucide-message-square-reply'"
                size="xs"
                :loading="sending"
                @click="sendNotes"
              />
            </div>
          </div>
          <div v-for="note in notes" :key="note.id" class="flex items-start gap-2 group/point">
            <span class="type-mono-meta shrink-0 ink-accent">{{ note.selector }}</span>
            <span class="type-detail flex-1 min-w-0">{{ note.body }}</span>
            <button
              class="opacity-0 group-hover/point:opacity-100 transition-opacity focus-ring rounded shrink-0"
              style="color: var(--text-disabled);"
              aria-label="Remove this note"
              :disabled="sending"
              @click="dropNote(note.id)"
            >
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </div>
        </div>
      </template>

      <div v-else-if="state === 'starting'" class="px-3 py-8 text-center">
        <p class="type-meta">Running <span class="font-mono">{{ status.command }}</span>…</p>
        <p class="field-hint">A cold start can take a while.</p>
      </div>

      <div v-else class="px-3 py-8 text-center space-y-1">
        <p class="type-meta">
          <span class="font-mono">{{ status.command }}</span>
          <template v-if="status.source === 'detected'"> — guessed from {{ status.from }}</template>
        </p>
        <p class="field-hint">
          Runs in this session's workspace, on a port of its own. If it ignores
          <span class="font-mono">PORT</span> and hardcodes one, sessions will collide.
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.preview-frame {
  width: 100%;
  height: clamp(18rem, 55vh, 40rem);
  border: 0;
  background: #fff;
  display: block;
}
</style>
