<script setup lang="ts">
import { getAgentColor, modelColors } from '~/utils/colors'

const router = useRouter()
const { agents } = useAgents()
const { commands } = useCommands()
const { plugins } = usePlugins()
const { skills } = useSkills()

const open = ref(false)
const query = ref('')
const selectedIndex = ref(0)

const results = computed(() => {
  const q = query.value.toLowerCase().trim()
  if (!q) return []

  const items: { type: string; label: string; sublabel: string; to: string; icon: string; color?: string; model?: string }[] = []

  for (const agent of agents.value) {
    if (agent.frontmatter.name.toLowerCase().includes(q) || agent.frontmatter.description?.toLowerCase().includes(q)) {
      items.push({
        type: 'Agent',
        label: agent.frontmatter.name,
        sublabel: agent.frontmatter.description || '',
        to: `/agents/${agent.slug}`,
        icon: 'i-lucide-cpu',
        color: getAgentColor(agent.frontmatter.color),
        model: agent.frontmatter.model,
      })
    }
  }

  for (const cmd of commands.value) {
    if (cmd.frontmatter.name.toLowerCase().includes(q) || cmd.frontmatter.description?.toLowerCase().includes(q)) {
      items.push({
        type: 'Command',
        label: `/${cmd.frontmatter.name}`,
        sublabel: cmd.frontmatter.description || '',
        to: `/commands/${cmd.slug}`,
        icon: 'i-lucide-terminal',
      })
    }
  }

  for (const skill of skills.value) {
    if (skill.frontmatter.name.toLowerCase().includes(q) || skill.frontmatter.description?.toLowerCase().includes(q)) {
      items.push({
        type: 'Skill',
        label: skill.frontmatter.name,
        sublabel: skill.frontmatter.description || '',
        to: `/skills/${skill.slug}`,
        icon: 'i-lucide-sparkles',
      })
    }
  }

  for (const plugin of plugins.value) {
    if (plugin.name.toLowerCase().includes(q) || plugin.description?.toLowerCase().includes(q)) {
      items.push({
        type: 'Plugin',
        label: plugin.name,
        sublabel: plugin.description || '',
        to: `/plugins/${encodeURIComponent(plugin.id)}`,
        icon: 'i-lucide-puzzle',
      })
    }
  }

  return items.slice(0, 10)
})

watch(query, () => { selectedIndex.value = 0 })

function navigate(to: string) {
  router.push(to)
  open.value = false
  query.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    const selected = results.value[selectedIndex.value]
    if (!selected) return
    e.preventDefault()
    navigate(selected.to)
  }
}

// Global Cmd+K
if (import.meta.client) {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      open.value = !open.value
      if (!open.value) query.value = ''
    }
  }
  onMounted(() => document.addEventListener('keydown', handler))
  onUnmounted(() => document.removeEventListener('keydown', handler))
}
</script>

<template>
  <UModal v-model:open="open">
    <template #content>
      <div style="min-height: 120px; max-height: 420px;" class="bg-overlay rounded-lg overflow-hidden flex flex-col">
        <!-- Search input -->
        <div class="flex items-center gap-3 px-4 py-3" style="border-bottom: 1px solid var(--border-subtle);">
          <UIcon name="i-lucide-search" class="size-4 shrink-0 text-meta" />
          <input
            v-model="query"
            class="flex-1 bg-transparent fs-base outline-none"
            placeholder="Search agents, commands, skills, plugins..."
            autofocus
            @keydown="onKeydown"
          />
          <kbd class="fs-micro font-mono px-1.5 py-0.5 rounded badge badge-subtle">ESC</kbd>
        </div>

        <!-- Results -->
        <div class="flex-1 overflow-auto py-1">
          <div v-if="query && !results.length" class="flex flex-col items-center justify-center py-8">
            <p class="type-body">No results found</p>
          </div>

          <div v-if="!query" class="flex flex-col items-center justify-center py-8">
            <p class="fs-sm text-meta">Type to search across all items</p>
          </div>

          <button
            v-for="(result, idx) in results"
            :key="result.to"
            class="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
            :style="{
              background: idx === selectedIndex ? 'var(--surface-hover)' : 'transparent',
            }"
            @mouseenter="selectedIndex = idx"
            @click="navigate(result.to)"
          >
            <div
              v-if="result.color"
              class="size-2 rounded-full shrink-0"
              :style="{ background: result.color }"
            />
            <UIcon v-else :name="result.icon" class="size-4 shrink-0 text-meta" />

            <span class="font-mono type-strong w-40 shrink-0 truncate">
              {{ result.label }}
            </span>

            <span
              v-if="result.model && modelColors[result.model]"
              class="fs-micro font-mono font-medium px-1 py-px rounded-full shrink-0"
              :class="[modelColors[result.model]?.bg, modelColors[result.model]?.text]"
            >
              {{ result.model }}
            </span>

            <span class="flex-1 fs-sm truncate text-label">
              {{ result.sublabel }}
            </span>

            <span class="fs-micro font-mono shrink-0 text-meta">
              {{ result.type }}
            </span>
          </button>
        </div>
      </div>
    </template>
  </UModal>
</template>
