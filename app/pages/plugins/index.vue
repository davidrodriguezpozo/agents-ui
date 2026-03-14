<script setup lang="ts">
const { plugins, loading, fetchAll, toggleEnabled } = usePlugins()
const toast = useToast()

const searchQuery = ref('')

onMounted(() => fetchAll())

const filteredPlugins = computed(() => {
  if (!searchQuery.value) return plugins.value
  const q = searchQuery.value.toLowerCase()
  return plugins.value.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.description?.toLowerCase().includes(q) ||
    p.marketplace.toLowerCase().includes(q)
  )
})

const groupedByMarketplace = computed(() => {
  const groups: Record<string, typeof plugins.value> = {}
  for (const plugin of filteredPlugins.value) {
    const key = plugin.marketplace
    if (!groups[key]) groups[key] = []
    groups[key].push(plugin)
  }
  return groups
})

async function onToggle(id: string, enabled: boolean) {
  try {
    await toggleEnabled(id, enabled)
    toast.add({ title: `Plugin ${enabled ? 'enabled' : 'disabled'}`, color: 'success' })
  } catch {
    toast.add({ title: 'Failed to update', color: 'error' })
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <div>
    <PageHeader title="Plugins">
      <template #trailing>
        <span class="font-mono text-[12px]" style="color: var(--text-disabled);">{{ plugins.length }}</span>
      </template>
    </PageHeader>

    <div class="px-6 py-4">
      <!-- Search -->
      <div class="mb-4">
        <input
          v-model="searchQuery"
          placeholder="Search plugins..."
          class="field-search max-w-xs"
        />
      </div>

      <div v-if="loading" class="flex justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" style="color: var(--text-disabled);" />
      </div>

      <div v-else-if="Object.keys(groupedByMarketplace).length" class="space-y-4">
        <div v-for="(group, marketplace) in groupedByMarketplace" :key="marketplace">
          <!-- Marketplace header -->
          <div class="flex items-center gap-2 py-2 px-2 -mx-2">
            <UIcon name="i-lucide-store" class="size-3.5" style="color: var(--text-disabled);" />
            <span class="font-mono text-[13px] font-medium" style="color: var(--text-secondary);">{{ marketplace }}</span>
            <span class="font-mono text-[11px]" style="color: var(--text-disabled);">{{ group.length }}</span>
          </div>

          <!-- Plugin list -->
          <div class="space-y-1">
            <div
              v-for="plugin in group"
              :key="plugin.id"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group"
              style="border: 1px solid transparent;"
              @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'; ($event.currentTarget as HTMLElement).style.background = 'var(--surface-raised)'"
              @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'transparent'; ($event.currentTarget as HTMLElement).style.background = 'transparent'"
            >
              <!-- Toggle -->
              <label class="field-toggle shrink-0" @click.stop>
                <input
                  type="checkbox"
                  :checked="plugin.enabled"
                  @change="onToggle(plugin.id, ($event.target as HTMLInputElement).checked)"
                />
                <span class="field-toggle__track">
                  <span class="field-toggle__thumb" />
                </span>
              </label>

              <!-- Clickable area for navigation -->
              <NuxtLink
                :to="`/plugins/${encodeURIComponent(plugin.id)}`"
                class="flex items-center gap-3 flex-1 min-w-0 focus-ring rounded"
              >
                <!-- Name -->
                <span class="font-mono text-[13px] font-medium w-44 shrink-0 truncate" style="color: var(--text-primary);">
                  {{ plugin.name }}
                </span>

                <!-- Version badge -->
                <span
                  class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0"
                  style="background: rgba(255,255,255,0.06); color: var(--text-disabled);"
                >
                  v{{ plugin.version }}
                </span>

                <!-- Description -->
                <span class="flex-1 text-[12px] truncate" style="color: var(--text-tertiary);">
                  {{ plugin.description }}
                </span>

                <!-- Metadata -->
                <div class="flex items-center gap-3 shrink-0">
                  <span
                    v-if="plugin.skills.length"
                    class="font-mono text-[10px]"
                    style="color: var(--text-disabled);"
                    :title="plugin.skills.join(', ')"
                  >
                    {{ plugin.skills.length }} skill{{ plugin.skills.length === 1 ? '' : 's' }}
                  </span>
                  <span class="font-mono text-[10px]" style="color: var(--text-disabled);">
                    {{ formatDate(plugin.installedAt) }}
                  </span>
                  <UIcon
                    name="i-lucide-chevron-right"
                    class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    style="color: var(--text-disabled);"
                  />
                </div>
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="flex flex-col items-center justify-center py-16 space-y-3">
        <UIcon name="i-lucide-puzzle" class="size-10" style="color: var(--text-disabled);" />
        <p class="text-[13px]" style="color: var(--text-tertiary);">
          {{ searchQuery ? 'No plugins match your search.' : 'No plugins installed.' }}
        </p>
      </div>
    </div>
  </div>
</template>
