<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { getAgentColor, modelColors } from '~/utils/colors'
import { agentTemplates } from '~/utils/templates'

const { agents, loading, error, create, fetchAll: fetchAgents } = useAgents()
const router = useRouter()
const toast = useToast()

const showCreateModal = ref(false)
const showImportModal = ref(false)
const searchQuery = ref('')
const sourceFilter = ref<'all' | 'user' | 'project' | 'plugin'>('all')
const skillCounts = ref<Record<string, number>>({})
const creatingTemplate = ref<string | null>(null)

onMounted(async () => {
  try {
    skillCounts.value = await $fetch<Record<string, number>>('/api/agents/skill-counts')
  } catch {
    // Non-critical
  }
})

const sourceFilters = computed(() => {
  const counts = { all: agents.value.length, user: 0, project: 0, plugin: 0 }
  for (const a of agents.value) {
    if (a.source === 'plugin') counts.plugin++
    else if (a.scope === 'project') counts.project++
    else counts.user++
  }
  return [
    { key: 'all' as const, label: 'All', count: counts.all },
    { key: 'user' as const, label: 'Personal', count: counts.user },
    { key: 'project' as const, label: 'Project', count: counts.project },
    { key: 'plugin' as const, label: 'Plugins', count: counts.plugin },
  ].filter(f => f.key === 'all' || f.count > 0)
})

const filteredAgents = computed(() => {
  const q = searchQuery.value.toLowerCase()
  return agents.value.filter((a) => {
    if (sourceFilter.value === 'plugin' && a.source !== 'plugin') return false
    if (sourceFilter.value === 'project' && (a.source === 'plugin' || a.scope !== 'project')) return false
    if (sourceFilter.value === 'user' && (a.source === 'plugin' || a.scope === 'project')) return false
    if (!q) return true
    return a.frontmatter.name.toLowerCase().includes(q)
      || a.frontmatter.description?.toLowerCase().includes(q)
      || (a.pluginName || '').toLowerCase().includes(q)
  })
})



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

      <!-- Search + source filter -->
      <div class="mb-5 flex items-center gap-3 flex-wrap">
        <input
          v-model="searchQuery"
          placeholder="Search agents..."
          class="field-search max-w-xs"
        />
        <div v-if="sourceFilters.length > 2" class="flex items-center gap-1">
          <button
            v-for="filter in sourceFilters"
            :key="filter.key"
            class="px-2.5 py-1 rounded-md fs-mono font-medium transition-all focus-ring"
            :style="{
              background: sourceFilter === filter.key ? 'var(--accent-muted)' : 'transparent',
              color: sourceFilter === filter.key ? 'var(--accent)' : 'var(--text-tertiary)',
            }"
            @click="sourceFilter = filter.key"
          >
            {{ filter.label }}
            <span class="font-mono fs-micro ml-1 opacity-70">{{ filter.count }}</span>
          </button>
        </div>
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

      <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <SkeletonCard v-for="i in 6" :key="i" />
      </div>

      <!-- Agent card grid -->
      <div v-else-if="filteredAgents.length" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <NuxtLink
          v-for="(agent, idx) in filteredAgents"
          :key="`${agent.source}-${agent.scope}-${agent.slug}`"
          :to="`/agents/${agent.slug}`"
          class="stagger-item rounded-lg p-4 focus-ring hover-card relative overflow-hidden group bg-card"
        >
          <!-- Color accent bar — thicker -->
          <div
            class="absolute inset-x-0 top-0 h-[4px] transition-opacity duration-200"
            :style="{ background: getAgentColor(agent.frontmatter.color) }"
          />

          <!-- Header: icon + name + model -->
          <div class="flex items-center gap-3 mb-2 relative">
            <div
              class="size-8 rounded-md flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105"
              :style="{ background: getAgentColor(agent.frontmatter.color) + '18', border: '1px solid ' + getAgentColor(agent.frontmatter.color) + '25' }"
            >
              <UIcon name="i-lucide-cpu" class="size-3.5" :style="{ color: getAgentColor(agent.frontmatter.color) }" />
            </div>
            <span class="type-strong truncate flex-1">
              {{ agent.frontmatter.name }}
            </span>
            <span
              v-if="agent.frontmatter.model && modelColors[agent.frontmatter.model]"
              class="fs-micro font-mono font-medium px-1.5 py-px rounded-full shrink-0"
              :class="[modelColors[agent.frontmatter.model]?.bg, modelColors[agent.frontmatter.model]?.text]"
            >
              {{ agent.frontmatter.model }}
            </span>
          </div>

          <!-- Description -->
          <p v-if="agent.frontmatter.description" class="fs-sm leading-relaxed line-clamp-2 text-label relative">
            {{ agent.frontmatter.description }}
          </p>

          <!-- Provenance + skill count -->
          <div class="mt-3 pt-3 relative flex items-center gap-2" style="border-top: 1px solid var(--border-subtle);">
            <SourceBadge
              :scope="agent.scope"
              :source="agent.source"
              :plugin-name="agent.pluginName"
              :project-dir="agent.projectDir"
            />
            <span v-if="skillCounts[agent.slug]" class="fs-micro text-meta flex items-center gap-1.5">
              <UIcon name="i-lucide-sparkles" class="size-3 ink-accent" />
              {{ skillCounts[agent.slug] }} skill{{ skillCounts[agent.slug] === 1 ? '' : 's' }}
            </span>
            <span
              v-if="agent.frontmatter.tools?.length"
              class="fs-micro text-meta ml-auto"
              :title="agent.frontmatter.tools.join(', ')"
            >
              {{ agent.frontmatter.tools.length }} tools
            </span>
          </div>
        </NuxtLink>
      </div>

      <!-- Empty state: search miss -->
      <EmptyState
        v-else-if="searchQuery"
        icon="i-lucide-search-x"
        title="No agents match your search"
        description="Try a shorter search, or switch the filter above."
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
