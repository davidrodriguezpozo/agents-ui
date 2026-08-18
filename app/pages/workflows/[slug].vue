<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import type { Workflow, WorkflowStep } from '~/types'
import { getAgentColor } from '~/utils/colors'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const slug = route.params.slug as string
const { fetchOne, update, remove } = useWorkflows()
const { agents } = useAgents()
const { run: activeRun, isRunning, starting, start, watch: watchRun, stop, history } = useWorkflowRun()

const workflow = ref<Workflow | null>(null)
const workflowSteps = ref<WorkflowStep[]>([])
const name = ref('')
const description = ref('')
const saving = ref(false)
const showRunModal = ref(false)
const paletteSearch = ref('')
const editingName = ref(false)
const editingDescription = ref(false)

// Load workflow
onMounted(async () => {
  try {
    const data = await fetchOne(slug)
    workflow.value = data
    workflowSteps.value = [...data.steps]
    name.value = data.name
    description.value = data.description
  } catch {
    toast.add({ title: 'Workflow not found', color: 'error' })
    router.push('/workflows')
    return
  }

  // Runs outlive this page now, so opening it has to ask what is already
  // happening rather than assuming a blank slate — which is what the old
  // browser-side version could safely assume, having lost anything in flight.
  pastRuns.value = await history(slug).catch(() => [])
  const latest = pastRuns.value[0]
  if (latest?.status === 'running') await watchRun(latest.id)
})

/**
 * Adding a step, and changing which agent one uses, are the same picker.
 * `replacing` is the step id being changed, or null when appending.
 */
const picking = ref(false)
const replacing = ref<string | null>(null)

function openPicker(stepId: string | null = null) {
  replacing.value = stepId
  paletteSearch.value = ''
  picking.value = true
}

function addAgent(agentSlug: string) {
  const agent = agents.value.find(a => a.slug === agentSlug)
  if (!agent) return

  if (replacing.value) {
    workflowSteps.value = workflowSteps.value.map(s => (
      s.id === replacing.value ? { ...s, agentSlug } : s
    ))
  } else {
    workflowSteps.value = [...workflowSteps.value, {
      id: crypto.randomUUID(),
      agentSlug,
      label: agent.frontmatter.name,
    }]
  }

  picking.value = false
  replacing.value = null
}

function relabelStep(stepId: string, label: string) {
  workflowSteps.value = workflowSteps.value.map(s => (s.id === stepId ? { ...s, label } : s))
}

// Node actions
function removeStep(stepId: string) {
  workflowSteps.value = workflowSteps.value.filter(s => s.id !== stepId)
}
function moveStep(stepId: string, direction: -1 | 1) {
  const idx = workflowSteps.value.findIndex(s => s.id === stepId)
  const newIdx = idx + direction
  if (newIdx < 0 || newIdx >= workflowSteps.value.length) return
  const copy = [...workflowSteps.value]
  const moving = copy[idx]
  const displaced = copy[newIdx]
  if (!moving || !displaced) return

  copy[idx] = displaced
  copy[newIdx] = moving
  workflowSteps.value = copy
}

// Save
async function save() {
  if (!workflow.value) return
  saving.value = true
  try {
    await update(slug, {
      name: name.value,
      description: description.value,
      steps: workflowSteps.value,
    })
    toast.add({ title: 'Workflow saved', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Failed to save', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

// Delete
async function deleteWorkflow() {
  if (!confirm('Delete this workflow?')) return
  try {
    await remove(slug)
    router.push('/workflows')
  } catch (e: any) {
    toast.add({ title: 'Failed to delete', description: errorMessage(e), color: 'error' })
  }
}

/**
 * The run happens on the server now, so this only has to start it and then
 * watch. Navigating away no longer stops anything — coming back picks the same
 * run up wherever it has got to.
 */
async function startRun(prompt: string, projectDir?: string) {
  showRunModal.value = false
  if (!workflow.value) return

  try {
    await start(slug, prompt, projectDir)
    await update(slug, { lastRunAt: new Date().toISOString() } as any).catch(() => {})
    pastRuns.value = await history(slug).catch(() => [])
  } catch (e) {
    toast.add({ title: 'Could not start it', description: errorMessage(e), color: 'error' })
  }
}

async function onStop() {
  try {
    await stop()
  } catch (e) {
    toast.add({ title: 'Could not stop it', description: errorMessage(e), color: 'error' })
  }
}

const canRun = computed(() => workflowSteps.value.length > 0 && !isRunning.value && !starting.value)

/**
 * The server's step runs in the shape the log already reads.
 *
 * Steps that have not started yet are not on the record at all — they are
 * padded here so the log shows the whole workflow from the outset rather than
 * growing a row at a time.
 */
const STATUS: Record<string, 'pending' | 'running' | 'completed' | 'failed' | 'skipped'> = {
  queued: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'skipped',
}

/**
 * How a step is going, for the row that shows it.
 *
 * Steps that have not started are not on the record at all, so they have no
 * status until the run reaches them — except once the run has stopped, when
 * "never ran" is the honest thing to say about the ones it never got to.
 */
function execFor(stepId: string) {
  if (!activeRun.value) return undefined

  const actual = activeRun.value.steps.find(s => s.stepId === stepId)
  if (!actual) {
    return activeRun.value.status === 'running'
      ? { status: 'pending' as const }
      : { status: 'skipped' as const }
  }

  return {
    status: STATUS[actual.status] ?? ('pending' as const),
    output: actual.output,
    error: actual.error,
    costUsd: actual.costUsd,
    durationMs: actual.durationMs,
  }
}

const RUN_LOOKS = {
  running: { text: 'Running…', colour: 'var(--accent)' },
  completed: { text: 'Finished', colour: 'var(--success)' },
  failed: { text: 'Stopped on a failure', colour: 'var(--error)' },
  stopped: { text: 'Stopped by you', colour: 'var(--text-secondary)' },
} as const

const runLook = computed(() => RUN_LOOKS[activeRun.value?.status ?? 'running'])

/** What the whole run has cost, which is the number worth seeing. */
const runCost = computed(() => {
  const total = (activeRun.value?.steps ?? []).reduce((sum, s) => sum + (s.costUsd ?? 0), 0)
  if (!total) return ''
  return total < 0.01 ? '<$0.01' : `$${total.toFixed(2)}`
})

const PAST = {
  running: { icon: 'i-lucide-loader-2', colour: 'var(--accent)' },
  completed: { icon: 'i-lucide-circle-check', colour: 'var(--success)' },
  failed: { icon: 'i-lucide-circle-x', colour: 'var(--error)' },
  stopped: { icon: 'i-lucide-minus-circle', colour: 'var(--text-disabled)' },
} as const

const filteredAgents = computed(() => {
  if (!paletteSearch.value) return agents.value
  const q = paletteSearch.value.toLowerCase()
  return agents.value.filter(a => a.frontmatter.name.toLowerCase().includes(q))
})

/** What this workflow has done before — a question the page could not answer. */
const pastRuns = ref<Awaited<ReturnType<typeof history>>>([])

/** What a past run took. Without this the history is a list of timestamps. */
function pastFacts(past: { costUsd?: number; durationMs?: number }): string {
  const parts: string[] = []
  if (past.durationMs) parts.push(`${Math.round(past.durationMs / 1000)}s`)
  if (past.costUsd) parts.push(past.costUsd < 0.01 ? '<$0.01' : `$${past.costUsd.toFixed(2)}`)
  return parts.join(' · ')
}
</script>

<template>
  <div class="flex flex-col h-full">
    <PageHeader :title="name || 'Untitled Workflow'" measure>
      <template #leading>
        <NuxtLink to="/workflows" class="p-1.5 -ml-1.5 rounded-md hover-bg focus-ring">
          <UIcon name="i-lucide-arrow-left" class="size-4 text-meta" />
        </NuxtLink>
      </template>

      <!-- Rename in place -->
      <template #title>
        <input
          v-if="editingName"
          v-model="name"
          class="field-input text-page-title w-full max-w-md"
          @blur="editingName = false"
          @keydown.enter="editingName = false"
        />
        <button
          v-else
          class="truncate text-left"
          @click="editingName = true"
        >
          {{ name || 'Untitled Workflow' }}
        </button>
      </template>

      <template #right>
        <UButton
          v-if="isRunning"
          label="Stop"
          icon="i-lucide-square"
          size="sm"
          color="error"
          variant="soft"
          @click="onStop"
        />
        <UButton
          v-else
          label="Run"
          icon="i-lucide-play"
          size="sm"
          :disabled="!canRun"
          @click="() => { showRunModal = true }"
        />
        <UButton label="Save" icon="i-lucide-save" size="sm" variant="soft" :loading="saving" @click="save" />
        <UButton icon="i-lucide-trash-2" size="sm" variant="ghost" color="error" @click="deleteWorkflow" />
      </template>
    </PageHeader>

    <!-- Description, on the frame so it lines up under the title -->
    <div class="page-container pt-4" style="border-bottom: 1px solid var(--border-subtle);">
      <input
        v-if="editingDescription"
        v-model="description"
        class="field-input type-body w-full max-w-lg mb-4"
        placeholder="What does this workflow do?"
        @blur="editingDescription = false"
        @keydown.enter="editingDescription = false"
      />
      <button
        v-else
        class="type-body text-left pb-4"
        @click="editingDescription = true"
      >
        {{ description || 'Add a description' }}
      </button>
    </div>

    <!-- Steps -->
    <div class="flex-1 overflow-y-auto">
      <div class="page-container page-container--measure py-5 space-y-5">
        <div v-if="activeRun" class="flex items-center gap-2">
          <span class="type-detail" :style="{ color: runLook.colour }">{{ runLook.text }}</span>
          <span v-if="runCost" class="type-meta">{{ runCost }} in total</span>
        </div>

        <div v-if="workflowSteps.length" class="space-y-2">
          <WorkflowStepRow
            v-for="(step, i) in workflowSteps"
            :key="step.id"
            :step="step"
            :index="i"
            :total="workflowSteps.length"
            :agent="agents.find(a => a.slug === step.agentSlug)"
            :status="execFor(step.id)?.status"
            :output="execFor(step.id)?.output"
            :error="execFor(step.id)?.error"
            :cost-usd="execFor(step.id)?.costUsd"
            :duration-ms="execFor(step.id)?.durationMs"
            :locked="isRunning"
            @remove="removeStep(step.id)"
            @move="(d) => moveStep(step.id, d)"
            @relabel="(label) => relabelStep(step.id, label)"
            @pick="openPicker(step.id)"
          />
        </div>

        <!-- Nothing to run yet, said as the next thing to do rather than a state -->
        <div v-else class="surface-card">
          <EmptyState
            variant="inset"
            icon="i-lucide-list-ordered"
            title="No steps yet"
            description="A workflow is a handful of agents, each picking up where the last one left off. Add the first."
            action-label="Add a step"
            action-icon="i-lucide-plus"
            @action="openPicker()"
          />
        </div>

        <button
          v-if="workflowSteps.length && !isRunning"
          class="w-full rounded-lg py-2.5 type-detail hover-bg focus-ring"
          style="border: 1px dashed var(--border-subtle); color: var(--text-secondary);"
          @click="openPicker()"
        >
          + Add a step
        </button>

        <!-- What it has done before. The page could not say, until runs were kept. -->
        <div v-if="pastRuns.length" class="space-y-2 pt-2">
          <h3 class="text-section-label">Past runs</h3>
          <div
            v-for="past in pastRuns"
            :key="past.id"
            class="flex items-center gap-2.5 px-3 py-2 rounded-md bg-card"
          >
            <UIcon
              :name="PAST[past.status].icon"
              class="size-3.5 shrink-0"
              :style="{ color: PAST[past.status].colour }"
            />
            <span class="type-detail flex-1 min-w-0 truncate">{{ past.input }}</span>
            <span v-if="pastFacts(past)" class="type-meta shrink-0">{{ pastFacts(past) }}</span>
            <span class="type-meta shrink-0">{{ relativeTime(past.startedAt) }}</span>
          </div>
        </div>
      </div>
    </div>


    <!-- Run modal -->
    <WorkflowRunModal
      :open="showRunModal"
      @update:open="showRunModal = $event"
      @start="startRun"
    />

    <!--
      One picker for both jobs: adding a step, and changing which agent an
      existing one uses. They were separate before, and the desktop path was a
      drag from a palette onto a canvas where position meant nothing.
    -->
    <UModal v-model:open="picking">
      <template #content>
        <div class="p-4 space-y-3 bg-overlay modal-panel">
          <h3 class="text-page-title">{{ replacing ? 'Use a different agent' : 'Add a step' }}</h3>
          <input v-model="paletteSearch" placeholder="Search agents..." class="field-search w-full" autofocus />
          <div class="space-y-1 max-h-72 overflow-y-auto">
            <button
              v-for="agent in filteredAgents"
              :key="agent.slug"
              class="w-full flex items-center gap-2.5 px-3 py-2 rounded-md hover-bg text-left focus-ring"
              @click="addAgent(agent.slug)"
            >
              <div class="size-2 rounded-full shrink-0" :style="{ background: getAgentColor(agent.frontmatter.color) }" />
              <span class="type-detail flex-1 min-w-0 truncate">{{ agent.frontmatter.name }}</span>
              <span v-if="agent.frontmatter.model" class="type-mono-meta shrink-0">{{ agent.frontmatter.model }}</span>
            </button>
            <p v-if="!filteredAgents.length" class="type-meta text-center py-6">Nothing matches that.</p>
          </div>
          <div class="flex justify-end">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="() => { picking = false }" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
