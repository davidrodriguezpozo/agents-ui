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

const emit = defineEmits<{ remove: [WorkItem]; restore: [WorkItem] }>()

/**
 * A finished run can be taken off the list; one still going cannot.
 *
 * Hiding something in flight reads as cancelling it and is not — the run would
 * carry on invisibly and land where nobody is looking. Cancel is the control for
 * that, and it lives on the run's own page.
 */
const removable = computed(() => props.item.status !== 'running')

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
    class="group block rounded-md p-4 focus-ring hover-card bg-card"
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

      <div class="flex items-start gap-1.5 shrink-0">
        <span class="type-mono-meta">{{ relativeTime(item.at) }}</span>

        <!--
          `.stop.prevent` because the whole card is the link. Without both,
          removing a row navigates to the thing you just removed.

          Shown on hover rather than always: every row having a visible dismiss
          turns a list you read into a list you tidy.
        -->
        <button
          v-if="item.hiddenAt"
          class="type-meta ink-accent hover:underline focus-ring rounded px-1"
          title="Put this back on the list"
          @click.stop.prevent="emit('restore', item)"
        >
          restore
        </button>
        <button
          v-else-if="removable"
          class="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
                 focus-ring rounded p-0.5 -m-0.5 ink-3 hover:ink-1"
          title="Remove from this list. Keeps the record — spend and ritual health still count it."
          aria-label="Remove from this list"
          @click.stop.prevent="emit('remove', item)"
        >
          <UIcon name="i-lucide-x" class="size-3.5" />
        </button>
      </div>
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
