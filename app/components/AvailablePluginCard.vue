<script setup lang="ts">
import type { AvailablePlugin } from '~/types'

defineProps<{
  plugin: AvailablePlugin
}>()

const emit = defineEmits<{
  install: [marketplace: string, plugin: string]
}>()

const installing = ref(false)

async function onInstall(marketplace: string, name: string) {
  installing.value = true
  emit('install', marketplace, name)
}

defineExpose({ installing })
</script>

<template>
  <div
    class="flex items-center gap-3 px-3 py-2.5 rounded-lg group hover-row"
  >
    <div class="flex items-center gap-3 flex-1 min-w-0">
      <UIcon name="i-lucide-puzzle" class="size-3.5 shrink-0 text-meta" />
      <span class="text-[13px] font-medium w-44 shrink-0 truncate">{{ plugin.name }}</span>
      <span class="flex-1 text-[12px] truncate text-label">{{ plugin.description }}</span>
      <div class="flex items-center gap-3 shrink-0">
        <span v-if="plugin.skillCount" class="font-mono text-[10px] text-meta">
          {{ plugin.skillCount }} skill{{ plugin.skillCount === 1 ? '' : 's' }}
        </span>
        <span v-if="plugin.commandCount" class="font-mono text-[10px] text-meta">
          {{ plugin.commandCount }} cmd{{ plugin.commandCount === 1 ? '' : 's' }}
        </span>
      </div>
    </div>
    <UButton
      label="Install"
      icon="i-lucide-download"
      size="xs"
      variant="soft"
      :loading="installing"
      @click="onInstall(plugin.marketplace, plugin.name)"
    />
  </div>
</template>
