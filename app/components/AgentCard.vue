<script setup lang="ts">
import type { Agent } from '~/types'
import { getAgentColor } from '~/utils/colors'
import { getFriendlyModelName } from '~/utils/terminology'

defineProps<{
  agent: Agent
}>()
</script>

<template>
  <NuxtLink
    :to="`/agents/${agent.slug}`"
    class="block rounded-xl p-4 transition-all duration-150 focus-ring group"
    style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
    @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'"
    @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'"
  >
    <div class="flex items-start gap-3">
      <div
        class="size-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        :style="{ background: getAgentColor(agent.frontmatter.color) + '20', border: '1px solid ' + getAgentColor(agent.frontmatter.color) + '30' }"
      >
        <UIcon name="i-lucide-cpu" class="size-4" :style="{ color: getAgentColor(agent.frontmatter.color) }" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[13px] font-medium truncate" style="color: var(--text-primary);">
          {{ agent.frontmatter.name }}
        </div>
        <div class="text-[11px] mt-0.5 line-clamp-2" style="color: var(--text-tertiary);">
          {{ agent.frontmatter.description || 'No description' }}
        </div>
      </div>
    </div>
    <div class="flex items-center gap-2 mt-3 pt-3" style="border-top: 1px solid var(--border-subtle);">
      <span class="text-[10px] px-1.5 py-0.5 rounded-full" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">
        {{ getFriendlyModelName(agent.frontmatter.model) }}
      </span>
      <span v-if="agent.hasMemory" class="text-[10px] px-1.5 py-0.5 rounded-full" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">
        Has memory
      </span>
    </div>
  </NuxtLink>
</template>
