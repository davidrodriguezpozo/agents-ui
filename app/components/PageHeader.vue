<script setup lang="ts">
/**
 * `width` should match the container the page body uses, so the title lines up
 * with the content underneath it rather than floating off at the window edge.
 */
withDefaults(defineProps<{
  title: string
  width?: 'narrow' | 'wide' | 'full'
}>(), {
  width: 'full',
})
</script>

<template>
  <div
    class="h-16 shrink-0 sticky top-0 z-10"
    style="border-bottom: 1px solid var(--border-subtle); background: var(--surface-base); backdrop-filter: blur(12px);"
  >
    <div
      class="h-full flex items-center gap-3"
      :class="width === 'full'
        ? 'px-6'
        : ['page-container', width === 'wide' ? 'page-container--wide' : 'page-container--narrow']"
    >
      <slot name="leading" />
      <h1 class="text-page-title flex-1 flex items-center gap-2.5 min-w-0">
        <span class="truncate">{{ title }}</span>
        <slot name="trailing" />
      </h1>
      <div class="flex items-center gap-2 shrink-0">
        <slot name="right" />
      </div>
    </div>
  </div>
</template>
