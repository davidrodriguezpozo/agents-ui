<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { getAgentColor, modelColors } from '~/utils/colors'
import { agentTemplates } from '~/utils/templates'
import { groupByOrigin, filterGroups } from '~/utils/entityGroups'

const { agents, loading, error, create, fetchAll: fetchAgents } = useAgents()
const router = useRouter()
const toast = useToast()

const showCreateModal = ref(false)
const showImportModal = ref(false)
const searchQuery = ref('')
const skillCounts = ref<Record<string, number>>({})
const creatingTemplate = ref<string | null>(null)

onMounted(async () => {
  try {
    skillCounts.value = await $fetch<Record<string, number>>('/api/agents/skill-counts')
  } catch {
    // Non-critical
  }
})

/**
 * Rows grouped by origin, like commands and skills. This was a card grid, which
 * meant the same question — "a named thing, from somewhere, with a description"
 * — was answered three different ways on three sibling pages. The agent's
 * identity colour survives the move as a tinted glyph rather than a bar.
 */
const groups = computed(() => filterGroups(
  groupByOrigin(agents.value),
  searchQuery.value,
  a => [a.frontmatter.name, a.frontmatter.description, a.pluginName],
))

const matchCount = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))



async function useTemplate(templateId: string) {
  const template = agentTemplates.find(t => t.id === templateId)
  if (!template) return
  creatingTemplate.value = templateId
  try {
    const agent = await create({ frontmatter: { ...template.frontmatter }, body: template.body })
    toast.add({ title: `${template.frontmatter.name} created`, color: 'success' })
    router.push(`/agents/${agent.slug}`)
  } catch (e: any) {
    toast.add({ title: 'Failed to create', description: errorMessage(e), color: 'error' })
  } finally {
    creatingTemplate.value = null
  }
}
</script>

<template>
  <div>
    <PageHeader title="Agents">
      <template #trailing>
        <span class="fs-sm text-meta">{{ agents.length }}</span>
      </template>
      <template #right>
        <UButton label="Import" icon="i-lucide-upload" size="sm" variant="soft" @click="() => { showImportModal = true }" />
        <UButton label="New Agent" icon="i-lucide-plus" size="sm" @click="() => { showCreateModal = true }" />
      </template>
    </PageHeader>

    <div class="page-container py-6">
      <p class="fs-base mb-4 leading-relaxed text-label">
        Specialized AI assistants with custom instructions and behavior.
      </p>

      <div class="mb-5 flex items-center gap-3 flex-wrap">
        <input
          v-model="searchQuery"
          placeholder="Search agents..."
          class="field-search max-w-xs"
        />
        <span v-if="searchQuery" class="type-detail">
          {{ matchCount }} of {{ agents.length }}
        </span>
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

      <div v-if="loading" class="space-y-1">
        <SkeletonRow v-for="i in 6" :key="i" />
      </div>

      <EntityList
        v-else-if="groups.length"
        :groups="groups"
        :plugin-route="id => `/plugins/${encodeURIComponent(id)}`"
      >
        <template #row="{ item: agent }">
          <EntityRow
            icon="i-lucide-cpu"
            :icon-color="getAgentColor(agent.frontmatter.color)"
            :to="`/agents/${agent.slug}`"
            :name="agent.frontmatter.name"
            :description="agent.frontmatter.description"
          >
            <!--
              Model tier, skills and tools are all properties of the agent, so
              they sit on the right. Putting the model pill inline pushed each
              description to a different x-position and made the column ragged.
            -->
            <template #meta>
              <span v-if="skillCounts[agent.slug]" class="fs-micro text-meta flex items-center gap-1.5">
                <UIcon name="i-lucide-sparkles" class="size-3 ink-accent" />
                {{ skillCounts[agent.slug] }}
              </span>
              <span
                v-if="agent.frontmatter.tools?.length"
                class="fs-micro text-meta"
                :title="agent.frontmatter.tools.join(', ')"
              >
                {{ agent.frontmatter.tools.length }} tools
              </span>
              <span
                v-if="agent.frontmatter.model && modelColors[agent.frontmatter.model]"
                class="fs-micro font-mono font-medium px-1.5 py-px rounded-full shrink-0"
                :class="[modelColors[agent.frontmatter.model]?.bg, modelColors[agent.frontmatter.model]?.text]"
              >
                {{ agent.frontmatter.model }}
              </span>
            </template>
          </EntityRow>
        </template>
      </EntityList>

      <!-- Empty state: search miss -->
      <EmptyState
        v-else-if="searchQuery"
        icon="i-lucide-search-x"
        title="No agents match your search"
        description="Try a shorter search — this looks through names, descriptions and plugin names."
      />

      <!-- Empty state: no agents — show templates -->
      <div v-else class="space-y-5">
        <div class="text-center py-4">
          <p class="type-body">No agents yet. Start from a template or create your own.</p>
        </div>

        <ExampleBlock title="What does a good agent look like?" class="max-w-md mx-auto mb-6">
          <div class="space-y-2 fs-mono ink-2">
            <div class="rounded-md p-3" style="background: var(--surface-base); border: 1px solid var(--border-subtle);">
              <p><strong style="color: var(--text-primary);">code-reviewer</strong> <span class="fs-micro ink-4">← This name is short and descriptive</span></p>
              <p class="mt-1">"Reviews pull requests for bugs, style, and security." <span class="fs-micro ink-4">← Explains what it does in one sentence</span></p>
              <p class="mt-1 fs-micro ink-3">"Check for bugs, flag security issues, suggest improvements..." <span style="color: var(--text-disabled);">← Instructions are specific</span></p>
            </div>
          </div>
        </ExampleBlock>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            v-for="template in agentTemplates"
            :key="template.id"
            class="rounded-md p-4 text-left hover-card focus-ring relative overflow-hidden group bg-card"
            :disabled="creatingTemplate !== null"
            @click="useTemplate(template.id)"
          >
            <div class="flex items-center gap-2.5 mb-2">
              <UIcon :name="template.icon" class="size-4 shrink-0 text-label" />
              <span class="type-strong">{{ template.frontmatter.name }}</span>
              <UIcon
                v-if="creatingTemplate === template.id"
                name="i-lucide-loader-2"
                class="size-3.5 ml-auto animate-spin text-meta"
              />
            </div>
            <p class="type-detail leading-relaxed line-clamp-2">
              {{ template.frontmatter.description }}
            </p>
          </button>
        </div>

        <div class="text-center">
          <UButton label="Or create from scratch" variant="ghost" size="sm" @click="() => { showCreateModal = true }" />
        </div>
      </div>
    </div>

    <UModal v-model:open="showCreateModal">
      <template #content>
        <AgentWizard
          @saved="(a) => { showCreateModal = false; router.push(`/agents/${a.slug}`) }"
          @cancel="showCreateModal = false"
        />
      </template>
    </UModal>

    <UModal v-model:open="showImportModal">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay">
          <h3 class="text-page-title">Import Agent</h3>
          <FileImport
            type="agents"
            @imported="(a) => { showImportModal = false; fetchAgents(); router.push(`/agents/${a.slug}`) }"
          />
          <div class="flex justify-end">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="() => { showImportModal = false }" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
