<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { VueFlow } from '@vue-flow/core'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import type { Workflow, WorkflowStep } from '~/types'
import { getAgentColor } from '~/utils/colors'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const slug = route.params.slug as string
const { fetchOne, update, remove } = useWorkflows()
const { agents } = useAgents()
const { steps: execSteps, isRunning, isPaused, isComplete, currentStepIndex, run, continueWorkflow, continueWith, respondToStep, stop } = useWorkflowExecution()

const workflow = ref<Workflow | null>(null)
const workflowSteps = ref<WorkflowStep[]>([])
const name = ref('')
const description = ref('')
const saving = ref(false)
const showRunModal = ref(false)
const showMobileAgentPicker = ref(false)
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
  }
})

// Compute VueFlow nodes from steps
const nodes = computed(() =>
  workflowSteps.value.map((step, i) => {
    const agent = agents.value.find(a => a.slug === step.agentSlug)
    const exec = execSteps.value.find(e => e.stepId === step.id)
    return {
      id: step.id,
      type: 'workflow',
      position: { x: i * 220, y: 100 },
      data: {
        label: step.label,
        agentSlug: step.agentSlug,
        agentColor: agent?.frontmatter.color,
        agentModel: agent?.frontmatter.model,
        stepNumber: i + 1,
        status: exec?.status,
      },
    }
  })
)

// Compute edges (sequential: step[i] -> step[i+1])
const edges = computed(() =>
  workflowSteps.value.slice(0, -1).map((step, i) => ({
    id: `e-${step.id}-${workflowSteps.value[i + 1].id}`,
    source: step.id,
    target: workflowSteps.value[i + 1].id,
    animated: true,
    style: { strokeDasharray: '5 5', stroke: 'var(--accent)' },
    markerEnd: { type: 'arrowclosed', color: 'var(--accent)' },
  }))
)

// Drag-and-drop from palette
function onDrop(event: DragEvent) {
  const agentSlug = event.dataTransfer?.getData('agentSlug')
  if (!agentSlug) return
  const agent = agents.value.find(a => a.slug === agentSlug)
  if (!agent) return
  workflowSteps.value.push({
    id: crypto.randomUUID(),
    agentSlug,
    label: agent.frontmatter.name,
  })
}

function onDragOver(event: DragEvent) { event.preventDefault() }

function addAgent(agentSlug: string) {
  const agent = agents.value.find(a => a.slug === agentSlug)
  if (!agent) return
  workflowSteps.value.push({
    id: crypto.randomUUID(),
    agentSlug,
    label: agent.frontmatter.name,
  })
  showMobileAgentPicker.value = false
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
  ;[copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]]
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

// Run
async function startRun(prompt: string, projectDir?: string) {
  showRunModal.value = false
  if (!workflow.value) return
  const w = { ...workflow.value, steps: workflowSteps.value }
  await run(w, prompt, projectDir)
  // Update lastRunAt
  try {
    await update(slug, { lastRunAt: new Date().toISOString() } as any)
  } catch {
    // Non-critical
  }
}

const canRun = computed(() => workflowSteps.value.length > 0 && !isRunning.value)
const filteredAgents = computed(() => {
  if (!paletteSearch.value) return agents.value
  const q = paletteSearch.value.toLowerCase()
  return agents.value.filter(a => a.frontmatter.name.toLowerCase().includes(q))
})

const allCompleted = computed(() =>
  execSteps.value.length > 0 && execSteps.value.every(s => s.status === 'completed' || s.status === 'failed' || s.status === 'skipped') && !isRunning.value
)
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Top bar -->
    <div
      class="h-14 flex items-center gap-3 px-4 shrink-0 sticky top-0 z-10"
      style="border-bottom: 1px solid var(--border-subtle); background: var(--surface-base);"
    >
      <NuxtLink to="/workflows" class="p-1.5 rounded-md hover-bg focus-ring">
        <UIcon name="i-lucide-arrow-left" class="size-4 text-meta" />
      </NuxtLink>

      <!-- Editable name -->
      <div class="flex-1 min-w-0">
        <input
          v-if="editingName"
          v-model="name"
          class="field-input text-[14px] font-medium w-full max-w-xs"
          @blur="editingName = false"
          @keydown.enter="editingName = false"
        />
        <button
          v-else
          class="text-[14px] font-medium truncate text-left"
          style="color: var(--text-primary);"
          @click="editingName = true"
        >
          {{ name || 'Untitled Workflow' }}
        </button>
      </div>

      <!-- Mobile: Add Agent button -->
      <UButton
        class="md:hidden"
        label="Add Agent"
        icon="i-lucide-plus"
        size="xs"
        variant="soft"
        @click="showMobileAgentPicker = true"
      />

      <UButton
        v-if="isRunning"
        label="Stop"
        icon="i-lucide-square"
        size="sm"
        color="error"
        variant="soft"
        @click="stop"
      />
      <UButton
        v-else
        label="Run"
        icon="i-lucide-play"
        size="sm"
        :disabled="!canRun"
        @click="showRunModal = true"
      />
      <UButton label="Save" icon="i-lucide-save" size="sm" variant="soft" :loading="saving" @click="save" />
      <UButton icon="i-lucide-trash-2" size="sm" variant="ghost" color="error" @click="deleteWorkflow" />
    </div>

    <!-- Description -->
    <div class="px-4 py-2" style="border-bottom: 1px solid var(--border-subtle);">
      <input
        v-if="editingDescription"
        v-model="description"
        class="field-input text-[12px] w-full max-w-lg"
        placeholder="Workflow description..."
        @blur="editingDescription = false"
        @keydown.enter="editingDescription = false"
      />
      <button
        v-else
        class="text-[12px] text-left"
        style="color: var(--text-tertiary);"
        @click="editingDescription = true"
      >
        {{ description || 'Click to add a description...' }}
      </button>
    </div>

    <!-- Body: palette + canvas -->
    <div class="flex-1 flex min-h-0">
      <!-- Left palette (hidden on mobile) -->
      <div
        class="hidden md:flex flex-col w-[200px] shrink-0 overflow-hidden"
        style="border-right: 1px solid var(--border-subtle); background: var(--surface-raised);"
      >
        <div class="px-3 pt-3 pb-2">
          <div class="text-[11px] font-medium mb-2" style="color: var(--text-secondary);">Your Agents</div>
          <input
            v-model="paletteSearch"
            placeholder="Filter..."
            class="field-search w-full text-[11px]"
          />
        </div>
        <div class="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          <div
            v-for="agent in filteredAgents"
            :key="agent.slug"
            draggable="true"
            class="flex items-center gap-2 px-2.5 py-2 rounded-md cursor-grab active:cursor-grabbing hover-bg transition-colors"
            @dragstart="(e: DragEvent) => { e.dataTransfer?.setData('agentSlug', agent.slug) }"
          >
            <div
              class="size-2 rounded-full shrink-0"
              :style="{ background: getAgentColor(agent.frontmatter.color) }"
            />
            <span class="text-[11px] truncate" style="color: var(--text-secondary);">
              {{ agent.frontmatter.name }}
            </span>
            <UIcon name="i-lucide-grip-vertical" class="size-3 ml-auto text-meta opacity-50" />
          </div>
          <div v-if="!filteredAgents.length" class="text-[11px] text-center py-4 text-meta">
            No agents found
          </div>
        </div>
      </div>

      <!-- Canvas -->
      <div class="flex-1 flex flex-col min-w-0">
        <div class="flex-1 min-h-[300px]">
          <VueFlow
            :nodes="nodes"
            :edges="edges"
            fit-view-on-init
            :min-zoom="0.3"
            :max-zoom="2"
            @drop="onDrop"
            @dragover="onDragOver"
          >
            <template #node-workflow="nodeProps">
              <WorkflowNode
                :data="nodeProps.data"
                @remove="removeStep(nodeProps.id)"
                @move-up="moveStep(nodeProps.id, -1)"
                @move-down="moveStep(nodeProps.id, 1)"
              />
            </template>

            <Controls position="bottom-right" />
            <MiniMap v-if="workflowSteps.length >= 5" position="top-right" />
          </VueFlow>

          <!-- Empty canvas state -->
          <div
            v-if="!workflowSteps.length && workflow"
            class="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div class="text-center space-y-2">
              <UIcon name="i-lucide-mouse-pointer-click" class="size-8 mx-auto" style="color: var(--text-disabled);" />
              <p class="text-[13px]" style="color: var(--text-tertiary);">
                Drag agents from the left panel onto the canvas
              </p>
            </div>
          </div>
        </div>

        <!-- Workflow complete banner -->
        <div
          v-if="allCompleted && execSteps.length > 0"
          class="px-4 py-2.5 flex items-center gap-2"
          style="background: rgba(74, 222, 128, 0.06); border-top: 1px solid rgba(74, 222, 128, 0.12);"
        >
          <UIcon name="i-lucide-check-circle" class="size-4" style="color: var(--success, #22c55e);" />
          <span class="text-[12px] font-medium" style="color: var(--success, #22c55e);">Workflow complete</span>
        </div>

        <!-- Execution log -->
        <div v-if="execSteps.length > 0" class="p-4">
          <WorkflowExecutionLog
            :steps="execSteps"
            :workflow-steps="workflowSteps"
            :current-step-index="currentStepIndex"
            :is-paused="isPaused"
            :is-complete="isComplete"
            @continue="continueWorkflow"
            @continue-with="continueWith"
            @respond="respondToStep"
            @stop="stop"
          />
        </div>
      </div>
    </div>

    <!-- Run modal -->
    <WorkflowRunModal
      :open="showRunModal"
      @update:open="showRunModal = $event"
      @start="startRun"
    />

    <!-- Mobile agent picker -->
    <UModal v-model:open="showMobileAgentPicker">
      <template #content>
        <div class="p-4 space-y-3 bg-overlay">
          <h3 class="text-page-title">Add Agent</h3>
          <input
            v-model="paletteSearch"
            placeholder="Search agents..."
            class="field-search w-full"
          />
          <div class="space-y-1 max-h-64 overflow-y-auto">
            <button
              v-for="agent in filteredAgents"
              :key="agent.slug"
              class="w-full flex items-center gap-2.5 px-3 py-2 rounded-md hover-bg text-left"
              @click="addAgent(agent.slug)"
            >
              <div
                class="size-2 rounded-full shrink-0"
                :style="{ background: getAgentColor(agent.frontmatter.color) }"
              />
              <span class="text-[12px]" style="color: var(--text-secondary);">
                {{ agent.frontmatter.name }}
              </span>
            </button>
          </div>
          <div class="flex justify-end">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="showMobileAgentPicker = false" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
