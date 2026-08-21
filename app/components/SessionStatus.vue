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
 *
 * Two renderings of the same decision:
 *
 *   - the **pill**, for a detail header or anywhere a single session is the
 *     subject and there is room to say what it is in words;
 *   - the **glyph**, for a list, where forty pills at forty different
 *     x-positions read as confetti. The words move to the tooltip; the shape
 *     stays in a fixed column so the eye can run down it.
 *
 * Both take the same props and say the same thing, which is the point of the
 * decision living somewhere neither of them can reach.
 */
const props = defineProps<{
  activity: SessionActivity
  changedFiles?: number
  dirty?: boolean
  compact?: boolean
  /** Draw the 14px mark instead of the pill. For dense lists. */
  glyph?: boolean
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
  <!--
    The glyph carries no text, so the label has to reach a reader some other
    way: `title` for the pointer, `aria-label` with role="img" for everything
    else. A bare coloured ring is not a status to anyone who cannot see it.
  -->
  <span
    v-if="glyph"
    class="status-glyph"
    :class="`status-glyph--${state.shape}`"
    :style="{ color: state.color }"
    :title="state.label"
    :aria-label="state.label"
    role="img"
  />
  <span
    v-else
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
