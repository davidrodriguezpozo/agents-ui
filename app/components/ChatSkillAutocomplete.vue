<script setup lang="ts">
import type { Skill, Command } from '~/types'

const props = defineProps<{
  query: string
  skills: Skill[]
  commands: Command[]
  visible: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  select: [value: string]
}>()

interface AutocompleteItem {
  id: string
  label: string
  description: string
  agent: string | null
  type: 'skill' | 'command'
  value: string
}

const selectedIndex = ref(0)

const items = computed<AutocompleteItem[]>(() => {
  const results: AutocompleteItem[] = []

  for (const skill of props.skills) {
    const agent = skill.frontmatter.agent || null
    results.push({
      id: `skill-${skill.slug}`,
      label: skill.frontmatter.name || skill.slug,
      description: skill.frontmatter.description || '',
      agent,
      type: 'skill',
      value: agent ? `${agent}:${skill.slug}` : skill.slug,
    })
  }

  for (const cmd of props.commands) {
    results.push({
      id: `cmd-${cmd.slug}`,
      label: cmd.frontmatter.name || cmd.slug,
      description: cmd.frontmatter.description || '',
      agent: null,
      type: 'command',
      value: cmd.slug,
    })
  }

  return results
})

const filtered = computed(() => {
  const q = props.query.toLowerCase()
  if (!q) return items.value.slice(0, 20)
  return items.value
    .filter(item =>
      item.label.toLowerCase().includes(q)
      || item.value.toLowerCase().includes(q)
      || (item.agent?.toLowerCase().includes(q) ?? false)
    )
    .slice(0, 20)
})

const grouped = computed(() => {
  const groups: { label: string; items: AutocompleteItem[] }[] = []
  const agentMap = new Map<string, AutocompleteItem[]>()
  const general: AutocompleteItem[] = []

  for (const item of filtered.value) {
    if (item.agent) {
      if (!agentMap.has(item.agent)) agentMap.set(item.agent, [])
      agentMap.get(item.agent)!.push(item)
    } else {
      general.push(item)
    }
  }

  for (const [agent, agentItems] of agentMap) {
    groups.push({ label: agent, items: agentItems })
  }
  if (general.length) {
    groups.push({ label: 'General', items: general })
  }

  return groups
})

// Flat list matching the visual render order (grouped)
const flatFiltered = computed(() => grouped.value.flatMap(g => g.items))

watch(() => props.query, () => { selectedIndex.value = 0 })

function moveUp() {
  if (selectedIndex.value > 0) selectedIndex.value--
}

function moveDown() {
  if (selectedIndex.value < flatFiltered.value.length - 1) selectedIndex.value++
}

function selectCurrent() {
  const item = flatFiltered.value[selectedIndex.value]
  if (item) emit('select', item.value)
}

function selectItem(value: string) {
  emit('select', value)
}

defineExpose({ moveUp, moveDown, selectCurrent })
</script>

<template>
  <div
    v-if="visible && (filtered.length > 0 || loading)"
    class="absolute bottom-full left-0 right-0 mb-2 rounded-lg overflow-hidden"
    style="
      background: var(--surface-raised);
      border: 1px solid var(--border-subtle);
      box-shadow: 0 -4px 16px var(--card-shadow);
      max-height: 200px;
      overflow-y: auto;
    "
  >
    <div
      v-if="loading && filtered.length === 0"
      class="px-3 py-3 fs-mono font-mono"
      style="color: var(--text-disabled);"
    >
      Loading...
    </div>

    <template v-for="group in grouped" :key="group.label">
      <div
        class="px-3 py-1.5 fs-micro font-mono uppercase tracking-wider sticky top-0"
        style="color: var(--text-disabled); background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);"
      >
        {{ group.label }}
      </div>
      <button
        v-for="item in group.items"
        :key="item.id"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors duration-75"
        :style="{
          background: flatFiltered[selectedIndex]?.id === item.id ? 'var(--surface-hover)' : 'transparent',
        }"
        @click="selectItem(item.value)"
        @mouseenter="selectedIndex = flatFiltered.findIndex(f => f.id === item.id)"
      >
        <UIcon
          :name="item.type === 'skill' ? 'i-lucide-sparkles' : 'i-lucide-terminal'"
          class="size-3.5 shrink-0"
          style="color: var(--text-disabled);"
        />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="fs-sm font-medium truncate" style="color: var(--text-primary); font-family: var(--font-sans);">
              {{ item.label }}
            </span>
            <span
              v-if="item.agent"
              class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0"
              style="background: var(--badge-subtle-bg); color: var(--text-tertiary);"
            >
              {{ item.agent }}
            </span>
          </div>
          <span
            v-if="item.description"
            class="fs-mono truncate block"
            style="color: var(--text-tertiary);"
          >
            {{ item.description }}
          </span>
        </div>
        <span class="fs-micro font-mono shrink-0 ink-4">
          /{{ item.value }}
        </span>
      </button>
    </template>
  </div>
</template>
