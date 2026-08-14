<script setup lang="ts">
import type { Workflow } from '~/types'
import { errorMessage } from '~/utils/errors'
import { workflowTemplates } from '~/utils/workflowTemplates'
import { agentTemplates } from '~/utils/templates'
import { getAgentColor } from '~/utils/colors'
import { groupByOrigin, filterGroups } from '~/utils/entityGroups'
import { relativeTime } from '~/utils/time'

const { workflows, loading, error, create, fetchAll } = useWorkflows()
const { agents, create: createAgent } = useAgents()
const router = useRouter()
const toast = useToast()
const searchQuery = ref('')
const showCreateModal = ref(false)
const creatingTemplate = ref<string | null>(null)
const newName = ref('')
const newDescription = ref('')
const creating = ref(false)

const groups = computed(() => filterGroups(
  groupByOrigin(workflows.value),
  searchQuery.value,
  w => [w.name, w.description],
))

/** The agents a workflow's steps point at, in order; `undefined` where one was deleted. */
function stepAgents(workflow: Workflow) {
  return workflow.steps.map(s => agents.value.find(a => a.slug === s.agentSlug))
}

async function useWorkflowTemplate(templateId: string) {
  const template = workflowTemplates.find(t => t.id === templateId)
  if (!template) return
  creatingTemplate.value = templateId
  try {
    const steps = []
    for (const step of template.steps) {
      const agentTemplate = agentTemplates.find(t => t.id === step.agentTemplateId)
      if (!agentTemplate) continue
      // Check if agent exists
      let agent = agents.value.find(a => a.slug === agentTemplate.frontmatter.name)
      if (!agent) {
        agent = await createAgent({ frontmatter: { ...agentTemplate.frontmatter }, body: agentTemplate.body })
      }
      steps.push({ id: crypto.randomUUID(), agentSlug: agent.slug, label: step.label })
    }
    const workflow = await create({ name: template.name, description: template.description, steps })
    router.push(`/workflows/${workflow.slug}`)
  } catch (e: any) {
    toast.add({ title: 'Failed to create', description: errorMessage(e), color: 'error' })
  } finally {
    creatingTemplate.value = null
  }
}

async function createBlank() {
  if (!newName.value.trim()) return
  creating.value = true
  try {
    const workflow = await create({
      name: newName.value.trim(),
      description: newDescription.value.trim(),
      steps: [],
    })
    showCreateModal.value = false
    newName.value = ''
    newDescription.value = ''
    router.push(`/workflows/${workflow.slug}`)
  } catch (e: any) {
    toast.add({ title: 'Failed to create', description: errorMessage(e), color: 'error' })
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader title="Workflows">
      <template #trailing>
        <span class="fs-sm text-meta">{{ workflows.length }}</span>
      </template>
      <template #right>
        <UButton label="New Workflow" icon="i-lucide-plus" size="sm" @click="() => { showCreateModal = true }" />
      </template>
    </PageHeader>

    <div class="page-container py-6">
      <p class="fs-base mb-4 leading-relaxed text-label">
        Chain agents together into multi-step pipelines that pass work from one agent to the next.
      </p>

      <!-- Search -->
      <div v-if="workflows.length" class="mb-5">
        <input
          v-model="searchQuery"
          placeholder="Search workflows..."
          class="field-search max-w-xs"
        />
      </div>

      <!-- Error state -->
      <div
        v-if="error"
        class="rounded-lg px-4 py-3 mb-4 flex items-start gap-3"
        style="background: var(--error-wash); border: 1px solid var(--error-tint);"
      >
        <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0 mt-0.5 ink-error" />
        <span class="fs-sm ink-error">{{ error }}</span>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="space-y-1">
        <SkeletonRow v-for="i in 3" :key="i" />
      </div>

      <EntityList v-else-if="groups.length" :groups="groups">
        <template #row="{ item: workflow }">
          <EntityRow
            accent
            icon="i-lucide-git-branch"
            :to="`/workflows/${workflow.slug}`"
            :name="workflow.name"
            :description="workflow.description"
          >
            <!--
              The step chain, which the card carried and is the one thing that
              says what a workflow actually is. A card that showed only a name
              and "0 steps" told you nothing about the concept.
            -->
            <template #badges>
              <div v-if="workflow.steps.length" class="flex -space-x-1 shrink-0">
                <div
                  v-for="(agent, idx) in stepAgents(workflow).slice(0, 4)"
                  :key="idx"
                  class="size-5 rounded-full flex items-center justify-center fs-micro font-bold"
                  :style="{
                    background: agent ? getAgentColor(agent.frontmatter.color) + '30' : 'var(--badge-subtle-bg)',
                    color: agent ? getAgentColor(agent.frontmatter.color) : 'var(--text-disabled)',
                    border: '2px solid var(--surface-base)',
                    zIndex: 10 - idx,
                  }"
                  :title="agent?.frontmatter.name ?? 'Agent no longer exists'"
                >
                  {{ idx + 1 }}
                </div>
              </div>
            </template>

            <template #meta>
              <span class="fs-micro text-meta">
                {{ workflow.steps.length }} step{{ workflow.steps.length === 1 ? '' : 's' }}
              </span>
              <span v-if="workflow.lastRunAt" class="fs-micro text-meta">
                ran {{ relativeTime(new Date(workflow.lastRunAt).getTime()) }}
              </span>
              <span v-else class="fs-micro text-meta">never run</span>
            </template>
          </EntityRow>
        </template>
      </EntityList>

      <!-- Empty state: search miss -->
      <EmptyState
        v-else-if="searchQuery"
        icon="i-lucide-search-x"
        title="No workflows match your search"
        description="Try a shorter search."
      />

      <!-- Empty state: no workflows — show templates -->
      <div v-else class="space-y-5">
        <div class="text-center py-8 space-y-2">
          <div class="flex justify-center">
            <div
              class="size-12 rounded-lg flex items-center justify-center"
              style="background: var(--accent-muted); border: 1px solid var(--accent-muted);"
            >
              <UIcon name="i-lucide-git-branch" class="size-6 ink-accent" />
            </div>
          </div>
          <h3 class="fs-lg font-semibold" style="color: var(--text-primary); font-family: var(--font-display);">Chain your agents together</h3>
          <p class="type-body max-w-md mx-auto">
            Create workflows that pass work from one agent to the next. Start from a template or create your own.
          </p>
        </div>

        <h4 class="text-section-label">Templates</h4>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            v-for="template in workflowTemplates"
            :key="template.id"
            class="rounded-md p-4 text-left hover-card focus-ring relative overflow-hidden group bg-card"
            :disabled="creatingTemplate !== null"
            @click="useWorkflowTemplate(template.id)"
          >
            <div class="flex items-center gap-2.5 mb-2">
              <UIcon :name="template.icon" class="size-4 shrink-0 text-label" />
              <span class="type-strong">{{ template.name }}</span>
              <UIcon
                v-if="creatingTemplate === template.id"
                name="i-lucide-loader-2"
                class="size-3.5 ml-auto animate-spin text-meta"
              />
            </div>
            <p class="type-detail leading-relaxed line-clamp-2">
              {{ template.description }}
            </p>
            <div class="flex items-center gap-1 mt-2">
              <span
                v-for="(step, idx) in template.steps"
                :key="idx"
                class="type-mono-meta"
              >
                {{ step.label }}<span v-if="idx < template.steps.length - 1" class="mx-1 ink-4">-></span>
              </span>
            </div>
          </button>
        </div>

        <div class="text-center">
          <UButton label="Or create from scratch" variant="ghost" size="sm" @click="() => { showCreateModal = true }" />
        </div>
      </div>
    </div>

    <!-- Create modal -->
    <UModal v-model:open="showCreateModal">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay modal-panel">
          <h3 class="text-page-title">New Workflow</h3>
          <form class="space-y-3" @submit.prevent="createBlank">
            <div>
              <label class="fs-sm font-medium text-label block mb-1">Name</label>
              <input
                v-model="newName"
                placeholder="My Workflow"
                class="field-input w-full"
                required
              />
            </div>
            <div>
              <label class="fs-sm font-medium text-label block mb-1">Description</label>
              <input
                v-model="newDescription"
                placeholder="What does this workflow do?"
                class="field-input w-full"
              />
            </div>
            <div class="flex justify-end gap-2 pt-2">
              <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="() => { showCreateModal = false }" />
              <UButton type="submit" label="Create" size="sm" :loading="creating" :disabled="!newName.trim()" />
            </div>
          </form>
        </div>
      </template>
    </UModal>
  </div>
</template>
