<script setup lang="ts">
import { groupByOrigin, filterGroups } from '~/utils/entityGroups'

const { commands, loading, error } = useCommands()
const router = useRouter()

const showCreateModal = ref(false)
const searchQuery = ref('')

/**
 * This page had the grouping right before the others did; it now shares the
 * implementation rather than owning a private one, which is what let agents,
 * skills and workflows have it too.
 */
const groups = computed(() => filterGroups(
  groupByOrigin(commands.value),
  searchQuery.value,
  c => [c.invocation, c.frontmatter.description, c.pluginName],
))
</script>

<template>
  <div>
    <PageHeader title="Commands">
      <template #trailing>
        <span class="font-mono fs-sm text-meta">{{ commands.length }}</span>
      </template>
      <template #right>
        <UButton label="New Command" icon="i-lucide-plus" size="sm" @click="() => { showCreateModal = true }" />
      </template>
    </PageHeader>

    <div class="page-container py-6">
      <p class="fs-base mb-4 leading-relaxed text-label">
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
        style="background: var(--error-wash); border: 1px solid var(--error-tint);"
      >
        <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0 mt-0.5 ink-error" />
        <span class="fs-sm ink-error">{{ error }}</span>
      </div>

      <div v-if="loading" class="space-y-1">
        <SkeletonRow v-for="i in 5" :key="i" />
      </div>

      <EntityList
        v-else-if="groups.length"
        :groups="groups"
        :plugin-route="id => `/plugins/${encodeURIComponent(id)}`"
      >
        <template #row="{ item: cmd }">
          <EntityRow
            mono
            accent
            icon="i-lucide-terminal"
            :to="`/commands/${cmd.slug}`"
            :name="cmd.invocation"
            :description="cmd.frontmatter.description"
          >
            <template #badges>
              <span
                v-if="cmd.frontmatter['argument-hint']"
                class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0 badge badge-subtle max-w-[160px] truncate"
              >
                {{ cmd.frontmatter['argument-hint'] }}
              </span>
            </template>
          </EntityRow>
        </template>
      </EntityList>

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
