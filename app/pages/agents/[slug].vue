<script setup lang="ts">
import type { AgentFrontmatter, AgentSkill } from '~/types'

const route = useRoute()
const router = useRouter()
const slug = route.params.slug as string

const { fetchOne, remove } = useAgents()
const { clearChat: clearStudioChat, toolCalls, isStreaming: studioStreaming } = useStudioChat()

const frontmatter = ref<AgentFrontmatter>({ name: '', description: '' })
const body = ref('')
const savedBody = ref('')
const savedFrontmatter = ref<AgentFrontmatter>({ name: '', description: '' })
const loading = ref(true)
const saving = ref(false)
const lastModified = ref<number | null>(null)
const skills = ref<AgentSkill[]>([])
const loadingSkills = ref(false)

const isDirty = computed(() => {
  return body.value !== savedBody.value ||
    JSON.stringify(frontmatter.value) !== JSON.stringify(savedFrontmatter.value)
})

const isDraft = computed(() => body.value !== savedBody.value)

async function loadAgent() {
  loading.value = true
  try {
    const agent = await fetchOne(slug) as unknown as Record<string, unknown>
    const fm = agent.frontmatter as AgentFrontmatter
    frontmatter.value = { ...fm }
    savedFrontmatter.value = { ...fm }
    body.value = agent.body as string
    savedBody.value = agent.body as string
    lastModified.value = (agent.lastModified as number) || null
  } catch {
    router.push('/agents')
  } finally {
    loading.value = false
  }
}

async function loadSkills() {
  loadingSkills.value = true
  try {
    skills.value = await $fetch<AgentSkill[]>(`/api/agents/${slug}/skills`)
  } catch {
    skills.value = []
  } finally {
    loadingSkills.value = false
  }
}

onMounted(() => {
  loadAgent()
  loadSkills()
  clearStudioChat()
})

async function save() {
  saving.value = true
  try {
    const result = await $fetch<{ slug: string; lastModified?: number }>(`/api/agents/${slug}`, {
      method: 'PUT',
      body: {
        frontmatter: frontmatter.value,
        body: body.value,
        ...(lastModified.value ? { lastModified: lastModified.value } : {}),
      },
    })

    savedFrontmatter.value = { ...frontmatter.value }
    savedBody.value = body.value
    lastModified.value = result.lastModified || null

    if (result.slug !== slug) {
      router.push(`/agents/${result.slug}`)
    }
  } catch (e: unknown) {
    console.error('Failed to save:', e)
  } finally {
    saving.value = false
  }
}

const showDeleteConfirm = ref(false)
async function handleDelete() {
  await remove(slug)
  router.push('/agents')
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    if (isDirty.value && !saving.value) save()
  }
}
onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))

useUnsavedChanges(isDirty)
</script>

<template>
  <div class="h-[calc(100vh-4rem)] flex flex-col">
    <!-- Top bar -->
    <div class="shrink-0 flex items-center justify-between px-6 py-3 border-b" style="border-color: var(--border-subtle);">
      <div class="flex items-center gap-3">
        <NuxtLink to="/agents" class="p-1 rounded-md hover-bg" style="color: var(--text-tertiary);">
          <UIcon name="i-lucide-arrow-left" class="size-4" />
        </NuxtLink>
        <div class="size-3 rounded-full" :style="{ background: frontmatter.color || 'var(--accent)' }" />
        <h1 class="text-[16px] font-semibold tracking-tight" style="color: var(--text-primary); font-family: var(--font-display);">
          {{ frontmatter.name || 'Agent' }}
        </h1>
        <span v-if="isDirty" class="text-[9px] font-mono px-1.5 py-px rounded-full" style="background: rgba(229, 169, 62, 0.1); color: var(--accent);">Unsaved</span>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
          :style="{
            background: isDirty ? 'var(--accent)' : 'var(--surface-raised)',
            color: isDirty ? 'white' : 'var(--text-disabled)',
            border: isDirty ? 'none' : '1px solid var(--border-subtle)',
          }"
          :disabled="!isDirty || saving"
          @click="save"
        >
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
        <button class="p-1.5 rounded-lg hover-bg transition-all" style="color: var(--text-disabled);" title="Delete agent" @click="showDeleteConfirm = true">
          <UIcon name="i-lucide-trash-2" class="size-4" />
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" style="color: var(--text-disabled);" />
    </div>

    <!-- Studio panels -->
    <div v-else class="flex-1 flex min-h-0">
      <!-- Left: Editor -->
      <div class="w-[60%] flex flex-col border-r" style="border-color: var(--border-subtle);">
        <EditorPanel
          :frontmatter="frontmatter"
          :body="body"
          :skills="skills"
          :loading-skills="loadingSkills"
          @update:frontmatter="frontmatter = $event"
          @update:body="body = $event"
        />
      </div>

      <!-- Right: Test + Inspector -->
      <div class="w-[40%] flex flex-col">
        <div class="flex-1 min-h-0">
          <TestPanel :agent-slug="slug" :agent-name="frontmatter.name" :is-draft="isDraft" />
        </div>
        <ExecutionInspector :tool-calls="toolCalls" :is-streaming="studioStreaming" />
      </div>
    </div>

    <!-- Delete confirmation -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center" style="background: rgba(0,0,0,0.4);">
        <div class="rounded-2xl p-6 max-w-sm w-full mx-4 space-y-4" style="background: var(--surface-raised); border: 1px solid var(--border-subtle);">
          <h3 class="text-[15px] font-semibold" style="color: var(--text-primary);">Delete {{ frontmatter.name }}?</h3>
          <p class="text-[13px]" style="color: var(--text-secondary);">This will permanently delete this agent and cannot be undone.</p>
          <div class="flex gap-2 justify-end">
            <button class="px-3 py-1.5 rounded-lg text-[12px] font-medium hover-bg" style="color: var(--text-tertiary);" @click="showDeleteConfirm = false">Cancel</button>
            <button class="px-3 py-1.5 rounded-lg text-[12px] font-medium" style="background: var(--error); color: white;" @click="handleDelete">Delete</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
