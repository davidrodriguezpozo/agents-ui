<script setup lang="ts" generic="T extends { slug: string }">
import type { OriginGroup, GroupKind } from '~/utils/entityGroups'
import { initiallyCollapsed } from '~/utils/entityGroups'

/**
 * A list of named things, grouped by where they came from.
 *
 * Groups collapse, your own work is always open, and a plugin that brought 137
 * skills arrives folded with a count rather than pushing everything you wrote
 * off the screen. The row itself comes from the caller — see `EntityRow` for
 * the shape they all share.
 */
const props = defineProps<{
  groups: OriginGroup<T>[]
  /** Builds the href for a group's "View plugin" link. Omit to hide it. */
  pluginRoute?: (pluginId: string) => string
}>()

/**
 * Collapse state is seeded from the groups, then owned by the user. Re-seeding
 * on every change would fight them: expanding `posthog`, typing in the search
 * box and having it fold shut again is worse than never collapsing at all.
 */
const collapsed = ref<Record<string, boolean>>({})
const seeded = new Set<string>()

watch(() => props.groups, (groups) => {
  for (const [key, value] of Object.entries(initiallyCollapsed(groups))) {
    if (seeded.has(key)) continue
    collapsed.value[key] = value
    seeded.add(key)
  }
}, { immediate: true })

function toggle(key: string) {
  collapsed.value[key] = !collapsed.value[key]
}

/** A single group of your own things is the whole page; a header for it is noise. */
const showHeaders = computed(() =>
  props.groups.length > 1 || props.groups[0]?.kind === 'plugin',
)

function iconColour(kind: GroupKind) {
  if (kind === 'plugin') return 'var(--plugin)'
  if (kind === 'project') return 'var(--success)'
  if (kind === 'github') return 'var(--info)'
  return 'var(--text-tertiary)'
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="group in groups" :key="group.key">
      <div v-if="showHeaders" class="flex items-center gap-2">
        <button
          class="flex items-center gap-2 flex-1 text-left py-2.5 px-3 -mx-2 rounded-md hover-bg focus-ring"
          :aria-expanded="!collapsed[group.key]"
          @click="toggle(group.key)"
        >
          <UIcon
            :name="collapsed[group.key] ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
            class="size-3.5 text-meta"
          />
          <UIcon :name="group.icon" class="size-3.5" :style="{ color: iconColour(group.kind) }" />
          <span class="type-strong">{{ group.label }}</span>
          <span class="font-mono fs-sm text-meta">{{ group.items.length }}</span>
        </button>

        <NuxtLink
          v-if="group.pluginId && pluginRoute"
          :to="pluginRoute(group.pluginId)"
          class="fs-mono px-2 py-1 rounded focus-ring text-meta hover-bg shrink-0"
        >
          View plugin
        </NuxtLink>
      </div>

      <div
        v-if="!collapsed[group.key]"
        class="space-y-px"
        :class="showHeaders ? 'ml-5 border-l pl-3' : ''"
        :style="showHeaders ? 'border-color: var(--border-subtle);' : ''"
      >
        <template v-for="item in group.items" :key="item.slug">
          <slot name="row" :item="item" />
        </template>
      </div>
    </div>
  </div>
</template>
