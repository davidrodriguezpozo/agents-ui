<script setup lang="ts">
import type { ToolCallRecord } from '~/types'
import type { ToolInvocation } from '~/composables/useStudioChat'

defineProps<{
  toolCalls: readonly ToolCallRecord[]
  isStreaming: boolean
}>()

const { invocations, lastRun, tokenUsage, costUsd, effectiveConfig } = useStudioChat()

const isExpanded = ref(false)
const openInvocation = ref<string | null>(null)

function toggleInvocation(id: string) {
  openInvocation.value = openInvocation.value === id ? null : id
}

/** Tool inputs are arbitrary JSON; show the interesting bit on one line. */
function summarizeInput(input: unknown): string {
  if (typeof input === 'string') return input
  if (!input || typeof input !== 'object') return ''

  const record = input as Record<string, unknown>
  for (const key of ['file_path', 'path', 'pattern', 'command', 'url', 'query', 'prompt', 'description']) {
    if (typeof record[key] === 'string') return record[key] as string
  }
  return JSON.stringify(record)
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function duration(invocation: ToolInvocation): string {
  if (!invocation.completedAt) return '…'
  return `${((invocation.completedAt - invocation.startedAt) / 1000).toFixed(1)}s`
}

const totalTokens = computed(() =>
  tokenUsage.value.input + tokenUsage.value.output + tokenUsage.value.cacheRead + tokenUsage.value.cacheCreation
)

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const costLabel = computed(() => {
  if (!costUsd.value) return null
  return costUsd.value < 0.01 ? '<$0.01' : `$${costUsd.value.toFixed(2)}`
})
</script>

<template>
  <div class="border-t transition-all" style="border-color: var(--border-subtle); background: var(--surface-base);">
    <button class="w-full flex items-center gap-2 px-4 py-2 text-left hover-bg transition-all" @click="isExpanded = !isExpanded">
      <UIcon :name="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3" style="color: var(--text-disabled);" />
      <span class="text-[11px] font-mono" style="color: var(--text-tertiary);">Execution Inspector</span>
      <span
        v-if="invocations.length || toolCalls.length"
        class="text-[9px] font-mono px-1.5 py-px rounded-full"
        style="background: var(--badge-subtle-bg); color: var(--text-disabled);"
      >
        {{ invocations.length || toolCalls.length }} tool{{ (invocations.length || toolCalls.length) !== 1 ? 's' : '' }}
      </span>

      <div class="ml-auto flex items-center gap-2 text-[9px] font-mono" style="color: var(--text-disabled);">
        <span v-if="totalTokens">{{ compact(totalTokens) }} tok</span>
        <span v-if="costLabel">{{ costLabel }}</span>
        <div v-if="isStreaming" class="size-1.5 rounded-full bg-amber-400 animate-pulse" />
      </div>
    </button>

    <div v-if="isExpanded" class="px-4 pb-3 space-y-2 max-h-[280px] overflow-y-auto">
      <!-- What the run actually used -->
      <div
        v-if="effectiveConfig"
        class="rounded-md px-3 py-2 space-y-1 text-[10px] font-mono"
        style="background: var(--surface-raised); border: 1px solid var(--border-subtle); color: var(--text-disabled);"
      >
        <div class="flex gap-2">
          <span class="w-16 shrink-0">model</span>
          <span style="color: var(--text-secondary);">{{ effectiveConfig.model }}</span>
        </div>
        <div class="flex gap-2">
          <span class="w-16 shrink-0">tools</span>
          <span style="color: var(--text-secondary);">
            {{ Array.isArray(effectiveConfig.allowedTools) ? effectiveConfig.allowedTools.join(', ') : 'all' }}
          </span>
        </div>
        <div class="flex gap-2">
          <span class="w-16 shrink-0">perms</span>
          <span style="color: var(--text-secondary);">{{ effectiveConfig.permissionMode }}</span>
        </div>
        <div class="flex gap-2">
          <span class="w-16 shrink-0">cwd</span>
          <span class="truncate" style="color: var(--text-secondary);">{{ effectiveConfig.cwd }}</span>
        </div>
        <div v-if="effectiveConfig.pluginName" class="flex gap-2">
          <span class="w-16 shrink-0">plugin</span>
          <span style="color: var(--text-secondary);">{{ effectiveConfig.pluginName }}</span>
        </div>
      </div>

      <div v-if="!invocations.length" class="text-[11px] font-mono py-2" style="color: var(--text-disabled);">
        No tool calls yet. Start a conversation to see execution details.
      </div>

      <!-- Tool calls with their inputs and results -->
      <div
        v-for="invocation in invocations"
        :key="invocation.id"
        class="rounded-md overflow-hidden"
        style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
      >
        <button
          class="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono text-left hover-bg"
          @click="toggleInvocation(invocation.id)"
        >
          <UIcon
            :name="invocation.isError ? 'i-lucide-circle-alert' : 'i-lucide-wrench'"
            class="size-3 shrink-0"
            :style="{ color: invocation.isError ? 'var(--error)' : 'var(--text-disabled)' }"
          />
          <span class="shrink-0" style="color: var(--text-secondary);">{{ invocation.toolName }}</span>
          <span class="flex-1 truncate" style="color: var(--text-disabled);">{{ summarizeInput(invocation.input) }}</span>
          <span class="shrink-0" style="color: var(--text-disabled);">{{ duration(invocation) }}</span>
        </button>

        <div v-if="openInvocation === invocation.id" class="px-3 pb-2 space-y-2" style="border-top: 1px solid var(--border-subtle);">
          <div>
            <div class="text-[9px] uppercase tracking-wider mt-2 mb-1" style="color: var(--text-disabled);">Input</div>
            <pre class="text-[10px] font-mono overflow-x-auto p-2 rounded" style="background: var(--surface-base); color: var(--text-secondary);">{{ formatJson(invocation.input) }}</pre>
          </div>
          <div v-if="invocation.result">
            <div class="text-[9px] uppercase tracking-wider mb-1" style="color: var(--text-disabled);">Result</div>
            <pre class="text-[10px] font-mono overflow-x-auto p-2 rounded whitespace-pre-wrap" style="background: var(--surface-base); color: var(--text-secondary);">{{ invocation.result }}</pre>
          </div>
        </div>
      </div>

      <!-- Run totals -->
      <div
        v-if="lastRun"
        class="rounded-md px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono"
        style="background: var(--surface-raised); border: 1px solid var(--border-subtle); color: var(--text-disabled);"
      >
        <span>{{ lastRun.numTurns }} turns</span>
        <span>{{ (lastRun.durationMs / 1000).toFixed(1) }}s</span>
        <span>in {{ compact(tokenUsage.input) }}</span>
        <span>out {{ compact(tokenUsage.output) }}</span>
        <span v-if="tokenUsage.cacheRead">cache {{ compact(tokenUsage.cacheRead) }}</span>
        <span v-if="costLabel">{{ costLabel }}</span>
        <span v-if="lastRun.permissionDenials.length" style="color: var(--warning);">
          {{ lastRun.permissionDenials.length }} denied
        </span>
      </div>
    </div>
  </div>
</template>
