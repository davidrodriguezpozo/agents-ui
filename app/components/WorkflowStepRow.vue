<script setup lang="ts">
import { getAgentColor } from '~/utils/colors'
import type { Agent, WorkflowStep } from '~/types'

/**
 * One step of a workflow, as a row.
 *
 * This replaced a node on a canvas. A workflow is an ordered list of two
 * fields, and the canvas was a graph editor for it — with positions computed
 * from the array index and never saved, so dragging a node anywhere did
 * nothing and it snapped back to a row on the next render.
 *
 * A row can carry what a node could not: while the workflow runs, the step's
 * status, what it cost, how long it took, and what it actually said.
 */

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

const props = defineProps<{
  step: WorkflowStep
  index: number
  total: number
  agent?: Agent
  status?: StepStatus
  output?: string
  error?: string
  costUsd?: number
  durationMs?: number
  /** Nothing is editable while the workflow is running. */
  locked?: boolean
}>()

const emit = defineEmits<{
  remove: []
  move: [direction: -1 | 1]
  relabel: [label: string]
  pick: []
}>()

const expanded = ref(false)
const editing = ref(false)
const draft = ref(props.step.label)

const LOOKS: Record<StepStatus, { icon: string; colour: string; spin?: boolean; word: string }> = {
  pending: { icon: 'i-lucide-circle-dashed', colour: 'var(--text-disabled)', word: 'Waiting' },
  running: { icon: 'i-lucide-loader-2', colour: 'var(--accent)', spin: true, word: 'Running' },
  completed: { icon: 'i-lucide-circle-check', colour: 'var(--success)', word: 'Done' },
  failed: { icon: 'i-lucide-circle-x', colour: 'var(--error)', word: 'Failed' },
  skipped: { icon: 'i-lucide-minus-circle', colour: 'var(--text-disabled)', word: 'Never ran' },
}

const look = computed(() => (props.status ? LOOKS[props.status] : null))

/** Cost and duration, when there is a real run behind this step. */
const facts = computed(() => {
  const parts: string[] = []
  if (props.durationMs) parts.push(`${(props.durationMs / 1000).toFixed(1)}s`)
  if (props.costUsd) parts.push(props.costUsd < 0.01 ? '<$0.01' : `$${props.costUsd.toFixed(2)}`)
  return parts.join(' · ')
})

/** Enough to recognise the answer, not enough to have to scroll past it. */
const preview = computed(() => {
  const text = (props.output ?? '').trim().replace(/\s+/g, ' ')
  return text.length > 140 ? `${text.slice(0, 140)}…` : text
})

function commit() {
  editing.value = false
  const next = draft.value.trim()
  if (next && next !== props.step.label) emit('relabel', next)
  else draft.value = props.step.label
}
</script>

<template>
  <div class="rounded-lg bg-card overflow-hidden">
    <div class="flex items-start gap-3 px-3.5 py-3">
      <!-- Position, or the status once there is one to show -->
      <div class="shrink-0 mt-0.5">
        <UIcon
          v-if="look"
          :name="look.icon"
          class="size-4"
          :class="{ 'animate-spin': look.spin }"
          :style="{ color: look.colour }"
        />
        <span
          v-else
          class="flex items-center justify-center size-4 rounded-full text-[10px] font-mono"
          style="background: var(--badge-subtle-bg); color: var(--text-secondary);"
        >{{ index + 1 }}</span>
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <input
            v-if="editing"
            v-model="draft"
            class="field-input text-[13px] font-medium max-w-xs"
            @blur="commit"
            @keydown.enter="commit"
            @keydown.esc="() => { editing = false; draft = step.label }"
          />
          <button
            v-else
            class="type-strong text-left truncate"
            :disabled="locked"
            @click="() => { if (!locked) editing = true }"
          >
            {{ step.label }}
          </button>

          <!-- Which agent does it, which is the step's whole substance -->
          <button
            class="inline-flex items-center gap-1.5 text-[11px] px-1.5 py-px rounded-full shrink-0"
            style="background: var(--badge-subtle-bg); color: var(--text-secondary);"
            :disabled="locked"
            :title="locked ? undefined : 'Use a different agent'"
            @click="() => { if (!locked) emit('pick') }"
          >
            <span
              class="size-1.5 rounded-full"
              :style="{ background: getAgentColor(agent?.frontmatter.color) }"
            />
            {{ agent?.frontmatter.name ?? step.agentSlug }}
            <span v-if="agent?.frontmatter.model" class="type-mono-meta">{{ agent.frontmatter.model }}</span>
          </button>
        </div>

        <div v-if="look" class="flex items-center gap-2 mt-1">
          <span class="type-detail" :style="{ color: look.colour }">{{ look.word }}</span>
          <span v-if="facts" class="type-meta">{{ facts }}</span>
        </div>

        <p v-if="error" class="type-detail mt-1" style="color: var(--error);">{{ error }}</p>

        <!-- What it said. The reason for running the thing. -->
        <div v-if="preview" class="mt-1.5">
          <p class="type-detail leading-relaxed" :class="{ 'line-clamp-2': !expanded }">
            {{ expanded ? output : preview }}
          </p>
          <button
            v-if="(output ?? '').length > 140"
            class="type-meta underline hover:opacity-80 mt-0.5"
            @click="expanded = !expanded"
          >
            {{ expanded ? 'Less' : 'All of it' }}
          </button>
        </div>
      </div>

      <div v-if="!locked" class="flex items-center gap-0.5 shrink-0">
        <button
          class="p-1 rounded hover-bg focus-ring disabled:opacity-30"
          :disabled="index === 0"
          title="Move up"
          @click="emit('move', -1)"
        >
          <UIcon name="i-lucide-chevron-up" class="size-3.5 text-meta" />
        </button>
        <button
          class="p-1 rounded hover-bg focus-ring disabled:opacity-30"
          :disabled="index === total - 1"
          title="Move down"
          @click="emit('move', 1)"
        >
          <UIcon name="i-lucide-chevron-down" class="size-3.5 text-meta" />
        </button>
        <button class="p-1 rounded hover-bg focus-ring" title="Remove this step" @click="emit('remove')">
          <UIcon name="i-lucide-x" class="size-3.5" style="color: var(--error);" />
        </button>
      </div>
    </div>
  </div>
</template>
