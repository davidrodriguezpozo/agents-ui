<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { getAgentColor } from '~/utils/colors'

const props = defineProps<{
  data: {
    label: string
    agentSlug: string
    agentColor?: string
    agentModel?: string
    stepNumber: number
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  }
}>()

const emit = defineEmits<{
  remove: []
  moveUp: []
  moveDown: []
}>()

const color = computed(() => getAgentColor(props.data.agentColor))

const modelLabel = computed(() => {
  const m = props.data.agentModel
  if (m === 'opus') return 'Opus'
  if (m === 'sonnet') return 'Sonnet'
  if (m === 'haiku') return 'Haiku'
  return 'Default'
})
</script>

<template>
  <div
    class="workflow-node relative rounded-lg overflow-hidden group"
    style="width: 160px; height: 80px; background: var(--surface-raised); border: 1px solid var(--border-subtle);"
    :class="{
      'workflow-node--running': data.status === 'running',
      'workflow-node--completed': data.status === 'completed',
      'workflow-node--failed': data.status === 'failed',
      'workflow-node--skipped': data.status === 'skipped',
    }"
  >
    <Handle type="target" :position="Position.Left" />
    <div class="absolute inset-x-0 top-0 h-[3px]" :style="{ background: color }" />
    <div class="p-2.5 h-full flex flex-col justify-between">
      <div class="flex items-center justify-between">
        <span class="text-[9px] font-mono" style="color: var(--text-disabled);">#{{ data.stepNumber }}</span>
        <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button class="p-0.5 rounded" style="color: var(--text-disabled);" @click="emit('moveUp')">
            <UIcon name="i-lucide-chevron-left" class="size-3" />
          </button>
          <button class="p-0.5 rounded" style="color: var(--text-disabled);" @click="emit('moveDown')">
            <UIcon name="i-lucide-chevron-right" class="size-3" />
          </button>
          <button class="p-0.5 rounded" style="color: var(--text-disabled);" @click="emit('remove')">
            <UIcon name="i-lucide-x" class="size-3" />
          </button>
        </div>
      </div>
      <div class="text-[11px] font-medium truncate" style="color: var(--text-primary);">{{ data.label }}</div>
      <span class="text-[9px]" style="color: var(--text-disabled);">{{ modelLabel }}</span>
    </div>
    <Handle type="source" :position="Position.Right" />

    <!-- Status overlays -->
    <div v-if="data.status === 'completed'" class="absolute top-1 right-1">
      <UIcon name="i-lucide-check-circle" class="size-4" style="color: var(--success, #22c55e);" />
    </div>
    <div v-if="data.status === 'failed'" class="absolute top-1 right-1">
      <UIcon name="i-lucide-x-circle" class="size-4" style="color: var(--error);" />
    </div>
  </div>
</template>

<style scoped>
.workflow-node--running {
  border-color: var(--accent) !important;
  box-shadow: 0 0 15px var(--accent-glow);
  animation: nodePulse 1.5s ease-in-out infinite;
}
.workflow-node--completed { border-color: var(--success, #22c55e) !important; }
.workflow-node--failed { border-color: var(--error) !important; }
.workflow-node--skipped { opacity: 0.4; }

@keyframes nodePulse {
  0%, 100% { box-shadow: 0 0 10px var(--accent-glow); }
  50% { box-shadow: 0 0 25px var(--accent-glow); }
}
</style>
