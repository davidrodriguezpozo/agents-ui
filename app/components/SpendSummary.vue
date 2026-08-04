<script setup lang="ts">
import { formatCost, relativeTime } from '~/utils/time'

/**
 * What this has been costing.
 *
 * Every run has always known what it cost; nothing added them up. One run at a
 * time answers "was that expensive?" and never "what am I spending?" — which is
 * the question worth asking about work that runs on a schedule without anyone
 * watching it.
 */

export interface SpendData {
  days: number
  total: number
  runs: number
  byDay: { date: string; cost: number; runs: number }[]
  bySource: { source: string; cost: number; runs: number }[]
  top: { id: string; title: string; cost: number; source: string; at: number }[]
  monthlyEstimate: number
}

const props = defineProps<{ spend: SpendData }>()

const SOURCE_LABELS: Record<string, string> = {
  ritual: 'Rituals',
  session: 'Sessions',
  agent: 'Agents',
  command: 'Commands',
}

const expanded = ref(false)

/** Bars are relative to the busiest day, which is the only useful scale. */
const peak = computed(() => Math.max(...props.spend.byDay.map(d => d.cost), 0.0001))

function heightFor(cost: number) {
  if (!cost) return 2
  return Math.max(3, Math.round((cost / peak.value) * 32))
}

function dayLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="rounded-lg overflow-hidden" style="border: 1px solid var(--border-subtle);">
    <button
      class="w-full px-4 py-3 flex items-center gap-4 text-left hover-bg transition-all"
      @click="expanded = !expanded"
    >
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-2">
          <span class="type-strong text-body">{{ formatCost(spend.total) ?? '$0.00' }}</span>
          <span class="type-meta">
            over {{ spend.days }} days · {{ spend.runs }} run{{ spend.runs === 1 ? '' : 's' }}
          </span>
        </div>
        <div v-if="spend.total > 0" class="type-meta">
          about {{ formatCost(spend.monthlyEstimate) }} a month at this rate
        </div>
      </div>

      <!-- The shape of it, which is what tells you something changed -->
      <div class="flex items-end gap-px h-8 shrink-0" :title="`Busiest day: ${formatCost(peak)}`">
        <span
          v-for="day in spend.byDay"
          :key="day.date"
          class="w-1.5 rounded-sm"
          :style="{
            height: `${heightFor(day.cost)}px`,
            background: day.cost ? 'var(--accent)' : 'var(--border-subtle)',
          }"
          :title="`${dayLabel(day.date)} — ${formatCost(day.cost) ?? 'nothing'}`"
        />
      </div>

      <UIcon
        :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        class="size-4 shrink-0 text-meta"
      />
    </button>

    <div v-if="expanded" class="px-4 py-3 space-y-4" style="border-top: 1px solid var(--border-subtle);">
      <div v-if="!spend.runs" class="type-meta">
        Nothing with a recorded cost in this window.
      </div>

      <template v-else>
        <div class="space-y-1.5">
          <div class="text-section-label">Where it went</div>
          <div v-for="entry in spend.bySource" :key="entry.source" class="flex items-center gap-3">
            <span class="type-detail w-20 shrink-0">{{ SOURCE_LABELS[entry.source] ?? entry.source }}</span>
            <div class="flex-1 h-1.5 rounded-full overflow-hidden" style="background: var(--surface-raised);">
              <div
                class="h-full rounded-full"
                :style="{ width: `${(entry.cost / spend.total) * 100}%`, background: 'var(--accent)' }"
              />
            </div>
            <span class="type-mono-meta shrink-0 w-16 text-right">{{ formatCost(entry.cost) }}</span>
          </div>
        </div>

        <div class="space-y-1">
          <div class="text-section-label">Most expensive</div>
          <NuxtLink
            v-for="entry in spend.top"
            :key="entry.id"
            :to="`/runs/${entry.id}`"
            class="flex items-center gap-3 px-2 py-1 -mx-2 rounded hover-row focus-ring"
          >
            <span class="type-detail flex-1 truncate">{{ entry.title }}</span>
            <span class="type-mono-meta shrink-0">{{ relativeTime(entry.at) }}</span>
            <span class="type-mono-meta shrink-0 w-16 text-right" style="color: var(--accent);">
              {{ formatCost(entry.cost) }}
            </span>
          </NuxtLink>
        </div>
      </template>
    </div>
  </div>
</template>
