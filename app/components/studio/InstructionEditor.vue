<script setup lang="ts">
import { renderMarkdown } from '~/utils/markdown'

const props = defineProps<{
  modelValue: string
  agentName: string
  agentDescription: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const mode = ref<'edit' | 'preview'>('edit')
const isImproving = ref(false)
const improveError = ref<string | null>(null)
const suggestion = ref<string | null>(null)

const wordCount = computed(() => {
  const text = props.modelValue.trim()
  return text ? text.split(/\s+/).length : 0
})

// NOTE: The spec defines per-suggestion diff UI (original vs suggested).
// This initial implementation shows the full improved text as accept/dismiss.
// Per-suggestion granularity is deferred to a follow-up iteration.

async function improveInstructions() {
  isImproving.value = true
  improveError.value = null
  suggestion.value = null

  try {
    const response = await $fetch<{ suggestions: unknown[]; improvedInstructions: string }>('/api/agents/improve-instructions', {
      method: 'POST',
      body: {
        name: props.agentName,
        description: props.agentDescription,
        currentInstructions: props.modelValue,
      },
      timeout: 30000,
    })
    suggestion.value = response.improvedInstructions
  } catch (e: unknown) {
    improveError.value = e instanceof Error ? e.message : 'Failed to improve instructions'
  } finally {
    isImproving.value = false
  }
}

function acceptSuggestion() {
  if (suggestion.value) {
    emit('update:modelValue', suggestion.value)
    suggestion.value = null
  }
}

function dismissSuggestion() {
  suggestion.value = null
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center justify-between px-4 py-2 border-b" style="border-color: var(--border-subtle);">
      <div class="flex items-center gap-2">
        <div class="flex rounded-lg overflow-hidden" style="border: 1px solid var(--border-subtle);">
          <button
            v-for="m in (['edit', 'preview'] as const)"
            :key="m"
            class="px-2.5 py-1 text-[11px] font-medium capitalize transition-all"
            :style="{
              background: mode === m ? 'var(--accent-muted)' : 'transparent',
              color: mode === m ? 'var(--accent)' : 'var(--text-disabled)',
            }"
            @click="mode = m"
          >
            {{ m }}
          </button>
        </div>
        <span class="text-[11px] font-mono" style="color: var(--text-disabled);">{{ wordCount }} words</span>
      </div>
      <button
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
        :style="{
          background: isImproving ? 'var(--accent-muted)' : 'var(--surface-raised)',
          border: '1px solid ' + (isImproving ? 'rgba(229, 169, 62, 0.2)' : 'var(--border-subtle)'),
          color: isImproving ? 'var(--accent)' : 'var(--text-secondary)',
        }"
        :disabled="isImproving"
        @click="improveInstructions"
      >
        <UIcon :name="isImproving ? 'i-lucide-loader-2' : 'i-lucide-wand-2'" class="size-3" :class="{ 'animate-spin': isImproving }" />
        {{ isImproving ? 'Improving...' : 'Improve with Claude' }}
      </button>
    </div>

    <div
      v-if="suggestion"
      class="mx-4 mt-3 rounded-xl p-3 space-y-2"
      style="background: var(--accent-muted); border: 1px solid rgba(229, 169, 62, 0.15);"
    >
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-sparkles" class="size-3.5" style="color: var(--accent);" />
        <span class="text-[12px] font-medium" style="color: var(--text-primary);">Suggested improvement</span>
      </div>
      <pre class="text-[12px] leading-relaxed whitespace-pre-wrap max-h-[150px] overflow-y-auto" style="color: var(--text-secondary); font-family: var(--font-mono);">{{ suggestion }}</pre>
      <div class="flex gap-2">
        <button class="px-3 py-1 rounded-lg text-[11px] font-medium transition-all" style="background: var(--accent); color: white;" @click="acceptSuggestion">Accept</button>
        <button class="px-3 py-1 rounded-lg text-[11px] font-medium transition-all hover-bg" style="color: var(--text-tertiary);" @click="dismissSuggestion">Dismiss</button>
      </div>
    </div>

    <div v-if="improveError" class="mx-4 mt-2 text-[11px] rounded-lg px-3 py-2" style="background: rgba(248, 113, 113, 0.06); color: var(--error);">{{ improveError }}</div>

    <!-- Edit mode -->
    <textarea
      v-if="mode === 'edit'"
      :value="modelValue"
      class="flex-1 w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none p-4"
      style="color: var(--text-primary); font-family: var(--font-mono);"
      placeholder="Write instructions for your agent..."
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />

    <!-- Preview mode -->
    <div
      v-else
      class="flex-1 overflow-y-auto p-4 instruction-preview"
      style="color: var(--text-primary); font-family: var(--font-sans);"
    >
      <div
        v-if="modelValue.trim()"
        class="text-[13px] leading-[1.7]"
        v-html="renderMarkdown(modelValue)"
      />
      <p v-else class="text-[13px]" style="color: var(--text-disabled);">Nothing to preview yet.</p>
    </div>
  </div>
</template>

<style scoped>
.instruction-preview :deep(h1) { font-size: 1.4em; font-weight: 700; margin: 0.8em 0 0.4em; color: var(--text-primary); font-family: var(--font-display); }
.instruction-preview :deep(h2) { font-size: 1.2em; font-weight: 600; margin: 0.7em 0 0.3em; color: var(--text-primary); font-family: var(--font-display); }
.instruction-preview :deep(h3) { font-size: 1.05em; font-weight: 600; margin: 0.6em 0 0.3em; color: var(--text-primary); }
.instruction-preview :deep(p) { margin: 0.5em 0; }
.instruction-preview :deep(ul), .instruction-preview :deep(ol) { padding-left: 1.5em; margin: 0.5em 0; }
.instruction-preview :deep(li) { margin: 0.25em 0; }
.instruction-preview :deep(code) { font-family: var(--font-mono); font-size: 0.9em; background: var(--badge-subtle-bg); padding: 0.15em 0.4em; border-radius: 4px; }
.instruction-preview :deep(pre) { background: var(--surface-base); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.75em 1em; overflow-x: auto; margin: 0.6em 0; }
.instruction-preview :deep(pre code) { background: none; padding: 0; font-size: 0.85em; }
.instruction-preview :deep(strong) { color: var(--text-primary); font-weight: 600; }
.instruction-preview :deep(blockquote) { border-left: 2px solid var(--accent); padding-left: 0.75em; margin: 0.5em 0; color: var(--text-secondary); }
.instruction-preview :deep(hr) { border: none; border-top: 1px solid var(--border-subtle); margin: 1em 0; }
.instruction-preview :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.instruction-preview :deep(table) { width: 100%; border-collapse: collapse; font-size: 0.9em; margin: 0.6em 0; }
.instruction-preview :deep(th), .instruction-preview :deep(td) { border: 1px solid var(--border-subtle); padding: 0.4em 0.6em; text-align: left; }
.instruction-preview :deep(th) { background: var(--surface-raised); font-weight: 600; }
</style>
