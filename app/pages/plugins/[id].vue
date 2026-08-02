<script setup lang="ts">
import type { PluginDetail, SkillFrontmatter } from '~/types'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { fetchOne, updateSkill, toggleEnabled, uninstall } = usePlugins()

const id = decodeURIComponent(route.params.id as string)
const plugin = ref<PluginDetail | null>(null)
const loading = ref(true)

type Tab = 'commands' | 'agents' | 'skills' | 'hooks' | 'mcp' | 'scripts'
const activeTab = ref<Tab>((route.query.tab as Tab) || 'commands')

// Track editable skill state
const editingSkill = ref<string | null>(null)
const skillFrontmatters = ref<Record<string, SkillFrontmatter>>({})
const skillBodies = ref<Record<string, string>>({})
const savingSkill = ref(false)

// Uninstall
const showUninstallConfirm = ref(false)
const uninstalling = ref(false)

onMounted(async () => {
  try {
    plugin.value = await fetchOne(id)
    for (const skill of plugin.value.skillDetails) {
      skillFrontmatters.value[skill.slug] = { ...skill.frontmatter }
      skillBodies.value[skill.slug] = skill.body
    }
    // Land on the first tab that actually has content.
    if (!route.query.tab) {
      activeTab.value = (tabs.value.find(t => t.count > 0)?.key ?? 'commands') as Tab
    }
  } catch {
    toast.add({ title: 'Plugin not found', color: 'error' })
    router.push('/plugins')
  } finally {
    loading.value = false
  }
})

const tabs = computed(() => {
  const counts = plugin.value?.counts
  return [
    { key: 'commands' as const, label: 'Commands', icon: 'i-lucide-terminal', count: counts?.commands ?? 0 },
    { key: 'agents' as const, label: 'Subagents', icon: 'i-lucide-cpu', count: counts?.agents ?? 0 },
    { key: 'skills' as const, label: 'Skills', icon: 'i-lucide-sparkles', count: counts?.skills ?? 0 },
    { key: 'hooks' as const, label: 'Hooks', icon: 'i-lucide-webhook', count: counts?.hooks ?? 0 },
    { key: 'mcp' as const, label: 'MCP', icon: 'i-lucide-plug', count: counts?.mcpServers ?? 0 },
    { key: 'scripts' as const, label: 'Scripts', icon: 'i-lucide-file-code', count: counts?.scripts ?? 0 },
  ]
})

const commandItems = computed(() =>
  (plugin.value?.commands ?? []).map(cmd => ({
    key: cmd.relPath,
    title: cmd.invocation,
    subtitle: cmd.argumentHint ? `${cmd.invocation} ${cmd.argumentHint}` : undefined,
    description: cmd.description,
    badges: [
      ...(cmd.namespace ? [{ label: cmd.namespace, tone: 'subtle' as const }] : []),
      ...(cmd.model ? [{ label: cmd.model, tone: 'subtle' as const }] : []),
      ...(cmd.allowedTools?.length ? [{ label: `${cmd.allowedTools.length} tools`, tone: 'subtle' as const }] : []),
    ],
    body: cmd.body,
    filePath: cmd.filePath,
  }))
)

const agentItems = computed(() =>
  (plugin.value?.agents ?? []).map(agent => ({
    key: agent.relPath,
    title: agent.name,
    description: agent.description,
    badges: [
      ...(agent.model ? [{ label: agent.model, tone: 'subtle' as const }] : []),
      ...(agent.tools?.length ? [{ label: `${agent.tools.length} tools`, tone: 'agent' as const }] : []),
    ],
    body: agent.body,
    filePath: agent.filePath,
  }))
)

const scriptItems = computed(() =>
  (plugin.value?.scripts ?? []).map(script => ({
    key: script.filePath,
    title: script.name,
    description: '',
    filePath: script.filePath,
  }))
)

function toggleSkillEditor(slug: string) {
  editingSkill.value = editingSkill.value === slug ? null : slug
}

async function saveSkill(slug: string) {
  savingSkill.value = true
  try {
    await updateSkill(id, slug, skillFrontmatters.value[slug]!, skillBodies.value[slug]!)
    const skill = plugin.value?.skillDetails.find(s => s.slug === slug)
    if (skill) {
      skill.frontmatter = { ...skillFrontmatters.value[slug]! }
      skill.body = skillBodies.value[slug]!
    }
    toast.add({ title: 'Skill saved', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Failed to save', description: e.message, color: 'error' })
  } finally {
    savingSkill.value = false
  }
}

async function onToggle(enabled: boolean) {
  try {
    await toggleEnabled(id, enabled)
    if (plugin.value) plugin.value.enabled = enabled
    toast.add({ title: `Plugin ${enabled ? 'enabled' : 'disabled'}`, color: 'success' })
  } catch {
    toast.add({ title: 'Failed to update', color: 'error' })
  }
}

async function onUninstall() {
  uninstalling.value = true
  try {
    await uninstall(id)
    toast.add({ title: 'Plugin uninstalled', color: 'success' })
    router.push('/plugins')
  } catch (e: any) {
    toast.add({ title: 'Failed to uninstall', description: e.message, color: 'error' })
  } finally {
    uninstalling.value = false
  }
}

function formatDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

watch(activeTab, (tab) => {
  router.replace({ query: { ...route.query, tab } })
})

// Cmd+S to save current skill
if (import.meta.client) {
  const onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && editingSkill.value) {
      e.preventDefault()
      saveSkill(editingSkill.value)
    }
  }
  onMounted(() => document.addEventListener('keydown', onKeydown))
  onUnmounted(() => document.removeEventListener('keydown', onKeydown))
}
</script>

<template>
  <div>
    <PageHeader :title="plugin?.name || id">
      <template #leading>
        <NuxtLink to="/plugins" class="focus-ring rounded p-1.5 -m-1.5" aria-label="Back to plugins">
          <UIcon name="i-lucide-arrow-left" class="size-4 text-label" />
        </NuxtLink>
      </template>
      <template #trailing>
        <div
          class="size-2.5 rounded-full shrink-0"
          :style="{ background: plugin?.enabled ? 'var(--success, #22c55e)' : 'var(--text-disabled)' }"
        />
      </template>
      <template #right>
        <button
          class="text-[12px] px-2 py-1 rounded focus-ring text-label"
          @click="showUninstallConfirm = true"
        >
          Uninstall
        </button>
        <label v-if="plugin" class="field-toggle" title="Enable/disable plugin">
          <input
            type="checkbox"
            :checked="plugin.enabled"
            @change="onToggle(($event.target as HTMLInputElement).checked)"
          />
          <span class="field-toggle__track">
            <span class="field-toggle__thumb" />
          </span>
        </label>
      </template>
    </PageHeader>

    <div v-if="loading" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
    </div>

    <div v-else-if="plugin" class="px-6 py-5 space-y-6">
      <!-- Plugin info card -->
      <div class="rounded-lg overflow-hidden" style="border: 1px solid var(--border-subtle);">
        <div class="relative px-5 pt-6 pb-5" style="background: var(--surface-raised);">
          <div
            class="absolute inset-x-0 top-0 h-[3px]"
            :style="{ background: plugin.enabled ? 'var(--success, #22c55e)' : 'var(--text-disabled)' }"
          />

          <div class="flex items-start gap-4">
            <div
              class="size-11 rounded-lg flex items-center justify-center shrink-0"
              style="background: var(--badge-subtle-bg); border: 1px solid var(--border-subtle);"
            >
              <UIcon name="i-lucide-puzzle" class="size-5" style="color: var(--accent);" />
            </div>

            <div class="flex-1 min-w-0 pt-0.5">
              <div class="flex items-center gap-2.5 flex-wrap">
                <span class="text-[15px] font-semibold tracking-tight truncate">{{ plugin.name }}</span>
                <span class="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full shrink-0 badge badge-subtle">
                  v{{ plugin.version }}
                </span>
                <span
                  class="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full shrink-0 badge"
                  :class="plugin.enabled ? 'badge-success' : 'badge-subtle'"
                >
                  {{ plugin.enabled ? 'enabled' : 'disabled' }}
                </span>
              </div>
              <p v-if="plugin.description" class="text-[12px] mt-1 leading-relaxed text-label">
                {{ plugin.description }}
              </p>
            </div>
          </div>
        </div>

        <!-- Metadata -->
        <div
          class="px-5 py-3 flex items-center gap-6 flex-wrap"
          style="background: var(--surface-base); border-top: 1px solid var(--border-subtle);"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-[12px] text-meta">Marketplace</span>
            <span class="font-mono text-[12px] text-body">{{ plugin.marketplace }}</span>
          </div>
          <div v-if="plugin.author" class="flex items-center gap-1.5">
            <span class="text-[12px] text-meta">Author</span>
            <span class="font-mono text-[12px] text-body">{{ plugin.author.name }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-[12px] text-meta">Installed</span>
            <span class="font-mono text-[12px] text-body">{{ formatDate(plugin.installedAt) }}</span>
          </div>
        </div>
      </div>

      <!-- Component tabs -->
      <div>
        <div class="flex gap-1 overflow-x-auto" style="border-bottom: 1px solid var(--border-subtle);">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="px-3 py-2.5 text-[12px] font-medium transition-all relative flex items-center gap-1.5 shrink-0"
            :style="{ color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-tertiary)' }"
            @click="activeTab = tab.key"
          >
            <UIcon :name="tab.icon" class="size-3.5" />
            {{ tab.label }}
            <span
              class="font-mono text-[10px] tabular-nums"
              :style="{ color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-disabled)' }"
            >
              {{ tab.count }}
            </span>
            <div
              v-if="activeTab === tab.key"
              class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
              style="background: var(--accent);"
            />
          </button>
        </div>

        <div class="pt-4">
          <PluginComponentList
            v-if="activeTab === 'commands'"
            :items="commandItems"
            empty-label="This plugin ships no slash commands."
            empty-icon="i-lucide-terminal"
          />

          <PluginComponentList
            v-else-if="activeTab === 'agents'"
            :items="agentItems"
            empty-label="This plugin ships no subagents."
            empty-icon="i-lucide-cpu"
          />

          <PluginComponentList
            v-else-if="activeTab === 'scripts'"
            :items="scriptItems"
            empty-label="This plugin ships no scripts."
            empty-icon="i-lucide-file-code"
          />

          <!-- Hooks -->
          <div v-else-if="activeTab === 'hooks'">
            <div v-if="!plugin.hooks.length" class="flex flex-col items-center justify-center py-12 space-y-3">
              <UIcon name="i-lucide-webhook" class="size-8 text-meta" />
              <p class="type-body">This plugin registers no hooks.</p>
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="(hook, i) in plugin.hooks"
                :key="`${hook.event}-${i}`"
                class="rounded-lg px-4 py-3 space-y-2"
                style="border: 1px solid var(--border-subtle);"
              >
                <div class="flex items-center gap-2">
                  <span class="font-mono text-[12px] font-medium" style="color: var(--accent);">{{ hook.event }}</span>
                  <span
                    v-if="hook.matcher"
                    class="text-[10px] font-mono px-1.5 py-px rounded-full badge badge-subtle"
                  >
                    matches {{ hook.matcher }}
                  </span>
                </div>
                <pre
                  v-for="cmd in hook.commands"
                  :key="cmd"
                  class="font-mono text-[11px] px-3 py-2 rounded-md overflow-x-auto text-body"
                  style="background: var(--surface-raised);"
                >{{ cmd }}</pre>
              </div>
            </div>
          </div>

          <!-- MCP servers -->
          <div v-else-if="activeTab === 'mcp'">
            <div v-if="!plugin.mcpServers.length" class="flex flex-col items-center justify-center py-12 space-y-3">
              <UIcon name="i-lucide-plug" class="size-8 text-meta" />
              <p class="type-body">This plugin registers no MCP servers.</p>
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="server in plugin.mcpServers"
                :key="server.name"
                class="rounded-lg px-4 py-3 flex items-center gap-3"
                style="border: 1px solid var(--border-subtle);"
              >
                <UIcon name="i-lucide-plug" class="size-4 shrink-0" style="color: var(--accent);" />
                <span class="font-mono text-[12px] font-medium shrink-0">{{ server.name }}</span>
                <span class="text-[10px] font-mono px-1.5 py-px rounded-full badge badge-subtle shrink-0">
                  {{ server.transport }}
                </span>
                <span class="font-mono text-[11px] truncate text-label">{{ server.target }}</span>
              </div>
            </div>
          </div>

          <!-- Skills (editable) -->
          <div v-else-if="activeTab === 'skills'">
            <div v-if="!plugin.skillDetails.length" class="flex flex-col items-center justify-center py-12 space-y-3">
              <UIcon name="i-lucide-sparkles" class="size-8 text-meta" />
              <p class="type-body">This plugin ships no skills.</p>
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="skill in plugin.skillDetails"
                :key="skill.slug"
                class="rounded-lg overflow-hidden"
                style="border: 1px solid var(--border-subtle);"
              >
                <button
                  class="w-full flex items-center gap-3 px-4 py-3 text-left hover-bg"
                  :style="{ background: editingSkill === skill.slug ? 'var(--surface-raised)' : undefined }"
                  @click="toggleSkillEditor(skill.slug)"
                >
                  <UIcon
                    :name="editingSkill === skill.slug ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    class="size-3.5 shrink-0 text-meta"
                  />
                  <span class="type-strong w-40 shrink-0 truncate">
                    {{ skill.frontmatter.name }}
                  </span>
                  <span
                    v-if="skill.frontmatter.agent"
                    class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 badge badge-agent"
                  >
                    agent: {{ skill.frontmatter.agent }}
                  </span>
                  <span class="flex-1 text-[12px] truncate text-label">
                    {{ skill.frontmatter.description }}
                  </span>
                  <span class="font-mono text-[10px] shrink-0 text-meta">
                    {{ Math.round(skill.body.length / 100) / 10 }}k chars
                  </span>
                </button>

                <div v-if="editingSkill === skill.slug" style="border-top: 1px solid var(--border-subtle);">
                  <div class="px-5 py-4 space-y-4" style="background: var(--surface-base);">
                    <h4 class="text-section-label">Configuration</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div class="field-group">
                        <label class="field-label">Name</label>
                        <input v-model="skillFrontmatters[skill.slug]!.name" class="field-input" />
                      </div>
                      <div class="field-group">
                        <label class="field-label">Context</label>
                        <input v-model="skillFrontmatters[skill.slug]!.context" class="field-input" placeholder="e.g. fork" />
                      </div>
                      <div class="field-group sm:col-span-2">
                        <label class="field-label">Description</label>
                        <input v-model="skillFrontmatters[skill.slug]!.description" class="field-input" />
                      </div>
                      <div class="field-group">
                        <label class="field-label">Agent</label>
                        <input v-model="skillFrontmatters[skill.slug]!.agent" class="field-input" placeholder="Optional agent name" />
                      </div>
                    </div>
                  </div>

                  <div style="border-top: 1px solid var(--border-subtle);">
                    <div
                      class="flex items-center justify-between px-4 py-2.5"
                      style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);"
                    >
                      <h4 class="text-section-label">Instructions</h4>
                      <div class="flex items-center gap-3">
                        <span class="type-mono-meta">
                          {{ skillBodies[skill.slug]!.split('\n').length }} lines
                        </span>
                        <span class="type-mono-meta">
                          {{ skillBodies[skill.slug]!.length.toLocaleString() }} chars
                        </span>
                      </div>
                    </div>
                    <textarea
                      v-model="skillBodies[skill.slug]"
                      class="editor-textarea"
                      style="min-height: 300px;"
                      spellcheck="false"
                      placeholder="Skill prompt..."
                    />
                  </div>

                  <div
                    class="flex items-center justify-between px-4 py-3"
                    style="background: var(--surface-raised); border-top: 1px solid var(--border-subtle);"
                  >
                    <span class="font-mono text-[10px] truncate text-meta">{{ skill.filePath }}</span>
                    <UButton label="Save Skill" icon="i-lucide-save" size="sm" :loading="savingSkill" @click="saveSkill(skill.slug)" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- File location (collapsed) -->
      <details class="group">
        <summary class="text-[10px] cursor-pointer list-none flex items-center gap-1.5 text-meta">
          <UIcon name="i-lucide-file" class="size-3" />
          Show file location
        </summary>
        <div class="mt-1 font-mono text-[10px] pl-4.5 text-meta">{{ plugin.installPath }}</div>
      </details>
    </div>

    <!-- Uninstall confirmation -->
    <UModal v-model:open="showUninstallConfirm">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay">
          <h3 class="text-page-title">Uninstall Plugin</h3>
          <p class="text-[13px] text-body">
            Uninstall <strong>{{ plugin?.name }}</strong>? The plugin will be removed but its files will remain on your computer.
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="showUninstallConfirm = false" />
            <UButton label="Uninstall" color="error" size="sm" :loading="uninstalling" @click="onUninstall" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
