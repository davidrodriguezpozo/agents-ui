<script setup lang="ts">
/**
 * One row, one shape, for every named thing you own — agent, command, skill,
 * workflow.
 *
 * These four used to be a card grid, a dense table, grouped rows and cards
 * again: four ways to say "a named thing from somewhere, with a description",
 * so the interaction had to be learned four times. The anatomy is fixed here
 * and the type-specific parts are slots.
 *
 *   [icon] [name] [#badges] [description] [#meta] [source] [›]
 */
withDefaults(defineProps<{
  to: string
  name: string
  description?: string
  icon?: string
  /** Set the name in mono — for things typed rather than read, like /deploy. */
  mono?: boolean
  /** Tints the icon and a mono name. Provenance and state, never decoration. */
  accent?: boolean
  /**
   * An identity colour for this one item, which agents carry and nothing else
   * does. Overrides `accent` on the icon; the card grid used it as a 4px bar
   * across the top, and a tinted glyph says the same thing in a row.
   */
  iconColor?: string
}>(), {
  icon: 'i-lucide-file-text',
  mono: false,
  accent: false,
})
</script>

<template>
  <NuxtLink
    :to="to"
    class="entity-row flex items-center gap-3 px-3 py-2.5 rounded-md group focus-ring hover-row"
  >
    <UIcon
      :name="icon"
      class="size-3.5 shrink-0"
      :class="iconColor ? '' : (accent ? 'ink-accent' : 'ink-3')"
      :style="iconColor ? { color: iconColor } : undefined"
    />

    <!--
      A fixed column so names line up down the page, but wide enough for the
      real ones: `auditing-warehouse-sources` truncated at the old 176px.
    -->
    <span
      class="w-64 shrink-0 truncate"
      :class="[mono ? 'font-mono fs-sm font-medium' : 'type-strong', accent && mono ? 'ink-accent' : '']"
    >
      {{ name }}
    </span>

    <slot name="badges" />

    <span class="flex-1 fs-sm truncate text-label">{{ description }}</span>

    <div class="flex items-center gap-2 shrink-0">
      <slot name="meta" />
      <UIcon
        name="i-lucide-chevron-right"
        class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-meta"
      />
    </div>
  </NuxtLink>
</template>
