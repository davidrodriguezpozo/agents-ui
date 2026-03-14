<script setup lang="ts">
import type { Agent, AgentFrontmatter, AgentSkill } from '~/types'
import { getAgentColor, modelColors, agentColorMap } from '~/utils/colors'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { fetchOne, update, remove } = useAgents()

const slug = route.params.slug as string
const agent = ref<Agent | null>(null)
const saving = ref(false)
const agentSkills = ref<AgentSkill[]>([])

const frontmatter = ref<AgentFrontmatter>({ name: '', description: '' })
const body = ref('')

onMounted(async () => {
  try {
    const [agentData, skillsData] = await Promise.all([
      fetchOne(slug),
      $fetch<AgentSkill[]>(`/api/agents/${slug}/skills`),
    ])
    agent.value = agentData
    agentSkills.value = skillsData
    frontmatter.value = { ...agent.value.frontmatter }
    body.value = agent.value.body
  } catch {
    toast.add({ title: 'Agent not found', color: 'error' })
    router.push('/agents')
  }
})

async function save() {
  saving.value = true
  try {
    const updated = await update(slug, { frontmatter: frontmatter.value, body: body.value })
    agent.value = updated
    toast.add({ title: 'Saved', color: 'success' })
    if (updated.slug !== slug) router.replace(`/agents/${updated.slug}`)
  } catch (e: any) {
    toast.add({ title: 'Failed to save', description: e.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

const showDeleteConfirm = ref(false)

async function deleteAgent() {
  try {
    await remove(slug)
    toast.add({ title: 'Deleted', color: 'success' })
    router.push('/agents')
  } catch {
    toast.add({ title: 'Failed to delete', color: 'error' })
  }
}

// Cmd+S to save
if (import.meta.client) {
  const onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      save()
    }
  }
  onMounted(() => document.addEventListener('keydown', onKeydown))
  onUnmounted(() => document.removeEventListener('keydown', onKeydown))
}

const charCount = computed(() => body.value.length)
const lineCount = computed(() => body.value.split('\n').length)

const isDirty = computed(() => {
  if (!agent.value) return false
  return JSON.stringify(frontmatter.value) !== JSON.stringify(agent.value.frontmatter)
    || body.value !== agent.value.body
})

useUnsavedChanges(isDirty)

const colorOptions = Object.entries(agentColorMap).map(([value, hex]) => ({ value, hex }))
</script>

<template>
  <div>
    <PageHeader :title="agent?.frontmatter.name || slug">
      <template #leading>
        <NuxtLink to="/agents" class="focus-ring rounded">
          <UIcon name="i-lucide-arrow-left" class="size-4" style="color: var(--text-tertiary);" />
        </NuxtLink>
      </template>
      <template #trailing>
        <div
          v-if="agent"
          class="size-2.5 rounded-full"
          :style="{ background: getAgentColor(agent.frontmatter.color) }"
        />
      </template>
      <template #right>
        <button
          class="text-[12px] px-2 py-1 rounded focus-ring"
          style="color: var(--text-tertiary);"
          @click="showDeleteConfirm = true"
        >
          Delete
        </button>
        <span v-if="isDirty" class="text-[10px] font-mono" style="color: var(--warning);">unsaved</span>
        <UButton label="Save" icon="i-lucide-save" size="sm" :loading="saving" @click="save" />
      </template>
    </PageHeader>

    <!-- Breadcrumb -->
    <div class="px-6 pt-3 pb-1">
      <span class="text-[11px]" style="color: var(--text-disabled);">
        Agents &rsaquo; {{ agent?.frontmatter.name || slug }}
      </span>
    </div>

    <div v-if="agent" class="px-6 py-4 space-y-6">
      <!-- Configuration -->
      <div
        class="rounded-xl overflow-hidden"
        style="border: 1px solid var(--border-subtle);"
      >
        <!-- Agent identity banner -->
        <div class="relative px-5 pt-6 pb-5" style="background: var(--surface-raised);">
          <!-- Top color accent bar -->
          <div
            class="absolute inset-x-0 top-0 h-[3px] transition-colors duration-300"
            :style="{ background: getAgentColor(frontmatter.color) }"
          />

          <!-- Identity row -->
          <div class="flex items-start gap-4">
            <!-- Color indicator -->
            <div
              class="size-11 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-300"
              :style="{ background: getAgentColor(frontmatter.color) + '15', border: '1px solid ' + getAgentColor(frontmatter.color) + '25' }"
            >
              <UIcon name="i-lucide-bot" class="size-5 transition-colors duration-300" :style="{ color: getAgentColor(frontmatter.color) }" />
            </div>

            <div class="flex-1 min-w-0 pt-0.5">
              <div class="flex items-center gap-2.5 flex-wrap">
                <span class="font-mono text-[15px] font-semibold tracking-tight truncate" style="color: var(--text-primary);">
                  {{ frontmatter.name || 'Unnamed Agent' }}
                </span>
                <span
                  v-if="frontmatter.model && modelColors[frontmatter.model]"
                  class="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full shrink-0"
                  :class="[modelColors[frontmatter.model].bg, modelColors[frontmatter.model].text]"
                >
                  {{ frontmatter.model }}
                </span>
                <span
                  v-if="agent.hasMemory"
                  class="flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded-full shrink-0"
                  style="background: rgba(74, 222, 128, 0.1); color: #4ade80;"
                >
                  <UIcon name="i-lucide-brain" class="size-3" />
                  memory
                </span>
                <span
                  v-if="agentSkills.length"
                  class="flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded-full shrink-0"
                  style="background: var(--accent-muted); color: var(--accent);"
                >
                  <UIcon name="i-lucide-sparkles" class="size-3" />
                  {{ agentSkills.length }} skill{{ agentSkills.length === 1 ? '' : 's' }}
                </span>
              </div>
              <p class="text-[12px] mt-1 leading-relaxed" style="color: var(--text-tertiary);">
                {{ frontmatter.description || 'No description yet' }}
              </p>
            </div>
          </div>
        </div>

        <!-- Form fields -->
        <div class="px-5 py-4 space-y-4" style="background: var(--surface-base); border-top: 1px solid var(--border-subtle);">
          <h3 class="text-section-label">Configuration</h3>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="field-group">
              <label class="field-label">Name</label>
              <input v-model="frontmatter.name" class="field-input" />
            </div>
            <div class="field-group">
              <label class="field-label">Model</label>
              <div class="pill-picker">
                <button
                  type="button"
                  class="pill-picker__option"
                  :class="{ 'pill-picker__option--active': !frontmatter.model }"
                  @click="frontmatter.model = undefined"
                >none</button>
                <button
                  type="button"
                  class="pill-picker__option pill-picker__option--opus"
                  :class="{ 'pill-picker__option--active': frontmatter.model === 'opus' }"
                  @click="frontmatter.model = 'opus'"
                >opus</button>
                <button
                  type="button"
                  class="pill-picker__option pill-picker__option--sonnet"
                  :class="{ 'pill-picker__option--active': frontmatter.model === 'sonnet' }"
                  @click="frontmatter.model = 'sonnet'"
                >sonnet</button>
                <button
                  type="button"
                  class="pill-picker__option pill-picker__option--haiku"
                  :class="{ 'pill-picker__option--active': frontmatter.model === 'haiku' }"
                  @click="frontmatter.model = 'haiku'"
                >haiku</button>
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">Color</label>
              <div class="color-picker">
                <button
                  type="button"
                  class="color-picker__swatch"
                  :class="{ 'color-picker__swatch--active': !frontmatter.color }"
                  :style="{ background: '#71717a', '--swatch-glow': 'rgba(113, 113, 122, 0.3)' }"
                  title="None"
                  @click="frontmatter.color = undefined"
                />
                <button
                  v-for="c in colorOptions"
                  :key="c.value"
                  type="button"
                  class="color-picker__swatch"
                  :class="{ 'color-picker__swatch--active': frontmatter.color === c.value }"
                  :style="{ background: c.hex, '--swatch-glow': c.hex + '40' }"
                  :title="c.value"
                  @click="frontmatter.color = c.value"
                />
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">Memory</label>
              <div class="pill-picker">
                <button
                  type="button"
                  class="pill-picker__option"
                  :class="{ 'pill-picker__option--active': !frontmatter.memory }"
                  @click="frontmatter.memory = undefined"
                >none</button>
                <button
                  type="button"
                  class="pill-picker__option"
                  :class="{ 'pill-picker__option--active': frontmatter.memory === 'user' }"
                  @click="frontmatter.memory = 'user'"
                >user</button>
                <button
                  type="button"
                  class="pill-picker__option"
                  :class="{ 'pill-picker__option--active': frontmatter.memory === 'project' }"
                  @click="frontmatter.memory = 'project'"
                >project</button>
              </div>
            </div>
          </div>

          <div class="field-group">
            <label class="field-label">Description</label>
            <textarea v-model="frontmatter.description" rows="2" class="field-textarea" />
          </div>
        </div>
      </div>

      <!-- Agent Skills -->
      <div
        v-if="agentSkills.length"
        class="rounded-xl overflow-hidden"
        style="border: 1px solid var(--border-subtle);"
      >
        <div class="flex items-center justify-between px-4 py-2.5" style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);">
          <h3 class="text-section-label flex items-center gap-2">
            <UIcon name="i-lucide-sparkles" class="size-3.5" style="color: var(--accent);" />
            Skills
          </h3>
          <span class="font-mono text-[10px]" style="color: var(--text-disabled);">{{ agentSkills.length }}</span>
        </div>

        <div class="divide-y" style="divide-color: var(--border-subtle);">
          <NuxtLink
            v-for="skill in agentSkills"
            :key="skill.slug + skill.source"
            :to="skill.source === 'standalone' ? `/skills/${skill.slug}` : `/plugins/${encodeURIComponent(skill.pluginId!)}`"
            class="flex items-center gap-3 px-4 py-2.5 transition-colors group"
            @mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--surface-raised)'"
            @mouseleave="($event.currentTarget as HTMLElement).style.background = 'transparent'"
          >
            <UIcon name="i-lucide-sparkles" class="size-3.5 shrink-0" style="color: var(--accent);" />

            <span class="font-mono text-[13px] font-medium w-40 shrink-0 truncate" style="color: var(--text-primary);">
              {{ skill.frontmatter.name }}
            </span>

            <!-- Context badge -->
            <span
              v-if="skill.frontmatter.context"
              class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0"
              style="background: rgba(255,255,255,0.06); color: var(--text-disabled);"
            >
              {{ skill.frontmatter.context }}
            </span>

            <!-- Source badge -->
            <span
              class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0"
              :style="{
                background: skill.source === 'plugin' ? 'rgba(99,102,241,0.1)' : 'var(--accent-muted)',
                color: skill.source === 'plugin' ? 'rgb(129,140,248)' : 'var(--accent)',
              }"
            >
              {{ skill.source === 'plugin' ? skill.pluginName : 'standalone' }}
            </span>

            <!-- Description -->
            <span class="flex-1 text-[12px] truncate" style="color: var(--text-tertiary);">
              {{ skill.frontmatter.description }}
            </span>

            <div class="flex items-center gap-2 shrink-0">
              <span class="font-mono text-[10px]" style="color: var(--text-disabled);">
                {{ Math.round(skill.body.length / 100) / 10 }}k
              </span>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
                style="color: var(--text-disabled);"
              />
            </div>
          </NuxtLink>
        </div>
      </div>

      <!-- System Prompt Editor -->
      <div
        class="rounded-xl overflow-hidden"
        style="border: 1px solid var(--border-subtle);"
      >
        <div class="flex items-center justify-between px-4 py-2.5" style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);">
          <h3 class="text-section-label">System Prompt</h3>
          <div class="flex items-center gap-3">
            <span class="font-mono text-[10px]" style="color: var(--text-disabled);">
              {{ lineCount }} lines
            </span>
            <span class="font-mono text-[10px]" style="color: var(--text-disabled);">
              {{ charCount.toLocaleString() }} chars
            </span>
          </div>
        </div>
        <textarea
          v-model="body"
          class="editor-textarea"
          style="min-height: 500px;"
          spellcheck="false"
          placeholder="Agent system prompt..."
        />
      </div>

      <!-- File info -->
      <div class="flex items-center gap-3 font-mono text-[10px]" style="color: var(--text-disabled);">
        <span>{{ agent.filePath }}</span>
        <span v-if="agent.hasMemory" class="flex items-center gap-1">
          <UIcon name="i-lucide-brain" class="size-3" />
          memory
        </span>
      </div>
    </div>

    <div v-else class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" style="color: var(--text-disabled);" />
    </div>

    <!-- Delete confirmation -->
    <UModal v-model:open="showDeleteConfirm">
      <template #content>
        <div class="p-6 space-y-4" style="background: var(--surface-overlay);">
          <h3 class="text-page-title">Delete Agent</h3>
          <p class="text-[13px]" style="color: var(--text-secondary);">
            Delete <strong class="font-mono">{{ agent?.frontmatter.name }}</strong>? This removes the file from disk.
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="showDeleteConfirm = false" />
            <UButton label="Delete" color="error" size="sm" @click="deleteAgent" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
