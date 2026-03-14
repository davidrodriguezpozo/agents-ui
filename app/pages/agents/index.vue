<script setup lang="ts">
import { getAgentColor, modelColors } from '~/utils/colors'

const { agents, loading } = useAgents()
const router = useRouter()

const showCreateModal = ref(false)
const searchQuery = ref('')
const skillCounts = ref<Record<string, number>>({})

onMounted(async () => {
  try {
    skillCounts.value = await $fetch<Record<string, number>>('/api/agents/skill-counts')
  } catch {
    // Non-critical — just don't show counts
  }
})

const filteredAgents = computed(() => {
  if (!searchQuery.value) return agents.value
  const q = searchQuery.value.toLowerCase()
  return agents.value.filter(a =>
    a.frontmatter.name.toLowerCase().includes(q) ||
    a.frontmatter.description?.toLowerCase().includes(q)
  )
})
</script>

<template>
  <div>
    <PageHeader title="Agents">
      <template #trailing>
        <span class="font-mono text-[12px]" style="color: var(--text-disabled);">{{ agents.length }}</span>
      </template>
      <template #right>
        <UButton label="New Agent" icon="i-lucide-plus" size="sm" @click="showCreateModal = true" />
      </template>
    </PageHeader>

    <div class="px-6 py-4">
      <!-- Search -->
      <div class="mb-4">
        <input
          v-model="searchQuery"
          placeholder="Search agents..."
          class="field-search max-w-xs"
        />
      </div>

      <div v-if="loading" class="flex justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" style="color: var(--text-disabled);" />
      </div>

      <!-- Agent list -->
      <div v-else-if="filteredAgents.length" class="space-y-1">
        <NuxtLink
          v-for="agent in filteredAgents"
          :key="agent.slug"
          :to="`/agents/${agent.slug}`"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group focus-ring"
          style="border: 1px solid transparent;"
          @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'; ($event.currentTarget as HTMLElement).style.background = 'var(--surface-raised)'"
          @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'transparent'; ($event.currentTarget as HTMLElement).style.background = 'transparent'"
        >
          <!-- Color dot -->
          <div
            class="size-2.5 rounded-full shrink-0"
            :style="{ background: getAgentColor(agent.frontmatter.color) }"
          />

          <!-- Name -->
          <span class="font-mono text-[13px] font-medium w-44 shrink-0 truncate" style="color: var(--text-primary);">
            {{ agent.frontmatter.name }}
          </span>

          <!-- Model badge -->
          <span
            v-if="agent.frontmatter.model && modelColors[agent.frontmatter.model]"
            class="text-[10px] font-mono font-medium px-1.5 py-px rounded-full shrink-0"
            :class="[modelColors[agent.frontmatter.model].bg, modelColors[agent.frontmatter.model].text]"
          >
            {{ agent.frontmatter.model }}
          </span>

          <!-- Skills badge -->
          <span
            v-if="skillCounts[agent.frontmatter.name]"
            class="flex items-center gap-1 text-[10px] font-mono font-medium px-1.5 py-px rounded-full shrink-0"
            style="background: var(--accent-muted); color: var(--accent);"
          >
            <UIcon name="i-lucide-sparkles" class="size-3" />
            {{ skillCounts[agent.frontmatter.name] }}
          </span>

          <!-- Description -->
          <span class="flex-1 text-[12px] truncate" style="color: var(--text-tertiary);">
            {{ agent.frontmatter.description }}
          </span>

          <!-- Metadata -->
          <div class="flex items-center gap-3 shrink-0">
            <span class="font-mono text-[10px]" style="color: var(--text-disabled);">
              {{ Math.round(agent.body.length / 100) / 10 }}k chars
            </span>
            <UIcon
              v-if="agent.hasMemory"
              name="i-lucide-brain"
              class="size-3.5"
              style="color: var(--text-disabled);"
              title="Persistent memory"
            />
            <UIcon
              name="i-lucide-chevron-right"
              class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
              style="color: var(--text-disabled);"
            />
          </div>
        </NuxtLink>
      </div>

      <!-- Empty state -->
      <div v-else class="flex flex-col items-center justify-center py-16 space-y-3">
        <UIcon name="i-lucide-cpu" class="size-10" style="color: var(--text-disabled);" />
        <p class="text-[13px]" style="color: var(--text-tertiary);">
          {{ searchQuery ? 'No agents match your search.' : 'No agents found.' }}
        </p>
        <UButton v-if="!searchQuery" label="Create your first agent" size="sm" @click="showCreateModal = true" />
      </div>
    </div>

    <UModal v-model:open="showCreateModal">
      <template #content>
        <AgentForm
          mode="create"
          @saved="(a) => { showCreateModal = false; router.push(`/agents/${a.slug}`) }"
          @cancel="showCreateModal = false"
        />
      </template>
    </UModal>
  </div>
</template>
