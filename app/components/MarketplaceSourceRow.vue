<script setup lang="ts">
import type { MarketplaceSource } from '~/types'

defineProps<{
  source: MarketplaceSource
}>()

const emit = defineEmits<{
  update: [name: string]
  remove: [name: string]
}>()

const updating = ref(false)

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <div
    class="flex items-center justify-between py-2 px-3 rounded-lg"
    style="background: var(--input-bg);"
  >
    <div class="flex items-center gap-3 flex-1 min-w-0">
      <UIcon name="i-lucide-store" class="size-3.5 shrink-0 text-meta" />
      <span class="font-mono text-[12px] font-medium text-body">{{ source.name }}</span>
      <span class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 badge badge-subtle">
        {{ source.sourceType }}
      </span>
      <span class="text-[11px] text-meta truncate flex-1">{{ source.sourceUrl }}</span>
      <span class="font-mono text-[10px] text-meta shrink-0">{{ formatDate(source.lastUpdated) }}</span>
    </div>
    <div class="flex items-center gap-2 ml-3">
      <UButton
        label="Update"
        icon="i-lucide-refresh-cw"
        size="xs"
        variant="ghost"
        color="neutral"
        :loading="updating"
        @click="updating = true; emit('update', source.name)"
      />
      <button
        class="p-1.5 -m-0.5 rounded focus-ring text-meta"
        aria-label="Remove marketplace"
        @click="emit('remove', source.name)"
      >
        <UIcon name="i-lucide-x" class="size-3.5" />
      </button>
    </div>
  </div>
</template>
