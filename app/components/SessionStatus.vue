<script setup lang="ts">
import { sessionBadge } from '~/utils/sessionBadge'
import type { SessionActivity, SessionCheck } from '~/composables/useSessions'

/**
 * What a session amounts to, as one glanceable thing.
 *
 * The decision is in `~/utils/sessionBadge`, where it can be tested. It used to
 * live in this file and got three separate things wrong that only reading the
 * rendered page ever caught — green over "17 behind" being the one that
 * mattered, because it is a claim that the work is verified when its
 * verification has been void since somebody merged something else.
 */
const props = defineProps<{
  activity: SessionActivity
  changedFiles?: number
  dirty?: boolean
  compact?: boolean
  check?: SessionCheck | null
  /** The verdict predates the current state of the workspace. */
  checkStale?: boolean
  /** Commits on the base branch this session has not got. */
  behind?: number
  /** Its work is in the base branch already. */
  landed?: boolean
}>()

const state = computed(() => sessionBadge({
  activity: props.activity,
  changedFiles: props.changedFiles,
  check: props.check,
  checkStale: props.checkStale,
  behind: props.behind,
  landed: props.landed,
}))
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
