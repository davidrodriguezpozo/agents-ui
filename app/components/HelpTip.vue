<script setup lang="ts">
defineProps<{
  title: string
  body: string
  hasExample?: boolean
}>()

const showExample = ref(false)
</script>

<template>
  <UPopover :ui="{ width: 'max-w-[280px]' }">
    <button
      class="inline-flex items-center justify-center size-[18px] rounded-full shrink-0 cursor-pointer"
      style="background: var(--badge-subtle-bg); border: 1px solid var(--border-subtle); color: var(--text-disabled);"
      :aria-label="`Learn more about ${title}`"
      @click.stop
    >
      <span class="text-[10px] font-bold leading-none">?</span>
    </button>
    <template #content>
      <div class="p-3 space-y-1.5">
        <div class="text-[12px] font-semibold" style="color: var(--text-primary);">{{ title }}</div>
        <p class="text-[11px] leading-relaxed" style="color: var(--text-secondary);">{{ body }}</p>
        <button
          v-if="hasExample"
          class="text-[11px] font-medium mt-1"
          style="color: var(--accent);"
          @click="showExample = !showExample"
        >
          {{ showExample ? 'Hide example' : 'See example' }}
        </button>
      </div>
    </template>
  </UPopover>
  <div v-if="hasExample && showExample" class="mt-2">
    <slot />
  </div>
</template>
