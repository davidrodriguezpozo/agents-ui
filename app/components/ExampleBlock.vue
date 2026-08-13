<script setup lang="ts">
defineProps<{
  title: string
}>()

const open = ref(false)
</script>

<template>
  <div
    class="rounded-md overflow-hidden"
    style="border-left: 3px solid var(--accent); background: var(--surface-raised);"
  >
    <button
      class="w-full flex items-center gap-2 px-4 py-2.5 text-left"
      @click="open = !open"
    >
      <UIcon name="i-lucide-lightbulb" class="size-3.5 shrink-0 ink-accent" />
      <span class="fs-sm font-medium flex-1 ink-2">{{ title }}</span>
      <UIcon
        :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        class="size-3.5"
        style="color: var(--text-disabled);"
      />
    </button>
    <div v-if="open" class="px-4 pb-3">
      <slot />
    </div>
  </div>
</template>
