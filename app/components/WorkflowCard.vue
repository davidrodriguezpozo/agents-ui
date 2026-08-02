<script setup lang="ts">
import type { Workflow } from '~/types'
import { getAgentColor } from '~/utils/colors'

const props = defineProps<{ workflow: Workflow }>()
const { agents } = useAgents()

const stepAgents = computed(() => {
  return props.workflow.steps.map(s => agents.value.find(a => a.slug === s.agentSlug))
})

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
</script>

<template>
  <NuxtLink
    :to="`/workflows/${workflow.slug}`"
    class="block rounded-lg p-4 transition-all duration-150 focus-ring group"
    style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
    @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'"
    @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'"
  >
    <div class="flex items-start gap-3">
      <div
        class="size-8 rounded-md flex items-center justify-center shrink-0 mt-0.5"
        style="background: var(--accent-muted); border: 1px solid var(--accent-muted);"
      >
        <UIcon name="i-lucide-git-branch" class="size-4" style="color: var(--accent);" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="type-strong truncate" style="color: var(--text-primary);">{{ workflow.name }}</div>
        <div class="text-[11px] mt-0.5 line-clamp-2" style="color: var(--text-tertiary);">
          {{ workflow.description || 'No description' }}
        </div>
      </div>
    </div>
    <div class="flex items-center gap-2 mt-3 pt-3" style="border-top: 1px solid var(--border-subtle);">
      <div class="flex -space-x-1">
        <div
          v-for="(agent, idx) in stepAgents.slice(0, 4)"
          :key="idx"
          class="size-5 rounded-full flex items-center justify-center text-[8px] font-bold"
          :style="{ background: agent ? getAgentColor(agent.frontmatter.color) + '30' : 'var(--badge-subtle-bg)', color: agent ? getAgentColor(agent.frontmatter.color) : 'var(--text-disabled)', border: '2px solid var(--surface-raised)', zIndex: 10 - idx }"
        >
          {{ idx + 1 }}
        </div>
      </div>
      <span class="text-[10px]" style="color: var(--text-disabled);">{{ workflow.steps.length }} step{{ workflow.steps.length === 1 ? '' : 's' }}</span>
      <span v-if="workflow.lastRunAt" class="text-[10px] ml-auto" style="color: var(--text-disabled);">{{ timeAgo(workflow.lastRunAt) }}</span>
    </div>
  </NuxtLink>
</template>
