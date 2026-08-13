<script setup lang="ts">
import type { Command } from '~/types'

/**
 * The commands you can actually run, without having to remember them.
 *
 * In the terminal you type `/` and hope you recall the name. Here the list is
 * on screen, says what each one does, and shows which plugin brought it —
 * which is the question people ask when they meet an unfamiliar command.
 */

const props = defineProps<{
  commands: Command[]
  /** What has been typed after the slash, if anything. */
  query: string
}>()

const emit = defineEmits<{ select: [invocation: string]; close: [] }>()

const selected = ref(0)

interface Entry {
  invocation: string
  description: string
  origin: string | null
}

const matches = computed<Entry[]>(() => {
  const needle = props.query.trim().toLowerCase()

  return props.commands
    .map(command => ({
      invocation: command.invocation || `/${command.slug}`,
      description: command.frontmatter?.description || '',
      // A plugin's name is the useful provenance; your own commands need none.
      origin: command.source === 'plugin' ? (command.pluginName ?? 'plugin') : null,
    }))
    .filter(entry => !needle
      || entry.invocation.toLowerCase().includes(needle)
      || entry.description.toLowerCase().includes(needle))
    .sort((a, b) => a.invocation.localeCompare(b.invocation))
})

// A filtered list whose selection stayed put would run the wrong thing.
watch(matches, () => { selected.value = 0 })

function move(delta: number) {
  if (!matches.value.length) return
  selected.value = (selected.value + delta + matches.value.length) % matches.value.length
}

function choose(index = selected.value) {
  const entry = matches.value[index]
  if (entry) emit('select', entry.invocation)
}

defineExpose({ move, choose, hasMatches: computed(() => matches.value.length > 0) })
</script>

<template>
  <div
    class="rounded-md overflow-hidden shadow-lg"
    style="background: var(--surface-overlay); border: 1px solid var(--border-subtle);"
  >
    <div
      class="px-3 py-1.5 flex items-center justify-between"
      style="border-bottom: 1px solid var(--border-subtle);"
    >
      <span class="text-section-label">Commands</span>
      <span class="type-meta">↑↓ to choose · ↵ to insert · esc to close</span>
    </div>

    <div v-if="matches.length" class="max-h-64 overflow-y-auto py-1">
      <button
        v-for="(entry, index) in matches"
        :key="entry.invocation"
        class="w-full flex items-start gap-2.5 px-3 py-1.5 text-left"
        :style="{ background: index === selected ? 'var(--accent-muted)' : undefined }"
        @mouseenter="selected = index"
        @click="choose(index)"
      >
        <span class="font-mono type-detail shrink-0 ink-accent">
          {{ entry.invocation }}
        </span>
        <span class="type-meta flex-1 min-w-0 truncate">{{ entry.description }}</span>
        <span
          v-if="entry.origin"
          class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0"
          style="background: var(--plugin-tint); color: var(--plugin);"
        >
          {{ entry.origin }}
        </span>
      </button>
    </div>

    <div v-else class="px-3 py-3 type-meta">
      Nothing matches “{{ query }}”.
    </div>
  </div>
</template>
