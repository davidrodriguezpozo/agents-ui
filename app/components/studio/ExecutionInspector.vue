<script setup lang="ts">
import type { ToolCallRecord } from '~/types'

defineProps<{
  toolCalls: readonly ToolCallRecord[]
  isStreaming: boolean
}>()

const isExpanded = ref(false)
</script>

<template>
  <div class="border-t transition-all" style="border-color: var(--border-subtle); background: var(--surface-base);">
    <button class="w-full flex items-center gap-2 px-4 py-2 text-left hover-bg transition-all" @click="isExpanded = !isExpanded">
      <UIcon :name="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3" style="color: var(--text-disabled);" />
      <span class="text-[11px] font-mono" style="color: var(--text-tertiary);">Execution Inspector</span>
      <span v-if="toolCalls.length" class="text-[9px] font-mono px-1.5 py-px rounded-full" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">
        {{ toolCalls.length }} tool{{ toolCalls.length !== 1 ? 's' : '' }}
      </span>
      <div v-if="isStreaming" class="ml-auto size-1.5 rounded-full bg-amber-400 animate-pulse" />
    </button>

    <div v-if="isExpanded" class="px-4 pb-3 space-y-1.5 max-h-[200px] overflow-y-auto">
      <div v-if="!toolCalls.length" class="text-[11px] font-mono py-2" style="color: var(--text-disabled);">
        No tool calls yet. Start a conversation to see execution details.
      </div>
      <div
        v-for="(call, idx) in toolCalls"
        :key="idx"
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-mono"
        style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
      >
        <UIcon name="i-lucide-wrench" class="size-3 shrink-0" style="color: var(--text-disabled);" />
        <span class="flex-1 truncate" style="color: var(--text-secondary);">{{ call.toolName }}</span>
        <span class="shrink-0" style="color: var(--text-disabled);">{{ call.elapsed.toFixed(1) }}s</span>
      </div>
    </div>
  </div>
</template>
