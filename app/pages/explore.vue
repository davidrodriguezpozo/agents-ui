<script setup lang="ts">
import { agentTemplates } from '~/utils/templates'
import { commandTemplates } from '~/utils/commandTemplates'
import { getAgentColor } from '~/utils/colors'
import { getFriendlyModelName } from '~/utils/terminology'

const { create: createAgent } = useAgents()
const { create: createCommand } = useCommands()
const { plugins, loading: pluginsLoading, error: pluginsError, fetchAll: fetchPlugins, toggleEnabled } = usePlugins()
const router = useRouter()
const route = useRoute()
const toast = useToast()

const creating = ref<string | null>(null)
const searchQuery = ref('')
const activeTab = ref<'templates' | 'extensions'>(route.query.tab === 'extensions' ? 'extensions' : 'templates')
const previewId = ref<string | null>(null)

const agentCategories: Record<string, string[]> = {
  Development: ['code-reviewer', 'debug-helper', 'documentation-writer'],
  Writing: ['writing-assistant', 'email-drafter', 'social-media-writer'],
  Productivity: ['project-planner', 'meeting-summarizer', 'research-assistant'],
}

function agentCategoryFor(id: string): string {
  for (const [cat, ids] of Object.entries(agentCategories)) {
    if (ids.includes(id)) return cat
  }
  return 'Other'
}

const filteredAgentTemplates = computed(() => {
  if (!searchQuery.value) return agentTemplates
  const q = searchQuery.value.toLowerCase()
  return agentTemplates.filter(t =>
    t.frontmatter.name.toLowerCase().includes(q) ||
    t.frontmatter.description.toLowerCase().includes(q)
  )
})

const groupedAgentTemplates = computed(() => {
  const groups: Record<string, typeof agentTemplates> = {}
  for (const t of filteredAgentTemplates.value) {
    const cat = agentCategoryFor(t.id)
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(t)
  }
  return groups
})

const filteredCommandTemplates = computed(() => {
  if (!searchQuery.value) return commandTemplates
  const q = searchQuery.value.toLowerCase()
  return commandTemplates.filter(t =>
    t.frontmatter.name.toLowerCase().includes(q) ||
    t.frontmatter.description.toLowerCase().includes(q)
  )
})

const filteredPlugins = computed(() => {
  if (!searchQuery.value) return plugins.value
  const q = searchQuery.value.toLowerCase()
  return plugins.value.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.description?.toLowerCase().includes(q) ||
    p.marketplace.toLowerCase().includes(q)
  )
})

const groupedByMarketplace = computed(() => {
  const groups: Record<string, typeof plugins.value> = {}
  for (const plugin of filteredPlugins.value) {
    const key = plugin.marketplace
    if (!groups[key]) groups[key] = []
    groups[key].push(plugin)
  }
  return groups
})

async function useAgentTemplate(templateId: string) {
  const template = agentTemplates.find(t => t.id === templateId)
  if (!template) return
  creating.value = templateId
  try {
    const agent = await createAgent({ frontmatter: { ...template.frontmatter }, body: template.body })
    toast.add({ title: `${template.frontmatter.name} created`, color: 'success' })
    router.push(`/agents/${agent.slug}`)
  } catch (e: any) {
    toast.add({ title: 'Failed to create', description: e.data?.message || e.message, color: 'error' })
  } finally {
    creating.value = null
  }
}

async function useCommandTemplate(templateId: string) {
  const template = commandTemplates.find(t => t.id === templateId)
  if (!template) return
  creating.value = templateId
  try {
    const command = await createCommand({
      frontmatter: { ...template.frontmatter },
      body: template.body,
      directory: template.directory,
    })
    toast.add({ title: `/${template.frontmatter.name} created`, color: 'success' })
    router.push(`/commands/${command.slug}`)
  } catch (e: any) {
    toast.add({ title: 'Failed to create', description: e.data?.message || e.message, color: 'error' })
  } finally {
    creating.value = null
  }
}

async function onToggle(id: string, enabled: boolean) {
  try {
    await toggleEnabled(id, enabled)
    toast.add({ title: `Extension ${enabled ? 'enabled' : 'disabled'}`, color: 'success' })
  } catch {
    toast.add({ title: 'Failed to update', color: 'error' })
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

onMounted(() => fetchPlugins())
</script>

<template>
  <div>
    <PageHeader title="Explore">
      <template #trailing>
        <span class="text-[12px] text-meta">{{ agentTemplates.length + commandTemplates.length }} templates</span>
      </template>
    </PageHeader>

    <div class="px-6 py-4 space-y-5">
      <!-- Tab switcher -->
      <div class="flex items-center gap-1 p-0.5 rounded-lg w-fit" style="background: var(--badge-subtle-bg);">
        <button
          class="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all"
          :style="{
            background: activeTab === 'templates' ? 'var(--surface-base)' : 'transparent',
            color: activeTab === 'templates' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            boxShadow: activeTab === 'templates' ? '0 1px 3px var(--card-shadow)' : 'none',
          }"
          @click="activeTab = 'templates'"
        >
          Templates
        </button>
        <button
          class="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all"
          :style="{
            background: activeTab === 'extensions' ? 'var(--surface-base)' : 'transparent',
            color: activeTab === 'extensions' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            boxShadow: activeTab === 'extensions' ? '0 1px 3px var(--card-shadow)' : 'none',
          }"
          @click="activeTab = 'extensions'"
        >
          Extensions ({{ plugins.length }})
        </button>
      </div>

      <!-- Search -->
      <input
        v-model="searchQuery"
        :placeholder="activeTab === 'templates' ? 'Search templates...' : 'Search extensions...'"
        class="field-search max-w-xs"
      />

      <!-- Templates Tab -->
      <template v-if="activeTab === 'templates'">
        <p class="text-[13px] leading-relaxed text-label">
          Ready-made configurations you can create with one click. Customize them after creation.
        </p>

        <!-- Agent templates -->
        <div v-for="(templates, category) in groupedAgentTemplates" :key="category" class="space-y-3">
          <h3 class="text-section-label">{{ category }}</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div
              v-for="template in templates"
              :key="template.id"
              class="rounded-xl overflow-hidden bg-card group"
            >
              <div class="p-4 space-y-3">
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-8 rounded-lg flex items-center justify-center shrink-0"
                    :style="{ background: getAgentColor(template.frontmatter.color) + '15', border: '1px solid ' + getAgentColor(template.frontmatter.color) + '25' }"
                  >
                    <UIcon :name="template.icon" class="size-4" :style="{ color: getAgentColor(template.frontmatter.color) }" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-[13px] font-medium truncate">{{ template.frontmatter.name }}</div>
                    <span class="text-[10px] px-1.5 py-px rounded-full" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">
                      {{ getFriendlyModelName(template.frontmatter.model) }}
                    </span>
                  </div>
                </div>
                <p class="text-[12px] text-label leading-relaxed">{{ template.frontmatter.description }}</p>
                <button
                  class="text-[12px] text-meta hover:text-label transition-colors"
                  @click="previewId = previewId === template.id ? null : template.id"
                >
                  {{ previewId === template.id ? 'Hide instructions' : 'Preview instructions' }}
                </button>
                <div
                  v-if="previewId === template.id"
                  class="rounded-lg p-3 text-[12px] font-mono leading-relaxed text-label max-h-48 overflow-y-auto"
                  style="background: var(--surface-base); border: 1px solid var(--border-subtle);"
                >
                  <pre class="whitespace-pre-wrap">{{ template.body }}</pre>
                </div>
              </div>
              <div class="px-4 py-3 flex items-center justify-end" style="border-top: 1px solid var(--border-subtle);">
                <UButton
                  label="Use template"
                  size="sm"
                  :loading="creating === template.id"
                  :disabled="creating !== null && creating !== template.id"
                  @click="useAgentTemplate(template.id)"
                />
              </div>
            </div>
          </div>
        </div>

        <div v-if="!filteredAgentTemplates.length && !filteredCommandTemplates.length" class="text-center py-12">
          <p class="text-[13px] text-label">No templates match your search.</p>
        </div>

        <!-- Action templates -->
        <div v-if="filteredCommandTemplates.length" class="space-y-3">
          <h3 class="text-section-label">Action Templates</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div
              v-for="template in filteredCommandTemplates"
              :key="template.id"
              class="rounded-xl overflow-hidden bg-card group"
            >
              <div class="p-4 space-y-3">
                <div class="flex items-center gap-2.5">
                  <div
                    class="size-8 rounded-lg flex items-center justify-center shrink-0"
                    style="background: var(--badge-subtle-bg); border: 1px solid var(--border-subtle);"
                  >
                    <UIcon :name="template.icon" class="size-4 text-label" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-[13px] font-medium truncate">/{{ template.frontmatter.name }}</div>
                  </div>
                </div>
                <p class="text-[12px] text-label leading-relaxed">{{ template.frontmatter.description }}</p>
                <button
                  class="text-[12px] text-meta hover:text-label transition-colors"
                  @click="previewId = previewId === template.id ? null : template.id"
                >
                  {{ previewId === template.id ? 'Hide instructions' : 'Preview instructions' }}
                </button>
                <div
                  v-if="previewId === template.id"
                  class="rounded-lg p-3 text-[12px] font-mono leading-relaxed text-label max-h-48 overflow-y-auto"
                  style="background: var(--surface-base); border: 1px solid var(--border-subtle);"
                >
                  <pre class="whitespace-pre-wrap">{{ template.body }}</pre>
                </div>
              </div>
              <div class="px-4 py-3 flex items-center justify-end" style="border-top: 1px solid var(--border-subtle);">
                <UButton
                  label="Use template"
                  size="sm"
                  :loading="creating === template.id"
                  :disabled="creating !== null && creating !== template.id"
                  @click="useCommandTemplate(template.id)"
                />
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Extensions Tab -->
      <template v-if="activeTab === 'extensions'">
        <p class="text-[13px] leading-relaxed text-label">
          Extensions add new features and capabilities to your agents.
        </p>

        <div
          v-if="pluginsError"
          class="rounded-xl px-4 py-3 flex items-start gap-3"
          style="background: rgba(248, 113, 113, 0.06); border: 1px solid rgba(248, 113, 113, 0.12);"
        >
          <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0 mt-0.5" style="color: var(--error);" />
          <span class="text-[12px]" style="color: var(--error);">{{ pluginsError }}</span>
        </div>

        <div v-if="pluginsLoading" class="space-y-1">
          <SkeletonRow v-for="i in 5" :key="i" />
        </div>

        <div v-else-if="Object.keys(groupedByMarketplace).length" class="space-y-4">
          <div v-for="(group, marketplace) in groupedByMarketplace" :key="marketplace">
            <div class="flex items-center gap-2 py-2 px-2 -mx-2">
              <UIcon name="i-lucide-store" class="size-3.5 text-meta" />
              <span class="font-mono text-[13px] font-medium text-body">{{ marketplace }}</span>
              <span class="font-mono text-[12px] text-meta">{{ group.length }}</span>
            </div>
            <div class="space-y-1">
              <div
                v-for="plugin in group"
                :key="plugin.id"
                class="flex items-center gap-3 px-3 py-2.5 rounded-lg group hover-row"
              >
                <label class="field-toggle shrink-0" @click.stop>
                  <input
                    type="checkbox"
                    :checked="plugin.enabled"
                    @change="onToggle(plugin.id, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="field-toggle__track">
                    <span class="field-toggle__thumb" />
                  </span>
                </label>
                <div class="flex items-center gap-3 flex-1 min-w-0">
                  <span class="text-[13px] font-medium w-44 shrink-0 truncate">{{ plugin.name }}</span>
                  <span class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 badge badge-subtle">v{{ plugin.version }}</span>
                  <span class="flex-1 text-[12px] truncate text-label">{{ plugin.description }}</span>
                  <div class="flex items-center gap-3 shrink-0">
                    <span v-if="plugin.skills.length" class="font-mono text-[10px] text-meta">
                      {{ plugin.skills.length }} skill{{ plugin.skills.length === 1 ? '' : 's' }}
                    </span>
                    <span class="font-mono text-[10px] text-meta">{{ formatDate(plugin.installedAt) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="searchQuery" class="text-center py-12">
          <p class="text-[13px] text-label">No extensions match your search.</p>
        </div>

        <div v-else class="text-center py-12 space-y-4">
          <div class="rounded-lg p-4 bg-card max-w-sm w-full mx-auto font-mono text-[12px] text-label leading-relaxed">
            <span class="text-meta"># Install an extension via Claude Code CLI</span><br>
            <span style="color: var(--accent);">claude</span> plugin add &lt;plugin-name&gt;
          </div>
          <p class="text-[13px] text-label">Extensions are installed via the Claude Code CLI and managed here.</p>
        </div>
      </template>
    </div>
  </div>
</template>
