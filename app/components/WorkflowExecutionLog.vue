<script setup lang="ts">
import type { StepExecution, WorkflowStep } from '~/types'
import { renderMarkdown } from '~/utils/markdown'

const props = defineProps<{
  steps: readonly StepExecution[]
  workflowSteps: WorkflowStep[]
  currentStepIndex: number
  isPaused: boolean
  isComplete: boolean
}>()

const emit = defineEmits<{
  continue: []
  continueWith: [text: string]
  respond: [reply: string]
  stop: []
}>()

const expandedStep = ref<string | null>(null)
const editMode = ref(false)
const respondMode = ref(false)
const editText = ref('')
const replyText = ref('')

// Auto-expand the current/paused step
watch(() => props.currentStepIndex, (idx) => {
  const step = props.workflowSteps[idx]
  if (step) expandedStep.value = step.id
})

// Reset modes when pause state changes
watch(() => props.isPaused, (paused) => {
  if (paused) {
    editMode.value = false
    respondMode.value = false
    const currentStep = props.steps[props.currentStepIndex]
    editText.value = currentStep?.output || ''
    replyText.value = ''
  }
})

function toggleStep(stepId: string) {
  expandedStep.value = expandedStep.value === stepId ? null : stepId
}

function stepLabel(stepId: string): string {
  const ws = props.workflowSteps.find(s => s.id === stepId)
  return ws?.label || 'Step'
}

function formatDuration(exec: StepExecution): string {
  if (!exec.startedAt || !exec.completedAt) return ''
  const ms = exec.completedAt - exec.startedAt
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function onContinue() {
  editMode.value = false
  respondMode.value = false
  emit('continue')
}

function onContinueEdited() {
  if (!editText.value.trim()) return
  editMode.value = false
  emit('continueWith', editText.value.trim())
}

function onRespond() {
  if (!replyText.value.trim()) return
  respondMode.value = false
  emit('respond', replyText.value.trim())
}

const statusConfig: Record<string, { color: string; icon: string; label: string }> = {
  pending: { color: 'var(--text-disabled)', icon: 'i-lucide-clock', label: 'Pending' },
  running: { color: 'var(--accent)', icon: 'i-lucide-loader-2', label: 'Running' },
  completed: { color: 'var(--success, #22c55e)', icon: 'i-lucide-check-circle', label: 'Completed' },
  failed: { color: 'var(--error)', icon: 'i-lucide-x-circle', label: 'Failed' },
  skipped: { color: 'var(--text-disabled)', icon: 'i-lucide-skip-forward', label: 'Skipped' },
}

const nextStepLabel = computed(() => {
  if (!props.isPaused) return ''
  const next = props.workflowSteps[props.currentStepIndex + 1]
  return next?.label ?? ''
})
</script>

<template>
  <div
    class="rounded-lg overflow-hidden"
    style="border: 1px solid var(--border-subtle); background: var(--surface-raised);"
  >
    <div class="px-4 py-2.5 flex items-center gap-2" style="border-bottom: 1px solid var(--border-subtle);">
      <UIcon name="i-lucide-scroll-text" class="size-3.5" style="color: var(--accent);" />
      <h3 class="text-section-label flex-1">Execution Log</h3>
      <span
        v-if="isComplete"
        class="text-[10px] font-medium px-2 py-0.5 rounded-full"
        style="background: rgba(34, 197, 94, 0.1); color: var(--success, #22c55e);"
      >
        Workflow complete
      </span>
    </div>

    <div class="divide-y" style="divide-color: var(--border-subtle); max-height: 400px; overflow-y: auto;">
      <div
        v-for="(exec, idx) in steps"
        :key="exec.stepId"
        class="group"
      >
        <!-- Step header -->
        <button
          class="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover-bg transition-colors"
          @click="toggleStep(exec.stepId)"
        >
          <UIcon
            :name="statusConfig[exec.status]?.icon || 'i-lucide-clock'"
            class="size-3.5 shrink-0"
            :class="{ 'animate-spin': exec.status === 'running' }"
            :style="{ color: statusConfig[exec.status]?.color }"
          />
          <span class="text-[12px] font-medium flex-1" style="color: var(--text-primary);">
            #{{ idx + 1 }} {{ stepLabel(exec.stepId) }}
          </span>
          <span
            class="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
            :style="{ color: statusConfig[exec.status]?.color, background: statusConfig[exec.status]?.color + '15' }"
          >
            {{ statusConfig[exec.status]?.label }}
          </span>
          <span v-if="formatDuration(exec)" class="type-mono-meta">
            {{ formatDuration(exec) }}
          </span>
          <UIcon
            name="i-lucide-chevron-down"
            class="size-3 text-meta transition-transform"
            :class="{ 'rotate-180': expandedStep === exec.stepId }"
          />
        </button>

        <!-- Step details -->
        <div v-if="expandedStep === exec.stepId" class="px-4 pb-3 space-y-2">
          <!-- Input -->
          <details v-if="exec.input" class="group/input">
            <summary class="type-mono-meta cursor-pointer select-none">
              Input
            </summary>
            <div
              class="mt-1 rounded-md p-2.5 text-[11px] font-mono leading-relaxed max-h-32 overflow-y-auto"
              style="background: var(--surface-base); border: 1px solid var(--border-subtle); color: var(--text-secondary);"
            >
              <pre class="whitespace-pre-wrap">{{ exec.input }}</pre>
            </div>
          </details>

          <!-- Output -->
          <div v-if="exec.output">
            <div class="type-mono-meta mb-1">Output</div>
            <div
              class="rounded-md p-2.5 text-[12px] max-h-64 overflow-y-auto markdown"
              style="background: var(--surface-base); border: 1px solid var(--border-subtle); color: var(--text-secondary);"
              v-html="renderMarkdown(exec.output)"
            />
          </div>

          <!-- Error -->
          <div
            v-if="exec.error"
            class="rounded-md p-2.5 text-[11px]"
            style="background: rgba(248, 113, 113, 0.06); border: 1px solid rgba(248, 113, 113, 0.12); color: var(--error);"
          >
            {{ exec.error }}
          </div>
        </div>
      </div>
    </div>

    <!-- Pause review bar -->
    <div
      v-if="isPaused"
      class="px-4 py-3 space-y-3"
      style="border-top: 1px solid var(--border-subtle); background: var(--accent-muted);"
    >
      <!-- Default: action buttons -->
      <div v-if="!editMode && !respondMode">
        <p class="text-[12px] mb-2" style="color: var(--text-secondary);">
          Step complete. Review the output, then choose what to do next.
        </p>
        <div class="flex items-center gap-2 flex-wrap">
          <UButton
            :label="`Continue to ${nextStepLabel}`"
            icon="i-lucide-arrow-right"
            size="sm"
            @click="onContinue"
          />
          <UButton
            label="Edit output"
            icon="i-lucide-pencil"
            size="sm"
            variant="soft"
            @click="() => { editMode = true }"
          />
          <UButton
            label="Reply to agent"
            icon="i-lucide-message-circle"
            size="sm"
            variant="soft"
            @click="() => { respondMode = true }"
          />
          <UButton
            label="Stop"
            icon="i-lucide-square"
            size="sm"
            variant="ghost"
            color="error"
            @click="emit('stop')"
          />
        </div>
      </div>

      <!-- Edit mode: modify output before passing to next step -->
      <div v-if="editMode" class="space-y-2">
        <p class="text-[11px]" style="color: var(--text-tertiary);">
          Edit the output before it's passed to the next step.
        </p>
        <textarea
          v-model="editText"
          rows="4"
          class="field-input w-full resize-none font-mono text-[12px]"
        />
        <div class="flex items-center gap-2">
          <UButton label="Continue with edited text" size="sm" :disabled="!editText.trim()" @click="onContinueEdited" />
          <UButton label="Cancel" size="sm" variant="ghost" color="neutral" @click="() => { editMode = false }" />
        </div>
      </div>

      <!-- Respond mode: reply to the agent (re-runs same step) -->
      <div v-if="respondMode" class="space-y-2">
        <p class="text-[11px]" style="color: var(--text-tertiary);">
          Reply to the agent. It will process your response and try again.
        </p>
        <textarea
          v-model="replyText"
          rows="3"
          class="field-input w-full resize-none text-[12px]"
          placeholder="Type your answer to the agent's questions..."
        />
        <div class="flex items-center gap-2">
          <UButton label="Send reply" icon="i-lucide-send" size="sm" :disabled="!replyText.trim()" @click="onRespond" />
          <UButton label="Cancel" size="sm" variant="ghost" color="neutral" @click="() => { respondMode = false }" />
        </div>
      </div>
    </div>
  </div>
</template>
