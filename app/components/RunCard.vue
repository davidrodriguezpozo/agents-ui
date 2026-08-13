<script setup lang="ts">
import { formatCost, formatDuration, relativeTime } from '~/utils/time'
import { STATUS_LOOK, WORK_ORIGIN, type WorkItem } from '~/utils/workList'

/**
 * A run on the work list.
 *
 * Deliberately the same anatomy as `SessionCard` — title and verdict, then what
 * it produced, then the time, then a quiet footer — because the two sit in one
 * list now and a list whose rows change shape halfway down is the thing this
 * whole rework has been undoing.
 *
 * Not the same *content*, though. Flattening a run's facts into a session's
 * fields, or the reverse, is what made merging these two lists look impossible;
 * each row keeps its own, and only the skeleton is shared.
 */
const props = defineProps<{ item: WorkItem }>()

const look = computed(() => STATUS_LOOK[props.item.status])
const origin = computed(() => WORK_ORIGIN.find(o => o.value === props.item.origin))

/** An outline earns itself the same way it does on a session: it wants you. */
const accent = computed(() => {
  if (props.item.status === 'needs-you') return 'border-color: var(--accent-glow);'
  if (props.item.status === 'failed') return 'border-color: var(--error);'
  return undefined
})
</script>

<template>
  <NuxtLink
    :to="item.to"
    class="block rounded-md p-4 focus-ring hover-card bg-card"
    :style="accent"
  >
    <div class="flex items-start gap-3">
      <div class="flex-1 min-w-0 space-y-1.5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="type-strong truncate">{{ item.title }}</span>
          <span
            class="fs-micro font-medium px-1.5 py-px rounded-full shrink-0 flex items-center gap-1"
            :style="{
              background: `color-mix(in srgb, ${look.colour} 14%, transparent)`,
              color: look.colour,
            }"
          >
            <UIcon
              :name="look.icon"
              class="size-2.5 shrink-0"
              :class="{ 'animate-spin': item.status === 'running' }"
            />
            {{ item.outcome }}
          </span>
        </div>

        <p v-if="item.detail" class="type-detail leading-snug ink-2 line-clamp-2">
          {{ item.detail }}
        </p>

        <div class="flex items-center gap-3 type-meta">
          <span v-if="item.durationMs" class="flex items-center gap-1">
            <UIcon name="i-lucide-timer" class="size-3 shrink-0" />
            {{ formatDuration(item.durationMs) }}
          </span>
          <span v-if="item.costUsd" class="flex items-center gap-1">
            <UIcon name="i-lucide-coins" class="size-3 shrink-0" />
            {{ formatCost(item.costUsd) }}
          </span>
          <span v-if="!item.durationMs && !item.costUsd">Nothing recorded</span>
        </div>
      </div>

      <span class="type-mono-meta shrink-0">{{ relativeTime(item.at) }}</span>
    </div>

    <!-- What set it going, which is the run equivalent of a session's branch -->
    <div
      class="flex items-center gap-1.5 mt-2.5 pt-2.5 type-mono-meta"
      style="border-top: 1px solid var(--border-subtle);"
    >
      <UIcon :name="origin?.icon ?? 'i-lucide-terminal'" class="size-2.5 shrink-0" />
      <span class="truncate">{{ origin?.label ?? item.origin }}</span>
    </div>
  </NuxtLink>
</template>
