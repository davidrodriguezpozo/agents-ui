<script setup lang="ts">
import type { SessionActivity } from '~/composables/useSessions'

/**
 * What a session is doing, as one glanceable thing.
 *
 * The distinction that matters is "working" versus "waiting for you" — both
 * were reported as running before, so a blocked session was indistinguishable
 * from a busy one and could sit there indefinitely.
 */
const props = defineProps<{
  activity: SessionActivity
  changedFiles?: number
  dirty?: boolean
  compact?: boolean
}>()

const state = computed(() => {
  switch (props.activity) {
    case 'awaiting-permission':
      return {
        label: 'Needs you',
        icon: 'i-lucide-hand',
        color: 'var(--accent)',
        background: 'var(--accent-muted)',
        pulse: true,
      }
    case 'working':
      return {
        label: 'Working',
        icon: 'i-lucide-loader-2',
        color: 'var(--accent)',
        background: 'var(--accent-muted)',
        spin: true,
      }
    case 'failed':
      return {
        label: 'Failed',
        icon: 'i-lucide-circle-alert',
        color: 'var(--error)',
        background: 'rgba(248, 113, 113, 0.12)',
      }
    case 'missing':
      return {
        label: 'Workspace gone',
        icon: 'i-lucide-unlink',
        color: 'var(--error)',
        background: 'rgba(248, 113, 113, 0.12)',
      }
    default:
      return props.changedFiles
        ? {
            label: 'Changes ready',
            icon: 'i-lucide-check',
            color: 'var(--success)',
            background: 'rgba(34, 197, 94, 0.12)',
          }
        : {
            label: 'Idle',
            icon: 'i-lucide-circle-dashed',
            color: 'var(--text-disabled)',
            background: 'var(--badge-subtle-bg)',
          }
  }
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full shrink-0"
    :class="compact ? 'px-1.5 py-px' : 'px-2 py-0.5'"
    :style="{ background: state.background, color: state.color }"
  >
    <UIcon
      :name="state.icon"
      class="shrink-0"
      :class="[compact ? 'size-2.5' : 'size-3', { 'animate-spin': state.spin, 'animate-pulse': state.pulse }]"
    />
    <span class="type-mono-meta" :style="{ color: state.color }">{{ state.label }}</span>
  </span>
</template>
