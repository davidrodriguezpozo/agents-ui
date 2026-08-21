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
/** A bar in the left gutter, not a border round the row. See `.work-row`. */
const accent = computed(() => {
  if (props.item.status === 'needs-you') return { '--row-marker': 'var(--accent)' }
  if (props.item.status === 'failed') return { '--row-marker': 'var(--error)' }
  return undefined
})
</script>

<template>
  <NuxtLink
    :to="item.to"
    data-row
    class="group work-row focus-ring"
    :style="accent"
  >
    <!--
      A run has no workspace to judge, so its outcome is the glyph: a colour
      and a filled/hollow ring, on the same axis as a session's. The word is in
      the title attribute, as it is there.
    -->
    <span
      class="status-glyph"
      :class="item.status === 'running' ? 'status-glyph--progress' : 'status-glyph--done'"
      :style="{ color: look.colour }"
      :title="item.outcome"
      :aria-label="item.outcome"
      role="img"
    />

    <span class="work-row__title">{{ item.title }}</span>

    <span class="work-row__summary">{{ item.detail }}</span>

    <span class="work-row__meta">
      <span v-if="item.durationMs" class="flex items-center gap-1">
        <UIcon name="i-lucide-timer" class="size-3 shrink-0" />
        {{ formatDuration(item.durationMs) }}
      </span>
      <span v-if="item.costUsd" class="flex items-center gap-1">
        <UIcon name="i-lucide-coins" class="size-3 shrink-0" />
        {{ formatCost(item.costUsd) }}
      </span>

      <!--
        `.stop.prevent` because the whole row is the link. Without both,
        removing a row navigates to the thing you just removed.

        Shown on hover rather than always: every row having a visible dismiss
        turns a list you read into a list you tidy.
      -->
      <button
        v-if="item.hiddenAt"
        class="ink-accent hover:underline focus-ring rounded px-1"
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
    </span>

    <!-- What set it going, which is the run equivalent of a session's branch -->
    <span class="work-row__branch" :title="origin?.label ?? item.origin">
      <UIcon :name="origin?.icon ?? 'i-lucide-terminal'" class="size-2.5 shrink-0" />
      <span class="work-row__branch-name">{{ origin?.label ?? item.origin }}</span>
    </span>

    <span class="work-row__when">{{ relativeTime(item.at) }}</span>
  </NuxtLink>
</template>
