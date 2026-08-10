<script setup lang="ts">
import { formatCost, relativeTime } from '~/utils/time'

/**
 * What this has been costing — or, for a subscriber, how much room is left.
 *
 * Two audiences read this card. Someone paying per token through the API cares
 * about the dollar figure; someone on Pro or Max never sees a bill and cares
 * about the rate limit that will actually stop their work. The `apiMode` prop
 * flips the hierarchy: dollars lead when true, quota and run counts lead when
 * false.
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

export interface QuotaReading {
  known: boolean
  status?: 'allowed' | 'allowed_warning' | 'rejected'
  window?: string
  resetsAt?: number | null
  utilization?: number | null
  stale?: boolean
}

const props = defineProps<{
  spend: SpendData
  quota?: QuotaReading | null
  apiMode?: boolean
}>()

const quotaShown = computed(() => (props.quota?.known && !props.quota.stale ? props.quota : null))

const quotaTone = computed(() => {
  switch (quotaShown.value?.status) {
    case 'rejected': return 'var(--error)'
    case 'allowed_warning': return 'var(--warning)'
    default: return 'var(--success)'
  }
})

const quotaText = computed(() => {
  const reading = quotaShown.value
  if (!reading) return ''

  const window = reading.window ?? 'usage'
  if (reading.status === 'rejected') return `${window} limit used up`
  if (reading.status === 'allowed_warning') return `close to the ${window} limit`
  return `room on the ${window} limit`
})

const quotaSentence = computed(() => {
  const reading = quotaShown.value
  if (!reading) return ''

  const window = reading.window ?? 'usage'
  if (reading.status === 'rejected') return `Your ${window} limit is used up`
  if (reading.status === 'allowed_warning') return `You are close to your ${window} limit`
  return `You have room on your ${window} limit`
})

const quotaPercent = computed(() => {
  const value = quotaShown.value?.utilization
  if (typeof value !== 'number') return null
  return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value))
})

function resetLabel(at: number | null | undefined): string {
  if (!at) return ''
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const SOURCE_LABELS: Record<string, string> = {
  ritual: 'Rituals',
  session: 'Sessions',
  agent: 'Agents',
  command: 'Commands',
}

const expanded = ref(false)

// ── API mode: bars scale by cost ──
const peakCost = computed(() => Math.max(...props.spend.byDay.map(d => d.cost), 0.0001))

function heightForCost(cost: number) {
  if (!cost) return 2
  return Math.max(3, Math.round((cost / peakCost.value) * 32))
}

// ── Subscription mode: bars scale by run count ──
const peakRuns = computed(() => Math.max(...props.spend.byDay.map(d => d.runs), 1))

function heightForRuns(runs: number) {
  if (!runs) return 2
  return Math.max(3, Math.round((runs / peakRuns.value) * 32))
}

function dayLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}

const totalRuns = computed(() => props.spend.bySource.reduce((sum, s) => sum + s.runs, 0))
</script>

<template>
  <div class="rounded-lg overflow-hidden" style="border: 1px solid var(--border-subtle);">
    <button
      class="w-full px-4 py-3 flex items-center gap-4 text-left hover-bg transition-all"
      @click="expanded = !expanded"
    >
      <div class="flex-1 min-w-0">
        <!-- ── Subscription mode: quota and runs lead ── -->
        <template v-if="!apiMode">
          <div v-if="quotaShown" class="flex items-center gap-1.5">
            <span
              class="size-1.5 rounded-full shrink-0"
              :style="{ background: quotaTone }"
            />
            <span class="type-strong text-body">
              {{ quotaText }}
            </span>
            <span v-if="quotaShown.resetsAt" class="type-meta">
              · resets {{ resetLabel(quotaShown.resetsAt) }}
            </span>
          </div>
          <div class="flex items-baseline gap-2" :class="{ 'mt-0.5': quotaShown }">
            <span :class="quotaShown ? 'type-meta' : 'type-strong text-body'">
              {{ spend.runs }} run{{ spend.runs === 1 ? '' : 's' }} over {{ spend.days }} days
            </span>
          </div>
        </template>

        <!-- ── API mode: dollars lead (original layout) ── -->
        <template v-else>
          <div class="flex items-baseline gap-2">
            <span class="type-strong text-body">{{ formatCost(spend.total) ?? '$0.00' }}</span>
            <span class="type-meta">
              over {{ spend.days }} days · {{ spend.runs }} run{{ spend.runs === 1 ? '' : 's' }}
            </span>
          </div>
          <div v-if="spend.total > 0" class="type-meta">
            about {{ formatCost(spend.monthlyEstimate) }} a month at this rate
          </div>

          <div v-if="quotaShown" class="flex items-center gap-1.5 mt-0.5">
            <span
              class="size-1.5 rounded-full shrink-0"
              :style="{ background: quotaTone }"
            />
            <span class="type-meta">
              {{ quotaText }}<template v-if="quotaShown.resetsAt">, resets {{ resetLabel(quotaShown.resetsAt) }}</template>
            </span>
          </div>
        </template>
      </div>

      <!-- Sparkline: by runs in subscription mode, by cost in API mode -->
      <div
        class="flex items-end gap-px h-8 shrink-0"
        :title="apiMode ? `Busiest day: ${formatCost(peakCost)}` : `Busiest day: ${peakRuns} runs`"
      >
        <span
          v-for="day in spend.byDay"
          :key="day.date"
          class="w-1.5 rounded-sm"
          :style="{
            height: `${apiMode ? heightForCost(day.cost) : heightForRuns(day.runs)}px`,
            background: (apiMode ? day.cost : day.runs) ? 'var(--accent)' : 'var(--border-subtle)',
          }"
          :title="apiMode
            ? `${dayLabel(day.date)} — ${formatCost(day.cost) ?? 'nothing'}`
            : `${dayLabel(day.date)} — ${day.runs} run${day.runs === 1 ? '' : 's'}`
          "
        />
      </div>

      <UIcon
        :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        class="size-4 shrink-0 text-meta"
      />
    </button>

    <div v-if="expanded" class="px-4 py-3 space-y-4" style="border-top: 1px solid var(--border-subtle);">

      <!-- ── Subscription mode expanded ── -->
      <template v-if="!apiMode">

        <!-- Quota detail — the thing that actually matters -->
        <div class="space-y-1.5">
          <div class="text-section-label">Your limit</div>

          <template v-if="quotaShown">
            <div v-if="quotaPercent !== null" class="flex items-center gap-3">
              <div class="flex-1 h-1.5 rounded-full overflow-hidden" style="background: var(--surface-raised);">
                <div
                  class="h-full rounded-full"
                  :style="{ width: `${quotaPercent}%`, background: quotaTone }"
                />
              </div>
              <span class="type-mono-meta shrink-0">{{ Math.round(quotaPercent) }}%</span>
            </div>
            <p class="type-meta">
              {{ quotaSentence }}<template v-if="quotaShown.resetsAt">, resetting at
              {{ resetLabel(quotaShown.resetsAt) }}</template>.
            </p>
          </template>

          <p v-else-if="quota?.known && quota.stale" class="type-meta">
            Last heard too long ago to rely on. It refreshes on the next run.
          </p>
          <p v-else class="type-meta">
            Nothing heard yet. This arrives with the next run rather than being fetched, so it
            shows up once something has gone through.
          </p>
        </div>

        <!-- Where the runs went -->
        <div v-if="spend.runs" class="space-y-1.5">
          <div class="text-section-label">Where they went</div>
          <div v-for="entry in spend.bySource" :key="entry.source" class="flex items-center gap-3">
            <span class="type-detail w-20 shrink-0">{{ SOURCE_LABELS[entry.source] ?? entry.source }}</span>
            <div class="flex-1 h-1.5 rounded-full overflow-hidden" style="background: var(--surface-raised);">
              <div
                class="h-full rounded-full"
                :style="{ width: `${(entry.runs / totalRuns) * 100}%`, background: 'var(--accent)' }"
              />
            </div>
            <span class="type-mono-meta shrink-0 w-16 text-right">{{ entry.runs }} run{{ entry.runs === 1 ? '' : 's' }}</span>
          </div>
        </div>

        <!-- Most active runs -->
        <div v-if="spend.top.length" class="space-y-1">
          <div class="text-section-label">Most active</div>
          <NuxtLink
            v-for="entry in spend.top"
            :key="entry.id"
            :to="`/runs/${entry.id}`"
            class="flex items-center gap-3 px-2 py-1 -mx-2 rounded hover-row focus-ring"
          >
            <span class="type-detail flex-1 truncate">{{ entry.title }}</span>
            <span class="type-mono-meta shrink-0">{{ relativeTime(entry.at) }}</span>
          </NuxtLink>
        </div>

        <!-- Equivalent API cost — available but clearly secondary -->
        <div v-if="spend.total > 0" class="space-y-1">
          <div class="text-section-label">Equivalent API cost</div>
          <p class="type-meta">
            The same work would have cost {{ formatCost(spend.total) }} through the API
            (about {{ formatCost(spend.monthlyEstimate) }}/month at this rate).
            On your subscription this is not billed.
          </p>
        </div>
      </template>

      <!-- ── API mode expanded (original layout) ── -->
      <template v-else>
        <div class="space-y-1.5">
          <div class="text-section-label">Against your limit</div>

          <template v-if="quotaShown">
            <div v-if="quotaPercent !== null" class="flex items-center gap-3">
              <div class="flex-1 h-1.5 rounded-full overflow-hidden" style="background: var(--surface-raised);">
                <div
                  class="h-full rounded-full"
                  :style="{ width: `${quotaPercent}%`, background: quotaTone }"
                />
              </div>
              <span class="type-mono-meta shrink-0">{{ Math.round(quotaPercent) }}%</span>
            </div>
            <p class="type-meta">
              {{ quotaSentence }}<template v-if="quotaShown.resetsAt">, resetting at
              {{ resetLabel(quotaShown.resetsAt) }}</template>. On a Claude subscription this is
              what stops work, rather than the figure above — that is what the same runs would
              have cost through the API.
            </p>
          </template>

          <p v-else-if="quota?.known && quota.stale" class="type-meta">
            Last heard too long ago to rely on. It refreshes on the next run.
          </p>
          <p v-else class="type-meta">
            Nothing heard yet. This arrives with the next run rather than being fetched, so it
            shows up once something has gone through.
          </p>
        </div>

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
      </template>
    </div>
  </div>
</template>
