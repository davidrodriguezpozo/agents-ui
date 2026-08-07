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

/**
 * The other answer to "how am I doing", and for most people the real one.
 *
 * Everything above counts dollars, which is the right unit for somebody paying
 * per token through the API and money a Pro or Max subscriber is never billed.
 * What stops their work is the rate limit, so it belongs beside the figure it
 * qualifies rather than three pages away.
 *
 * Collected from the SDK during runs that were happening anyway, which is why
 * it can be absent — nothing has run yet — or stale. Both are said rather than
 * dressed up as a current reading.
 */
export interface QuotaReading {
  known: boolean
  status?: 'allowed' | 'allowed_warning' | 'rejected'
  window?: string
  resetsAt?: number | null
  utilization?: number | null
  stale?: boolean
}

const props = defineProps<{ spend: SpendData; quota?: QuotaReading | null }>()

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

/**
 * The same fact as a sentence rather than a label. The compact form reads as a
 * fragment after a dot ("room on the weekly limit") and cannot simply be
 * prefixed — "You have close to the weekly limit" is not a sentence.
 */
const quotaSentence = computed(() => {
  const reading = quotaShown.value
  if (!reading) return ''

  const window = reading.window ?? 'usage'
  if (reading.status === 'rejected') return `Your ${window} limit is used up`
  if (reading.status === 'allowed_warning') return `You are close to your ${window} limit`
  return `You have room on your ${window} limit`
})

/** Only ever present when there is something to report, so never assumed. */
const quotaPercent = computed(() => {
  const value = quotaShown.value?.utilization
  if (typeof value !== 'number') return null
  // Sent as a fraction or as a percentage depending on the window; both are
  // clamped to something a bar can draw rather than guessed at.
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

        <!--
          Directly under the figure it qualifies. On a subscription the money
          above is notional and this is the thing that will actually stop work.
        -->
        <div v-if="quotaShown" class="flex items-center gap-1.5 mt-0.5">
          <span
            class="size-1.5 rounded-full shrink-0"
            :style="{ background: quotaTone }"
          />
          <span class="type-meta">
            {{ quotaText }}<template v-if="quotaShown.resetsAt">, resets {{ resetLabel(quotaShown.resetsAt) }}</template>
          </span>
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
      <!--
        What the figure above is and is not. Somebody on Pro or Max reading
        "$14.20 over 30 days" could reasonably think they had been charged it.
      -->
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
    </div>
  </div>
</template>
