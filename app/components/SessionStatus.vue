<script setup lang="ts">
import type { SessionActivity, SessionCheck } from '~/composables/useSessions'

/**
 * What a session is doing, as one glanceable thing.
 *
 * The distinction that matters is "working" versus "waiting for you" — both
 * were reported as running before, so a blocked session was indistinguishable
 * from a busy one and could sit there indefinitely.
 *
 * Once a session goes quiet the interesting question changes, from what it is
 * doing to whether what it produced is any good. "Changes ready" was the old
 * answer and it was never one — it only ever meant files had been written. So
 * a finished session reports its checks instead, when there are any.
 */
const props = defineProps<{
  activity: SessionActivity
  changedFiles?: number
  dirty?: boolean
  compact?: boolean
  check?: SessionCheck | null
  /** The verdict predates the current state of the workspace. */
  checkStale?: boolean
}>()

/** Only meaningful once nothing is running — mid-turn it describes the past. */
const settledCheck = computed(() =>
  props.activity === 'idle' ? props.check ?? null : null
)

interface Badge {
  label: string
  icon: string
  color: string
  background: string
  spin?: boolean
  pulse?: boolean
}

const state = computed<Badge>(() => {
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
      break
  }

  const check = settledCheck.value

  if (check?.status === 'running') {
    return {
      label: 'Checking',
      icon: 'i-lucide-loader-2',
      color: 'var(--accent)',
      background: 'var(--accent-muted)',
      spin: true,
    }
  }

  if (check?.status === 'failing') {
    return {
      label: props.checkStale ? 'Failed, then changed' : 'Checks failed',
      icon: 'i-lucide-circle-x',
      color: 'var(--error)',
      background: 'rgba(248, 113, 113, 0.12)',
    }
  }

  // Deliberately not green: a check that could not run is not a pass, and
  // colouring it like one is the exact lie this feature exists to stop.
  if (check?.status === 'errored') {
    return {
      label: 'Checks did not run',
      icon: 'i-lucide-circle-help',
      color: 'var(--warning)',
      background: 'rgba(212, 153, 34, 0.12)',
    }
  }

  if (check?.status === 'passing') {
    return props.checkStale
      ? {
          label: 'Passed, then changed',
          icon: 'i-lucide-history',
          color: 'var(--warning)',
          background: 'rgba(212, 153, 34, 0.12)',
        }
      : {
          label: 'Checks pass',
          icon: 'i-lucide-check-check',
          color: 'var(--success)',
          background: 'rgba(34, 197, 94, 0.12)',
        }
  }

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
