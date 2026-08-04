<script setup lang="ts">
import { formatDuration, relativeTime } from '~/utils/time'
import type { RunOutcomeFilter, RunSource, RunSummary } from '~/composables/useRuns'
import type { SpendData } from '~/components/SpendSummary.vue'

const { runs, loading, fetchRuns } = useRuns()

/** What all of this has cost, which no page has ever said. */
const spend = ref<SpendData | null>(null)

const search = ref('')
const source = ref<RunSource | null>(null)
const outcome = ref<RunOutcomeFilter | null>(null)

/** What started it, which is what people remember when they come looking. */
const SOURCES: { value: RunSource; label: string; icon: string }[] = [
  { value: 'ritual', label: 'rituals', icon: 'i-lucide-alarm-clock' },
  { value: 'session', label: 'sessions', icon: 'i-lucide-git-branch' },
  { value: 'agent', label: 'agents', icon: 'i-lucide-bot' },
  { value: 'command', label: 'commands', icon: 'i-lucide-terminal' },
]

const OUTCOMES: { value: RunOutcomeFilter; label: string }[] = [
  { value: 'running', label: 'running' },
  { value: 'completed', label: 'worked' },
  { value: 'attention', label: 'needed you' },
  { value: 'failed', label: 'failed' },
  { value: 'cancelled', label: 'stopped' },
]

const query = computed(() => ({
  q: search.value.trim(),
  source: source.value ?? undefined,
  outcome: outcome.value ?? undefined,
}))

const isFiltered = computed(() => Boolean(query.value.q || query.value.source || query.value.outcome))

let poll: ReturnType<typeof setInterval> | null = null
let debounce: ReturnType<typeof setTimeout> | null = null

// Typing shouldn't be a request per keystroke, but the filters have to reach
// the server: the list is capped, so narrowing it here would search one page.
watch(query, () => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => fetchRuns(query.value), 200)
})

onMounted(async () => {
  // Independent of the filters: the total is about the whole log, not the
  // slice you happen to be looking at.
  $fetch<SpendData>('/api/spend', { query: { days: 30 } })
    .then((result) => { spend.value = result })
    .catch(() => { spend.value = null })

  await fetchRuns(query.value)
  // Cheap refresh so in-flight runs tick over without a socket.
  poll = setInterval(() => {
    if (runs.value.some(r => r.status === 'running' || r.status === 'queued')) fetchRuns(query.value)
  }, 4000)
})

onUnmounted(() => {
  if (poll) clearInterval(poll)
  if (debounce) clearTimeout(debounce)
})

function clearFilters() {
  search.value = ''
  source.value = null
  outcome.value = null
}

const active = computed(() => runs.value.filter(r => r.status === 'running' || r.status === 'queued'))
const finished = computed(() => runs.value.filter(r => r.status !== 'running' && r.status !== 'queued'))

function statusStyle(status: string) {
  switch (status) {
    case 'running':
    case 'queued':
      return { background: 'var(--accent-muted)', color: 'var(--accent)' }
    case 'completed':
      return { background: 'rgba(34,197,94,0.12)', color: 'rgb(34,197,94)' }
    case 'failed':
      return { background: 'rgba(248,113,113,0.12)', color: 'var(--error)' }
    default:
      return { background: 'var(--badge-subtle-bg)', color: 'var(--text-tertiary)' }
  }
}

/**
 * A run refused a tool it needed still reports "completed". Labelling that
 * green next to a line saying the work did not happen is the badge lying.
 */
function badge(run: RunSummary) {
  if (run.needsAttention || run.deniedTools?.length) {
    return { label: 'needed you', style: { background: 'var(--accent-muted)', color: 'var(--accent)' } }
  }
  return { label: run.status, style: statusStyle(run.status) }
}

function sourceIcon(value: RunSource) {
  return SOURCES.find(s => s.value === value)?.icon ?? 'i-lucide-terminal'
}
</script>

<template>
  <div>
    <PageHeader width="narrow" title="Activity">
      <template #trailing>
        <span v-if="active.length" class="text-[11px] font-mono" style="color: var(--accent);">
          {{ active.length }} running
        </span>
      </template>
    </PageHeader>

    <div class="page-container page-container--narrow py-4 space-y-6">
      <p class="type-body leading-relaxed">
        Everything Claude has run for you. Runs keep going if you close the tab — come back any time.
      </p>

      <SpendSummary v-if="spend" :spend="spend" />

      <!-- Searching the whole log, not the page of it that happens to be loaded -->
      <div class="space-y-2">
        <input
          v-model="search"
          class="field-search w-full"
          placeholder="Search what was run, and what it said…"
        />
        <div class="flex items-center gap-2 flex-wrap">
          <div class="pill-picker">
            <button
              type="button"
              class="pill-picker__option"
              :class="{ 'pill-picker__option--active': !source }"
              @click="source = null"
            >
              everything
            </button>
            <button
              v-for="option in SOURCES"
              :key="option.value"
              type="button"
              class="pill-picker__option"
              :class="{ 'pill-picker__option--active': source === option.value }"
              @click="source = option.value"
            >
              {{ option.label }}
            </button>
          </div>

          <div class="pill-picker">
            <button
              type="button"
              class="pill-picker__option"
              :class="{ 'pill-picker__option--active': !outcome }"
              @click="outcome = null"
            >
              any outcome
            </button>
            <button
              v-for="option in OUTCOMES"
              :key="option.value"
              type="button"
              class="pill-picker__option"
              :class="{ 'pill-picker__option--active': outcome === option.value }"
              @click="outcome = option.value"
            >
              {{ option.label }}
            </button>
          </div>

          <button
            v-if="isFiltered"
            class="type-meta px-2 py-1 rounded hover-bg focus-ring"
            @click="clearFilters"
          >
            Clear
          </button>
        </div>
      </div>

      <div v-if="loading && !runs.length" class="space-y-1">
        <SkeletonRow v-for="i in 4" :key="i" />
      </div>

      <template v-else-if="runs.length">
        <div v-if="active.length" class="space-y-2">
          <h2 class="text-section-label">In progress</h2>
          <NuxtLink
            v-for="run in active"
            :key="run.id"
            :to="`/runs/${run.id}`"
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg group focus-ring hover-row"
            style="border: 1px solid var(--accent-glow); background: var(--accent-muted);"
          >
            <UIcon name="i-lucide-loader-2" class="size-3.5 shrink-0 animate-spin" style="color: var(--accent);" />
            <span class="type-strong truncate flex-1 text-body">{{ run.title }}</span>
            <span class="font-mono text-[10px] shrink-0 text-meta">{{ relativeTime(run.createdAt) }}</span>
          </NuxtLink>
        </div>

        <div v-if="finished.length" class="space-y-2">
          <h2 class="text-section-label">Earlier</h2>
          <NuxtLink
            v-for="run in finished"
            :key="run.id"
            :to="`/runs/${run.id}`"
            class="flex items-start gap-3 px-3 py-2.5 rounded-md group focus-ring hover-row"
          >
            <span
              class="text-[9px] font-mono px-1.5 py-px rounded-full shrink-0 mt-0.5"
              :style="badge(run).style"
            >
              {{ badge(run).label }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <!-- What started it, so a ritual is never mistaken for something you ran -->
                <UIcon :name="sourceIcon(run.source)" class="size-3 shrink-0" style="color: var(--text-disabled);" />
                <span class="type-strong truncate text-body">{{ run.title }}</span>
                <span v-if="run.invocation" class="font-mono text-[10px] shrink-0" style="color: var(--accent);">
                  {{ run.invocation }}
                </span>
              </div>
              <p v-if="run.needsAttention" class="text-[11px] mt-0.5 flex items-center gap-1" style="color: var(--accent);">
                <UIcon name="i-lucide-shield-alert" class="size-3 shrink-0" />
                Incomplete — {{ (run.deniedTools || []).join(', ') || 'a tool' }} needed your approval
              </p>
              <p v-else-if="run.preview" class="text-[11px] truncate text-label mt-0.5">{{ run.preview }}</p>
              <p v-else-if="run.error" class="text-[11px] truncate mt-0.5" style="color: var(--error);">{{ run.error }}</p>
            </div>
            <div class="flex items-center gap-2.5 shrink-0 type-mono-meta">
              <span v-if="formatDuration(run.durationMs)">{{ formatDuration(run.durationMs) }}</span>
              <span>{{ relativeTime(run.createdAt) }}</span>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </div>
          </NuxtLink>
        </div>
      </template>

      <!-- "Nothing matches" and "nothing has happened" are different answers -->
      <EmptyState
        v-else-if="isFiltered"
        variant="inset"
        icon="i-lucide-search-x"
        title="Nothing matches"
        description="No run fits these filters. Widen them, or clear them to see everything again."
        action-label="Clear filters"
        @action="clearFilters"
      />

      <EmptyState
        v-else
        icon="i-lucide-activity"
        title="Nothing has run yet"
        description="When Claude does something for you — a command you run, or a daily ritual firing on its own — it shows up here with the result."
        action-label="See what you can do"
        action-to="/"
      />
    </div>
  </div>
</template>
