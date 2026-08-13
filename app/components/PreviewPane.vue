<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

/**
 * The session's own app, running and on screen.
 *
 * A diff says what changed and the checks say whether it still passes. Neither
 * answers "does it look right", which is why the last step out of this app was
 * a terminal, a dev server and a trip to localhost.
 *
 * Its own port per session, because the point of worktrees is that several run
 * at once and two dev servers fighting over 3000 is the thrash the check queue
 * already exists to prevent.
 */

const props = defineProps<{ sessionId: string }>()

interface Status {
  command: string | null
  source: 'configured' | 'detected' | null
  from: string | null
  preview: { state: 'starting' | 'ready' | 'failed' | 'stopped'; port: number; command: string; output: string } | null
}

const status = ref<Status | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
/** Bumped to force the iframe to reload rather than show a cached failure. */
const frameKey = ref(0)

const base = computed(() => `/api/sessions/${encodeURIComponent(props.sessionId)}/preview`)
const state = computed(() => status.value?.preview?.state ?? null)
const url = computed(() => (status.value?.preview ? `http://127.0.0.1:${status.value.preview.port}` : ''))

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
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  // The server keeps running deliberately: closing the pane is not the same as
  // being finished with it, and a cold start is expensive to repeat.
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

      <iframe
        v-else-if="state === 'ready'"
        :key="frameKey"
        :src="url"
        class="preview-frame"
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
        title="The session's app"
      />

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
