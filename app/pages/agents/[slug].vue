<script setup lang="ts">
import type { Agent, AgentFrontmatter, AgentSkill } from '~/types'
import { getAgentColor, modelColors, agentColorMap } from '~/utils/colors'
import { scoreAgent } from '~/utils/agentScoring'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { fetchOne, update, remove } = useAgents()
const { startAgentChat } = useChat()

const slug = route.params.slug as string
const agent = ref<Agent | null>(null)
const saving = ref(false)
const agentSkills = ref<AgentSkill[]>([])
const lastModified = ref<number | null>(null)

const frontmatter = ref<AgentFrontmatter>({ name: '', description: '' })
const body = ref('')

const { hasDraft, draftAge, loadDraft, clearDraft, scheduleSave } = useDraftRecovery(`agent:${slug}`)
const { versions, saveVersion, formatTime, simpleDiff } = useVersionHistory(`agent:${slug}`)

// Auto-save on changes
watch([frontmatter, body], () => {
  if (agent.value) scheduleSave(frontmatter.value, body.value)
}, { deep: true })

function restoreDraft() {
  const draft = loadDraft()
  if (draft) {
    frontmatter.value = draft.frontmatter as AgentFrontmatter
    body.value = draft.body
    clearDraft()
    toast.add({ title: 'Draft restored', color: 'success' })
  }
}

onMounted(async () => {
  try {
    const [agentData, skillsData] = await Promise.all([
      fetchOne(slug),
      $fetch<AgentSkill[]>(`/api/agents/${slug}/skills`),
    ])
    agent.value = agentData
    lastModified.value = (agentData as any).lastModified ?? null
    agentSkills.value = skillsData
    frontmatter.value = { ...agent.value.frontmatter }
    body.value = agent.value.body
  } catch {
    toast.add({ title: 'Agent not found', color: 'error' })
    router.push('/agents')
  }
})

async function save() {
  if (!frontmatter.value.name.trim()) {
    toast.add({ title: 'Name is required', color: 'error' })
    return
  }
  saving.value = true
  try {
    // Snapshot current state before overwriting
    if (agent.value) {
      saveVersion(agent.value.frontmatter, agent.value.body)
    }
    const updated = await update(slug, { frontmatter: frontmatter.value, body: body.value, lastModified: lastModified.value } as any)
    agent.value = updated
    lastModified.value = (updated as any).lastModified ?? null
    clearDraft()
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

const quality = computed(() => scoreAgent(frontmatter.value, body.value))
</script>

<template>
  <div>
    <PageHeader :title="agent?.frontmatter.name || slug">
      <template #leading>
        <NuxtLink to="/agents" class="focus-ring rounded p-1.5 -m-1.5" aria-label="Back to agents">
          <UIcon name="i-lucide-arrow-left" class="size-4 text-label" />
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
        <UButton
          label="Chat"
          icon="i-lucide-message-circle"
          size="sm"
          variant="soft"
          :disabled="!agent"
          @click="startAgentChat({ slug, name: agent!.frontmatter.name, color: getAgentColor(agent!.frontmatter.color) })"
        />
        <a
          :href="`/api/agents/${slug}/export`"
          download
          class="text-[12px] px-2 py-1 rounded focus-ring text-label hover-bg"
          title="Download .md file"
        >
          <UIcon name="i-lucide-download" class="size-3.5" />
        </a>
        <button
          class="text-[12px] px-2 py-1 rounded focus-ring text-label"
          @click="showDeleteConfirm = true"
        >
          Delete
        </button>
        <span v-if="isDirty" class="text-[10px] font-mono unsaved-pulse" style="color: var(--warning);">unsaved</span>
        <UButton label="Save" icon="i-lucide-save" size="sm" :loading="saving" @click="save" />
      </template>
    </PageHeader>

    <div v-if="agent" class="px-6 py-5 space-y-6">
      <FeatureCallout
        feature-key="agentDetail"
        message="This is where you configure your agent — its name, instructions, and what it can do."
        action="Start by writing clear instructions in the Instructions tab."
      />

      <!-- Draft recovery banner -->
      <div
        v-if="hasDraft"
        class="rounded-xl px-4 py-3 flex items-center gap-3"
        style="background: rgba(59, 130, 246, 0.06); border: 1px solid rgba(59, 130, 246, 0.12);"
      >
        <UIcon name="i-lucide-archive-restore" class="size-4 shrink-0" style="color: var(--info, #3b82f6);" />
        <span class="text-[12px] flex-1" style="color: var(--text-secondary);">
          You have an unsaved draft from {{ draftAge }}.
        </span>
        <button class="text-[12px] font-medium px-2 py-1 rounded hover-bg" style="color: var(--info, #3b82f6);" @click="restoreDraft">Restore</button>
        <button class="text-[12px] px-2 py-1 rounded hover-bg text-meta" @click="clearDraft">Dismiss</button>
      </div>

      <!-- Configuration -->
      <div
        class="rounded-xl overflow-hidden"
        style="border: 1px solid var(--border-subtle);"
      >
        <!-- Agent identity banner -->
        <div class="relative px-5 pt-6 pb-5" style="background: var(--surface-raised)">
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
                <span class="text-[15px] font-semibold tracking-tight truncate">
                  {{ frontmatter.name || 'Unnamed Agent' }}
                </span>
                <span
                  v-if="frontmatter.model && modelColors[frontmatter.model]"
                  class="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full shrink-0"
                  :class="[modelColors[frontmatter.model].bg, modelColors[frontmatter.model].text]"
                >
                  {{ frontmatter.model }}
                </span>
              </div>
              <p v-if="frontmatter.description" class="text-[12px] mt-1 leading-relaxed text-label">
                {{ frontmatter.description }}
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
              <span class="field-hint">Lowercase identifier used to invoke this agent (e.g., code-reviewer)</span>
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
              <span class="field-hint">Opus is most capable, Sonnet balances speed and quality, Haiku is fastest</span>
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
              <span class="field-hint">Visual tag to help you tell agents apart at a glance</span>
            </div>
            <div class="field-group">
              <label class="field-label">Memory</label>
              <div class="pill-picker">
                <button
                  type="button"
                  class="pill-picker__option"
                  :class="{ 'pill-picker__option--active': !frontmatter.memory }"
                  @click="frontmatter.memory = undefined"
                  title="Agent does not remember between conversations"
                >no memory</button>
                <button
                  type="button"
                  class="pill-picker__option"
                  :class="{ 'pill-picker__option--active': frontmatter.memory === 'user' }"
                  @click="frontmatter.memory = 'user'"
                  title="Agent remembers preferences for each individual user"
                >per person</button>
                <button
                  type="button"
                  class="pill-picker__option"
                  :class="{ 'pill-picker__option--active': frontmatter.memory === 'project' }"
                  @click="frontmatter.memory = 'project'"
                  title="Agent remembers context specific to this project"
                >per project</button>
              </div>
              <span class="field-hint">Should this agent remember things between conversations?</span>
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
            <HelpTip
              title="What are skills?"
              body="Skills give your agent specialized capabilities — like knowing how to review code or write tests."
            />
          </h3>
          <span class="font-mono text-[10px] text-meta">{{ agentSkills.length }}</span>
        </div>

        <div class="divide-y" style="divide-color: var(--border-subtle);">
          <NuxtLink
            v-for="skill in agentSkills"
            :key="skill.slug + skill.source"
            :to="skill.source === 'standalone' ? `/skills/${skill.slug}` : `/plugins/${encodeURIComponent(skill.pluginId!)}`"
            class="flex items-center gap-3 px-4 py-2.5 group hover-bg"
          >
            <UIcon name="i-lucide-sparkles" class="size-3.5 shrink-0" style="color: var(--accent);" />

            <span class="font-mono text-[13px] font-medium w-40 shrink-0 truncate">
              {{ skill.frontmatter.name }}
            </span>

            <!-- Context badge -->
            <span
              v-if="skill.frontmatter.context"
              class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 badge badge-subtle"
            >
              {{ skill.frontmatter.context }}
            </span>

            <!-- Source badge -->
            <span
              class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 badge"
              :class="skill.source === 'plugin' ? 'badge-agent' : 'badge-accent'"
            >
              {{ skill.source === 'plugin' ? skill.pluginName : 'standalone' }}
            </span>

            <!-- Description -->
            <span class="flex-1 text-[12px] truncate text-label">
              {{ skill.frontmatter.description }}
            </span>

            <div class="flex items-center gap-2 shrink-0">
              <UIcon
                name="i-lucide-chevron-right"
                class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-meta"
              />
            </div>
          </NuxtLink>
        </div>
      </div>

      <!-- Skills empty state -->
      <ExampleBlock v-if="!agentSkills.length" title="What does a skill look like?" class="max-w-md">
        <div class="space-y-2 text-[11px]" style="color: var(--text-secondary);">
          <p><strong style="color: var(--text-primary);">test-driven-development</strong> — A skill that teaches an agent to write tests before implementation.</p>
          <p class="text-[10px]" style="color: var(--text-tertiary);">Skills give your agent specialized knowledge. They appear here when linked to this agent.</p>
        </div>
      </ExampleBlock>

      <!-- Quality Score -->
      <details v-if="quality.issues.length" class="group">
        <summary
          class="flex items-center gap-2.5 cursor-pointer list-none px-1 py-1"
        >
          <div
            class="size-5 rounded-full flex items-center justify-center text-[9px] font-bold"
            :style="{ background: quality.color + '18', color: quality.color }"
          >
            {{ quality.score }}
          </div>
          <span class="text-[12px] font-medium" :style="{ color: quality.color }">
            {{ quality.label }}
          </span>
          <span class="text-[11px] text-meta">
            — {{ quality.issues.length }} suggestion{{ quality.issues.length === 1 ? '' : 's' }}
          </span>
        </summary>
        <div class="mt-2 space-y-1.5 pl-7">
          <div
            v-for="(issue, idx) in quality.issues"
            :key="idx"
            class="flex items-start gap-2 text-[12px] leading-relaxed"
          >
            <UIcon
              :name="issue.type === 'error' ? 'i-lucide-circle-x' : issue.type === 'warning' ? 'i-lucide-alert-triangle' : 'i-lucide-lightbulb'"
              class="size-3.5 shrink-0 mt-0.5"
              :style="{ color: issue.type === 'error' ? 'var(--error)' : issue.type === 'warning' ? 'var(--warning, #eab308)' : 'var(--text-disabled)' }"
            />
            <span class="text-label">{{ issue.message }}</span>
          </div>
        </div>
      </details>

      <!-- Instructions Editor -->
      <div
        class="rounded-xl overflow-hidden"
        style="border: 1px solid var(--border-subtle);"
      >
        <div class="flex items-center justify-between px-4 py-2.5" style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);">
          <h3 class="text-section-label flex items-center gap-2">
            Instructions
            <HelpTip
              title="What are actions?"
              body="Actions are reusable workflows (like slash commands) that this agent can perform."
            />
          </h3>
          <div class="flex items-center gap-3">
            <span class="font-mono text-[10px] text-meta">
              {{ lineCount }} lines
            </span>
            <span class="font-mono text-[10px] text-meta">
              {{ charCount.toLocaleString() }} chars
            </span>
          </div>
        </div>
        <textarea
          v-model="body"
          class="editor-textarea"
          style="min-height: 500px;"
          spellcheck="false"
          placeholder="Tell this agent how it should behave..."
        />
      </div>

      <!-- Version history (collapsed) -->
      <details v-if="versions.length" class="group">
        <summary class="text-[10px] cursor-pointer list-none flex items-center gap-1.5 text-meta">
          <UIcon name="i-lucide-history" class="size-3" />
          Version history ({{ versions.length }})
        </summary>
        <div class="mt-2 space-y-1 pl-4.5">
          <button
            v-for="(ver, idx) in versions.slice(0, 10)"
            :key="ver.timestamp"
            class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover-bg text-[11px]"
            @click="() => { frontmatter = { ...(ver.frontmatter as any) }; body = ver.body; toast.add({ title: 'Restored version', color: 'success' }) }"
          >
            <span class="font-mono text-meta shrink-0">{{ formatTime(ver.timestamp) }}</span>
            <span v-if="idx < versions.length - 1" class="text-meta">
              <span v-if="simpleDiff(versions[idx + 1]!.body, ver.body).added" class="text-green-500">+{{ simpleDiff(versions[idx + 1]!.body, ver.body).added }}</span>
              <span v-if="simpleDiff(versions[idx + 1]!.body, ver.body).removed" class="text-red-400 ml-1">-{{ simpleDiff(versions[idx + 1]!.body, ver.body).removed }}</span>
            </span>
            <span class="ml-auto text-meta">click to restore</span>
          </button>
        </div>
      </details>

      <!-- File location (collapsed by default) -->
      <details class="group">
        <summary class="text-[10px] cursor-pointer list-none flex items-center gap-1.5 text-meta">
          <UIcon name="i-lucide-file" class="size-3" />
          Show file location
        </summary>
        <div class="mt-1 font-mono text-[10px] pl-4.5 text-meta">
          {{ agent.filePath }}
        </div>
      </details>
    </div>

    <div v-else class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
    </div>

    <!-- Delete confirmation -->
    <UModal v-model:open="showDeleteConfirm">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay">
          <h3 class="text-page-title">Delete Agent</h3>
          <p class="text-[13px] text-body">
            Permanently delete <strong>{{ agent?.frontmatter.name }}</strong>? This action cannot be undone.
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
