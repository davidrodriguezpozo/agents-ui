<script setup lang="ts">
const { commands, loading, error, groupedByDirectory, remove } = useCommands()
const router = useRouter()
const toast = useToast()

const showCreateModal = ref(false)
const searchQuery = ref('')
const expandedGroups = ref<Record<string, boolean>>({})

function toggleGroup(dir: string) {
  expandedGroups.value[dir] = !expandedGroups.value[dir]
}

function isExpanded(dir: string) {
  return expandedGroups.value[dir] !== false // default expanded
}

const filteredGrouped = computed(() => {
  if (!searchQuery.value) return groupedByDirectory.value
  const q = searchQuery.value.toLowerCase()
  const result: Record<string, typeof commands.value> = {}
  for (const [dir, cmds] of Object.entries(groupedByDirectory.value)) {
    const filtered = cmds.filter(c =>
      c.frontmatter.name.toLowerCase().includes(q) ||
      c.frontmatter.description?.toLowerCase().includes(q)
    )
    if (filtered.length) result[dir] = filtered
  }
  return result
})

const filteredCount = computed(() =>
  Object.values(filteredGrouped.value).reduce((sum, cmds) => sum + cmds.length, 0)
)
</script>

<template>
  <div>
    <PageHeader title="Commands">
      <template #trailing>
        <span class="font-mono text-[12px] text-meta">{{ commands.length }}</span>
      </template>
      <template #right>
        <UButton label="New Command" icon="i-lucide-plus" size="sm" @click="showCreateModal = true" />
      </template>
    </PageHeader>

    <div class="px-6 py-4">
      <p class="text-[13px] mb-4 leading-relaxed text-label">
        Reusable workflows you can trigger with a slash command (e.g., /deploy).
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
        class="rounded-xl px-4 py-3 mb-4 flex items-start gap-3"
        style="background: rgba(248, 113, 113, 0.06); border: 1px solid rgba(248, 113, 113, 0.12);"
      >
        <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0 mt-0.5" style="color: var(--error);" />
        <span class="text-[12px]" style="color: var(--error);">{{ error }}</span>
      </div>

      <div v-if="loading" class="space-y-1">
        <SkeletonRow v-for="i in 5" :key="i" />
      </div>

      <div v-else-if="Object.keys(filteredGrouped).length" class="space-y-2">
        <div v-for="(cmds, dir) in filteredGrouped" :key="dir">
          <!-- Group header -->
          <button
            class="flex items-center gap-2 w-full text-left py-2.5 px-3 -mx-2 rounded-lg hover-bg focus-ring text-body"
            @click="toggleGroup(dir)"
          >
            <UIcon
              :name="isExpanded(dir) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="size-3.5 text-meta"
            />
            <UIcon name="i-lucide-folder" class="size-3.5 text-meta" />
            <span class="font-mono text-[13px] font-medium">{{ dir }}</span>
            <span class="font-mono text-[12px] text-meta">{{ cmds.length }}</span>
          </button>

          <!-- Commands in group -->
          <div v-if="isExpanded(dir)" class="ml-5 border-l space-y-px pl-3" style="border-color: var(--border-subtle);">
            <NuxtLink
              v-for="cmd in cmds"
              :key="cmd.slug"
              :to="`/commands/${cmd.slug}`"
              class="flex items-center gap-3 px-3 py-2 rounded-lg group focus-ring hover-row"
            >
              <!-- Terminal icon -->
              <span class="font-mono text-[10px] font-medium shrink-0 text-meta">&gt;_</span>

              <!-- Name -->
              <span class="text-[13px] font-medium w-44 shrink-0 truncate">
                /{{ cmd.frontmatter.name }}
              </span>

              <!-- Argument hint badge -->
              <span
                v-if="cmd.frontmatter['argument-hint']"
                class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 badge badge-subtle"
              >
                {{ cmd.frontmatter['argument-hint'] }}
              </span>

              <!-- Description -->
              <span class="flex-1 text-[12px] truncate text-label">
                {{ cmd.frontmatter.description }}
              </span>

              <!-- Metadata -->
              <div class="flex items-center gap-3 shrink-0">
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
      <div v-else-if="searchQuery" class="flex flex-col items-center justify-center py-16">
        <p class="text-[13px] text-label">No commands match your search.</p>
      </div>

      <!-- Empty state: no commands -->
      <div v-else class="flex flex-col items-center justify-center py-12 space-y-5">
        <div class="rounded-lg p-4 bg-card max-w-sm w-full font-mono text-[12px] text-label leading-relaxed">
          <span class="text-meta"># Example: a deploy command</span><br>
          <span style="color: var(--accent);">/deploy</span> staging --skip-tests<br>
          <span class="text-meta"># Claude follows your command's instructions</span>
        </div>
        <p class="text-[13px] text-label">Commands let you trigger repeatable workflows with a slash.</p>
        <UButton label="Create a command" size="sm" @click="showCreateModal = true" />
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
