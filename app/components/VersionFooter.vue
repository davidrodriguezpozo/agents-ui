<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

/**
 * Which version this is, always — and the shortest way to a newer one.
 *
 * The app knew all of this already and only ever said it when a *checkout* had
 * drifted, which meant an npm install — the way most people have this — showed
 * no version anywhere at all.
 */

interface Build {
  mode: 'deployed' | 'source' | 'package'
  version?: string
  sha?: string
  summary: string
  stale: boolean
}

interface Plan {
  current?: string
  latest?: string
  available: boolean
  command: string | null
  canRun: boolean
  canRestart: boolean
  note?: string
}

const build = ref<Build | null>(null)
const plan = ref<Plan | null>(null)
const open = ref(false)
const updating = ref(false)
const result = ref<{ ok: boolean; message: string } | null>(null)
const error = ref<string | null>(null)

/** Short enough for a sidebar; the panel has the rest. */
const label = computed(() => {
  const b = build.value
  if (!b) return ''
  if (b.mode === 'package') return b.version ? `v${b.version}` : 'installed release'
  if (b.mode === 'deployed') return b.sha ? `build ${b.sha.slice(0, 7)}` : 'deployed build'
  return 'from source'
})

async function load() {
  try {
    const data = await $fetch<{ build: Build; update: Plan }>('/api/system/update')
    build.value = data.build
    plan.value = data.update
  } catch {
    // A status line is not worth an error state.
  }
}

async function update() {
  updating.value = true
  error.value = null
  result.value = null
  try {
    result.value = await $fetch<{ ok: boolean; message: string }>('/api/system/update', { method: 'POST' })
    await load()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    updating.value = false
  }
}

async function copyCommand() {
  if (plan.value?.command) await navigator.clipboard.writeText(plan.value.command).catch(() => {})
}

onMounted(load)
</script>

<template>
  <div v-if="build" class="px-1">
    <!--
      Above the trigger, not below it. This sits on the last line of the
      sidebar, and the footer grows upward into the nav's space — a panel
      underneath would open off the bottom of the screen.
    -->
    <div v-if="open" class="mb-1 px-2 py-2 rounded-md space-y-2" style="background: var(--input-bg);">
      <p class="text-[10px]" style="color: var(--text-secondary);">{{ build.summary }}</p>

      <template v-if="plan?.available">
        <p v-if="plan.latest" class="text-[10px]" style="color: var(--accent);">
          {{ plan.latest }} is out.
        </p>
        <p v-else-if="plan.note" class="text-[10px]" style="color: var(--accent);">{{ plan.note }}</p>

        <!-- The command is shown whether or not the button applies, because in
             a checkout the command is the only answer. -->
        <button
          v-if="plan.command"
          class="w-full text-left text-[10px] font-mono px-1.5 py-1 rounded"
          style="background: var(--editor-bg); color: var(--editor-text);"
          title="Copy"
          @click="copyCommand"
        >{{ plan.command }}</button>

        <UButton
          v-if="plan.canRun"
          label="Update now"
          icon="i-lucide-download"
          size="xs"
          block
          :loading="updating"
          @click="update"
        />
      </template>

      <p v-else-if="plan?.note" class="text-[10px]" style="color: var(--text-disabled);">{{ plan.note }}</p>
      <p v-else class="text-[10px]" style="color: var(--text-disabled);">Up to date.</p>

      <p v-if="result" class="text-[10px]" :style="{ color: result.ok ? 'var(--success)' : 'var(--error)' }">
        {{ result.message }}
        <template v-if="result.ok">
          <!-- Said rather than done: restarting in the same click would take
               the app away from somebody who only wanted to check. -->
          <span v-if="plan?.canRestart" style="color: var(--text-disabled);">
            It restarts on its own once stopped — or run
            <span class="font-mono">agents-studio install</span> again.
          </span>
          <span v-else style="color: var(--text-disabled);">
            Stop this and start it again to pick it up.
          </span>
        </template>
      </p>

      <p v-if="error" class="text-[10px]" style="color: var(--error);">{{ error }}</p>
    </div>

    <button
      class="w-full flex items-center gap-1.5 px-2 py-1 rounded-md hover-bg transition-colors"
      :title="build.summary"
      @click="open = !open"
    >
      <!-- Only ever coloured when there is something to do about it. -->
      <span
        class="size-1.5 rounded-full shrink-0"
        :style="{ background: plan?.available ? 'var(--accent)' : 'var(--text-disabled)' }"
      />
      <span class="text-[10px] font-mono truncate" style="color: var(--text-disabled);">
        {{ label }}
      </span>
      <span v-if="plan?.available" class="text-[10px] ml-auto" style="color: var(--accent);">update</span>
    </button>
  </div>
</template>
