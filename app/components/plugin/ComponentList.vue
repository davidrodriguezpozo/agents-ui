<script setup lang="ts">
import { renderMarkdown } from '~/utils/markdown'

/**
 * Collapsible list of plugin components (commands, agents, …). Each row expands
 * to show the full markdown body, so nothing a plugin ships is hidden.
 */
interface ComponentItem {
  key: string
  title: string
  subtitle?: string
  description: string
  badges?: { label: string; tone?: 'accent' | 'subtle' | 'agent' }[]
  body?: string
  filePath?: string
}

const props = defineProps<{
  items: ComponentItem[]
  emptyLabel: string
  emptyIcon?: string
}>()

const expanded = ref<string | null>(null)

function toggle(key: string) {
  expanded.value = expanded.value === key ? null : key
}

const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.items
  return props.items.filter(item =>
    item.title.toLowerCase().includes(q)
    || item.description.toLowerCase().includes(q)
    || (item.subtitle || '').toLowerCase().includes(q)
  )
})
</script>

<template>
  <div v-if="!items.length" class="flex flex-col items-center justify-center py-12 space-y-3">
    <UIcon :name="emptyIcon || 'i-lucide-inbox'" class="size-8 text-meta" />
    <p class="type-body">{{ emptyLabel }}</p>
  </div>

  <div v-else class="space-y-2">
    <input
      v-if="items.length > 6"
      v-model="search"
      class="field-search mb-3"
      placeholder="Filter…"
    />

    <div
      v-for="item in filtered"
      :key="item.key"
      class="rounded-lg overflow-hidden"
      style="border: 1px solid var(--border-subtle);"
    >
      <button
        class="w-full flex items-center gap-3 px-4 py-3 text-left hover-bg"
        :style="{ background: expanded === item.key ? 'var(--surface-raised)' : undefined }"
        @click="toggle(item.key)"
      >
        <UIcon
          :name="expanded === item.key ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-3.5 shrink-0 text-meta"
        />
        <span class="font-mono text-[12px] font-medium shrink-0 max-w-[220px] truncate" style="color: var(--accent);">
          {{ item.title }}
        </span>
        <span
          v-for="badge in item.badges"
          :key="badge.label"
          class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 badge"
          :class="badge.tone === 'agent' ? 'badge-agent' : 'badge-subtle'"
        >
          {{ badge.label }}
        </span>
        <span class="flex-1 text-[12px] truncate text-label">
          {{ item.description || '—' }}
        </span>
      </button>

      <div v-if="expanded === item.key" style="border-top: 1px solid var(--border-subtle);">
        <div v-if="item.subtitle" class="px-4 py-2 font-mono type-meta" style="background: var(--surface-base);">
          {{ item.subtitle }}
        </div>
        <div
          v-if="item.body"
          class="px-5 py-4 component-prose text-[13px] leading-[1.7] overflow-x-auto"
          style="background: var(--surface-base); color: var(--text-primary); font-family: var(--font-sans);"
          v-html="renderMarkdown(item.body)"
        />
        <div
          v-if="item.filePath"
          class="px-4 py-2 font-mono text-[10px] truncate text-meta"
          style="border-top: 1px solid var(--border-subtle);"
        >
          {{ item.filePath }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.component-prose :deep(p) { margin: 0.4em 0; }
.component-prose :deep(p:first-child) { margin-top: 0; }
.component-prose :deep(h1),
.component-prose :deep(h2),
.component-prose :deep(h3) { font-weight: 600; margin: 1em 0 0.4em; font-family: var(--font-display); }
.component-prose :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--badge-subtle-bg);
  padding: 0.15em 0.4em;
  border-radius: 4px;
}
.component-prose :deep(pre) {
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 0.75em 1em;
  overflow-x: auto;
  margin: 0.6em 0;
}
.component-prose :deep(pre code) { background: none; padding: 0; font-size: 0.85em; }
.component-prose :deep(ul), .component-prose :deep(ol) { padding-left: 1.5em; margin: 0.4em 0; }
.component-prose :deep(li) { margin: 0.2em 0; }
.component-prose :deep(a) { color: var(--accent); text-decoration: underline; }
</style>
