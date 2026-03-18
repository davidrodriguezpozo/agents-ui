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
    class="block rounded-xl p-4 transition-all duration-200 focus-ring group relative overflow-hidden"
    style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
    @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'; ($event.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; ($event.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px var(--card-shadow)'"
    @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'; ($event.currentTarget as HTMLElement).style.transform = ''; ($event.currentTarget as HTMLElement).style.boxShadow = ''"
  >
    <!-- Color accent bar -->
    <div
      class="absolute inset-x-0 top-0 h-[4px]"
      :style="{ background: getAgentColor(agent.frontmatter.color) }"
    />

    <!-- Hover glow -->
    <div
      class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
      :style="{ background: 'radial-gradient(ellipse at top, ' + getAgentColor(agent.frontmatter.color) + '08 0%, transparent 60%)' }"
    />

    <div class="flex items-start gap-3 relative">
      <div
        class="size-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-transform duration-200 group-hover:scale-105"
        :style="{ background: getAgentColor(agent.frontmatter.color) + '18', border: '1px solid ' + getAgentColor(agent.frontmatter.color) + '25' }"
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
    <div class="flex items-center gap-2 mt-3 pt-3 relative" style="border-top: 1px solid var(--border-subtle);">
      <span class="text-[10px] px-1.5 py-0.5 rounded-full" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">
        {{ getFriendlyModelName(agent.frontmatter.model) }}
      </span>
      <span v-if="agent.hasMemory" class="text-[10px] px-1.5 py-0.5 rounded-full" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">
        Has memory
      </span>
    </div>
  </NuxtLink>
</template>
