<script setup lang="ts">
import type { ConversationSummary } from '~/types'

const props = defineProps<{ agentSlug: string }>()

const { sessions, loading, fetchHistory, fetchSession, deleteSession } = useAgentHistory(props.agentSlug)
const { loadSession, conversationId } = useStudioChat()
const toast = useToast()

const open = ref(false)

watch(open, (isOpen) => {
  if (isOpen) fetchHistory()
})

/** Refresh the list whenever the live conversation is saved under a new id. */
watch(conversationId, () => {
  if (open.value) fetchHistory()
})

async function openSession(summary: ConversationSummary) {
  try {
    loadSession(await fetchSession(summary.id))
    open.value = false
  } catch {
    toast.add({ title: 'Could not open that conversation', color: 'error' })
  }
}

async function removeSession(summary: ConversationSummary, event: Event) {
  event.stopPropagation()
  try {
    await deleteSession(summary.id)
  } catch {
    toast.add({ title: 'Could not delete that conversation', color: 'error' })
  }
}

function relativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const seconds = Math.floor((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatCost(usd: number): string {
  if (!usd) return ''
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}
</script>

<template>
  <div class="border-b" style="border-color: var(--border-subtle);">
    <button
      class="w-full flex items-center gap-2 px-4 py-2 text-left hover-bg transition-all"
      @click="open = !open"
    >
      <UIcon
        :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        class="size-3"
        style="color: var(--text-disabled);"
      />
      <UIcon name="i-lucide-history" class="size-3" style="color: var(--text-disabled);" />
      <span class="text-[11px] font-mono" style="color: var(--text-tertiary);">History</span>
      <span
        v-if="sessions.length"
        class="text-[9px] font-mono px-1.5 py-px rounded-full"
        style="background: var(--badge-subtle-bg); color: var(--text-disabled);"
      >
        {{ sessions.length }}
      </span>
    </button>

    <div v-if="open" class="px-3 pb-3 space-y-1 max-h-[220px] overflow-y-auto">
      <div v-if="loading" class="text-[11px] font-mono py-2 px-1" style="color: var(--text-disabled);">
        Loading…
      </div>

      <div v-else-if="!sessions.length" class="text-[11px] py-2 px-1 leading-relaxed" style="color: var(--text-disabled);">
        No saved conversations yet. Runs are saved automatically once you send a message.
      </div>

      <button
        v-for="session in sessions"
        :key="session.id"
        class="w-full text-left px-3 py-2 rounded-lg transition-all group"
        :style="{
          background: session.id === conversationId ? 'var(--accent-muted)' : 'var(--surface-raised)',
          border: '1px solid ' + (session.id === conversationId ? 'rgba(229, 169, 62, 0.2)' : 'var(--border-subtle)'),
        }"
        @click="openSession(session)"
      >
        <div class="flex items-center gap-2">
          <span class="text-[11px] flex-1 truncate" style="color: var(--text-secondary);">
            {{ session.title }}
          </span>
          <span
            class="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover-bg"
            style="color: var(--text-disabled);"
            title="Delete conversation"
            @click="removeSession(session, $event)"
          >
            <UIcon name="i-lucide-trash-2" class="size-3" />
          </span>
        </div>
        <div class="flex items-center gap-2 mt-0.5 text-[9px] font-mono" style="color: var(--text-disabled);">
          <span>{{ relativeTime(session.updatedAt) }}</span>
          <span>·</span>
          <span>{{ session.messageCount }} msg</span>
          <template v-if="session.toolCallCount">
            <span>·</span>
            <span>{{ session.toolCallCount }} tools</span>
          </template>
          <template v-if="session.costUsd">
            <span>·</span>
            <span>{{ formatCost(session.costUsd) }}</span>
          </template>
        </div>
      </button>
    </div>
  </div>
</template>
