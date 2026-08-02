<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import type { Command } from '~/types'

const props = defineProps<{ command: Command | null }>()
const emit = defineEmits<{ close: [] }>()

const { startRun } = useRuns()
const { workingDir, displayPath } = useWorkingDir()
const router = useRouter()
const toast = useToast()

const args = ref('')
const starting = ref(false)
const showSchedule = ref(false)

watch(() => props.command, () => { args.value = '' })

const hint = computed(() => props.command?.frontmatter['argument-hint'] || '')
const needsArgs = computed(() => Boolean(hint.value))

async function run() {
  if (!props.command || starting.value) return

  starting.value = true
  try {
    // Server-owned: this keeps going even if the tab is closed.
    const id = await startRun({
      input: args.value.trim()
        ? `${props.command.invocation} ${args.value.trim()}`
        : props.command.invocation,
      kind: 'command',
      title: props.command.frontmatter.description || props.command.invocation,
      invocation: props.command.invocation,
    })
    emit('close')
    router.push(`/runs/${id}`)
  } catch (e: any) {
    toast.add({ title: 'Could not start', description: errorMessage(e), color: 'error' })
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div v-if="command" class="p-6 space-y-5 bg-overlay">
    <div class="space-y-1.5">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-play" class="size-4" style="color: var(--accent);" />
        <h3 class="text-page-title">Run {{ command.invocation }}</h3>
      </div>
      <p class="text-[13px] text-label leading-relaxed">
        {{ command.frontmatter.description || 'No description provided.' }}
      </p>
    </div>

    <!-- Where it will run -->
    <div
      class="rounded-lg px-3 py-2.5 flex items-start gap-2.5"
      :style="{
        background: workingDir ? 'var(--surface-raised)' : 'rgba(229, 169, 62, 0.06)',
        border: '1px solid ' + (workingDir ? 'var(--border-subtle)' : 'rgba(229, 169, 62, 0.16)'),
      }"
    >
      <UIcon name="i-lucide-folder" class="size-3.5 shrink-0 mt-0.5" style="color: var(--accent);" />
      <div class="flex-1 min-w-0">
        <div class="text-[11px] font-medium text-body">
          {{ workingDir ? 'Runs in this folder' : 'No folder selected' }}
        </div>
        <div class="font-mono text-[10px] truncate text-meta">
          {{ displayPath || 'Pick a project folder in the sidebar first, or it runs in your Claude settings folder.' }}
        </div>
      </div>
    </div>

    <div v-if="needsArgs" class="field-group">
      <label class="field-label">What should it work on?</label>
      <input
        v-model="args"
        class="field-input"
        :placeholder="hint"
        autofocus
        @keydown.enter="run"
      />
      <span class="field-hint">This command expects: {{ hint }}</span>
    </div>

    <div class="flex items-center justify-between gap-2">
      <span class="font-mono text-[10px] truncate text-meta">
        {{ command.invocation }}{{ args.trim() ? ' ' + args.trim() : '' }}
      </span>
      <div class="flex gap-2 shrink-0">
        <UButton
          label="Every day"
          icon="i-lucide-alarm-clock"
          variant="ghost"
          color="neutral"
          size="sm"
          title="Run this on a schedule instead"
          @click="showSchedule = true"
        />
        <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="emit('close')" />
        <UButton label="Run" icon="i-lucide-play" size="sm" :loading="starting" @click="run" />
      </div>
    </div>

    <UModal v-model:open="showSchedule">
      <template #content>
        <ScheduleModal
          :preset-input="args.trim() ? `${command.invocation} ${args.trim()}` : command.invocation"
          :preset-title="command.frontmatter.description || command.invocation"
          @saved="() => { showSchedule = false; emit('close') }"
          @close="showSchedule = false"
        />
      </template>
    </UModal>
  </div>
</template>
