<script setup lang="ts">
const { commands, loading, error, groupedBySource } = useCommands()
const router = useRouter()

const showCreateModal = ref(false)
const searchQuery = ref('')
const collapsedGroups = ref<Record<string, boolean>>({})

function toggleGroup(key: string) {
  collapsedGroups.value[key] = !collapsedGroups.value[key]
}

function isExpanded(key: string) {
  return !collapsedGroups.value[key]
}

const filteredGroups = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return groupedBySource.value

  return groupedBySource.value
    .map(group => ({
      ...group,
      commands: group.commands.filter(c =>
        c.invocation.toLowerCase().includes(q)
        || c.frontmatter.description?.toLowerCase().includes(q)
        || (c.pluginName || '').toLowerCase().includes(q)
      ),
    }))
    .filter(group => group.commands.length > 0)
})


</script>

<template>
  <div>
    <PageHeader title="Commands">
      <template #trailing>
        <span class="font-mono text-[12px] text-meta">{{ commands.length }}</span>
      </template>
      <template #right>
        <UButton label="New Command" icon="i-lucide-plus" size="sm" @click="() => { showCreateModal = true }" />
      </template>
    </PageHeader>

    <div class="px-6 py-4">
      <p class="text-[13px] mb-4 leading-relaxed text-label">
        Reusable workflows you can trigger with a slash command (e.g., /deploy). Grouped by where they come from.
      </p>

      <!-- Search -->
      <div class="mb-4">
        <input
          v-model="searchQuery"
          placeholder="Search commands..."
          class="field-search max-w-xs"
        />
      </div>

      <div
        v-if="error"
        class="rounded-lg px-4 py-3 mb-4 flex items-start gap-3"
        style="background: rgba(248, 113, 113, 0.06); border: 1px solid rgba(248, 113, 113, 0.12);"
      >
        <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0 mt-0.5" style="color: var(--error);" />
        <span class="text-[12px]" style="color: var(--error);">{{ error }}</span>
      </div>

      <div v-if="loading" class="space-y-1">
        <SkeletonRow v-for="i in 5" :key="i" />
      </div>

      <div v-else-if="filteredGroups.length" class="space-y-3">
        <div v-for="group in filteredGroups" :key="group.key">
          <!-- Group header -->
          <div class="flex items-center gap-2">
            <button
              class="flex items-center gap-2 flex-1 text-left py-2.5 px-3 -mx-2 rounded-md hover-bg focus-ring text-body"
              @click="toggleGroup(group.key)"
            >
              <UIcon
                :name="isExpanded(group.key) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-3.5 text-meta"
              />
              <UIcon
                :name="group.icon"
                class="size-3.5"
                :style="{ color: group.kind === 'plugin' ? 'rgb(139, 92, 246)' : group.kind === 'project' ? 'rgb(34, 197, 94)' : 'var(--text-tertiary)' }"
              />
              <span class="type-strong">{{ group.label }}</span>
              <span class="font-mono text-[12px] text-meta">{{ group.commands.length }}</span>
            </button>

            <NuxtLink
              v-if="group.pluginId"
              :to="`/plugins/${encodeURIComponent(group.pluginId)}`"
              class="text-[11px] px-2 py-1 rounded focus-ring text-meta hover-bg shrink-0"
            >
              View plugin
            </NuxtLink>
          </div>

          <!-- Commands in group -->
          <div v-if="isExpanded(group.key)" class="ml-5 border-l space-y-px pl-3" style="border-color: var(--border-subtle);">
            <NuxtLink
              v-for="cmd in group.commands"
              :key="cmd.slug"
              :to="`/commands/${cmd.slug}`"
              class="flex items-center gap-3 px-3 py-2 rounded-md group focus-ring hover-row"
            >
              <span class="font-mono text-[10px] font-medium shrink-0 text-meta">&gt;_</span>

              <!-- Real invocation, e.g. /defender:pickup -->
              <span class="font-mono text-[12px] font-medium w-52 shrink-0 truncate" style="color: var(--accent);">
                {{ cmd.invocation }}
              </span>

              <span
                v-if="cmd.frontmatter['argument-hint']"
                class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 badge badge-subtle max-w-[160px] truncate"
              >
                {{ cmd.frontmatter['argument-hint'] }}
              </span>

              <span class="flex-1 text-[12px] truncate text-label">
                {{ cmd.frontmatter.description }}
              </span>

              <div class="flex items-center gap-2 shrink-0">
                <SourceBadge
                  :scope="cmd.scope"
                  :source="cmd.source"
                  :plugin-name="cmd.pluginName"
                  :project-dir="cmd.projectDir"
                />
                <UIcon
                  name="i-lucide-chevron-right"
                  class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-meta"
                />
              </div>
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Empty state: search miss -->
      <EmptyState
        v-else-if="searchQuery"
        icon="i-lucide-search-x"
        title="No commands match your search"
        description="Try a shorter search, or check a different tool."
      />

      <!-- Empty state: no commands -->
      <div v-else class="flex flex-col items-center justify-center py-12 space-y-5">
        <div class="rounded-md p-4 bg-card max-w-sm w-full font-mono type-detail leading-relaxed">
          <span class="text-meta"># Example: a deploy command</span><br>
          <span style="color: var(--accent);">/deploy</span> staging --skip-tests<br>
          <span class="text-meta"># Claude follows your command's instructions</span>
        </div>
        <p class="type-body">Commands let you trigger repeatable workflows with a slash.</p>
        <UButton label="Create a command" size="sm" @click="() => { showCreateModal = true }" />
      </div>
    </div>

    <UModal v-model:open="showCreateModal">
      <template #content>
        <CommandForm
          @saved="(c) => { showCreateModal = false; router.push(`/commands/${c.slug}`) }"
          @cancel="showCreateModal = false"
        />
      </template>
    </UModal>
  </div>
</template>
