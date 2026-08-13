<script setup lang="ts">
import { formatDuration, relativeTime } from '~/utils/time'
import type { RunOutcomeFilter, RunSource, RunSummary } from '~/composables/useRuns'
import type { QuotaReading, SpendData } from '~/components/SpendSummary.vue'

const { runs, loading, fetchRuns } = useRuns()

/** What all of this has cost, which no page has ever said. */
const spend = ref<SpendData | null>(null)

/** And what it cost against the limit that will actually stop you. */
const quota = ref<QuotaReading | null>(null)

/**
 * Whether this person pays per token. Inferred from whether they have set a
 * daily or per-run spending cap — someone on Pro or Max has no reason to, and
 * someone on the API almost certainly will. False means subscription mode:
 * quota leads, dollars are context.
 */
const apiMode = ref(false)

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
  $fetch<{ maxConcurrentRuns: number; dailyCapUsd: number; runCapUsd: number }>('/api/preferences')
    .then((prefs) => {
      concurrencyLimit.value = prefs.maxConcurrentRuns
      apiMode.value = Boolean(prefs.dailyCapUsd || prefs.runCapUsd)
    })
    .catch(() => {})

  $fetch<SpendData>('/api/spend', { query: { days: 30 } })
    .then((result) => { spend.value = result })
    .catch(() => { spend.value = null })

  // Never worth failing the page over: a reading, not a setting.
  $fetch<QuotaReading>('/api/quota')
    .then((result) => { quota.value = result })
    .catch(() => { quota.value = null })

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

/**
 * Running and waiting, told apart.
 *
 * "Queued" used to last a fraction of a second, so counting it as running cost
 * nothing. Now that unattended work waits its turn it can last minutes, and a
 * spinner over a run that has not started is the page saying something is
 * happening when nothing is.
 */
const running = computed(() => active.value.filter(r => r.status === 'running'))
const waiting = computed(() => active.value.filter(r => r.status === 'queued'))

/** Only read to explain a queue, so a failure here just means no explanation. */
const concurrencyLimit = ref(0)

function statusStyle(status: string) {
  switch (status) {
    case 'running':
    case 'queued':
      return { background: 'var(--accent-muted)', color: 'var(--accent)' }
    case 'completed':
      return { background: 'var(--success-tint)', color: 'var(--success)' }
    case 'failed':
      return { background: 'var(--error-tint)', color: 'var(--error)' }
    default:
      return { background: 'var(--badge-subtle-bg)', color: 'var(--text-tertiary)' }
  }
}

/**
 * A run refused a tool it needed still reports "completed". Labelling that
 * green next to a line saying the work did not happen is the badge lying.
 */
function badge(run: RunSummary) {
  const attention = { background: 'var(--accent-muted)', color: 'var(--accent)' }

  // "Needed you" is a claim about why it stopped, and a run that used up its
  // turns or its budget did not need anything from you — it needed more room.
  if (run.stoppedBy) return { label: 'ran out', style: attention }

  if (run.needsAttention || run.deniedTools?.length) {
    return { label: 'needed you', style: attention }
  }
  return { label: run.status, style: statusStyle(run.status) }
}

function sourceIcon(value: RunSource) {
  return SOURCES.find(s => s.value === value)?.icon ?? 'i-lucide-terminal'
}
</script>

<template>
  <div>
    <PageHeader title="Activity">
      <template #trailing>
        <span v-if="active.length" class="fs-mono font-mono ink-accent">
          {{ running.length }} running<template v-if="waiting.length">, {{ waiting.length }} waiting</template>
        </span>
      </template>
    </PageHeader>

    <div class="page-container page-container--measure py-4 space-y-6">
      <p class="type-body leading-relaxed">
        Everything Claude has run for you. Runs keep going if you close the tab — come back any time.
      </p>

      <SpendSummary v-if="spend" :spend="spend" :quota="quota" :api-mode="apiMode" />

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
            <UIcon
              :name="run.status === 'queued' ? 'i-lucide-hourglass' : 'i-lucide-loader-2'"
              class="size-3.5 shrink-0"
              :class="{ 'animate-spin': run.status !== 'queued' }"
              style="color: var(--accent);"
            />
            <span class="type-strong truncate flex-1 text-body">{{ run.title }}</span>
            <span v-if="run.status === 'queued'" class="font-mono fs-micro shrink-0 text-meta">waiting</span>
            <span class="font-mono fs-micro shrink-0 text-meta">{{ relativeTime(run.createdAt) }}</span>
          </NuxtLink>

          <!--
            Said here rather than left to be guessed. A run that has not started
            looks identical to one that is stuck, and the difference is the whole
            question you came to this page with.
          -->
          <p v-if="waiting.length" class="fs-mono text-meta">
            Work nobody is watching waits its turn
            <template v-if="concurrencyLimit"> — {{ concurrencyLimit }} at once</template>.
            A turn you type starts straight away. Change it in Settings.
          </p>
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
              class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0 mt-0.5"
              :style="badge(run).style"
            >
              {{ badge(run).label }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <!-- What started it, so a ritual is never mistaken for something you ran -->
                <UIcon :name="sourceIcon(run.source)" class="size-3 shrink-0 ink-4" />
                <span class="type-strong truncate text-body">{{ run.title }}</span>
                <span v-if="run.invocation" class="font-mono fs-micro shrink-0 ink-accent">
                  {{ run.invocation }}
                </span>
              </div>
              <!-- Why it is incomplete, not a guess. A run that used up its turns
                   was refused nothing, and saying otherwise sends you looking for
                   a permission problem that does not exist. -->
              <p v-if="run.needsAttention" class="fs-mono mt-0.5 flex items-center gap-1 ink-accent">
                <UIcon
                  :name="run.stoppedBy ? 'i-lucide-gauge' : 'i-lucide-shield-alert'"
                  class="size-3 shrink-0"
                />
                <template v-if="run.stoppedBy === 'turns'">Incomplete — it used up every turn it was allowed</template>
                <template v-else-if="run.stoppedBy === 'budget'">Incomplete — it reached the spending limit</template>
                <template v-else>
                  Incomplete — {{ (run.deniedTools || []).join(', ') || 'a tool' }} needed your approval
                </template>
              </p>
              <p v-else-if="run.preview" class="fs-mono truncate text-label mt-0.5">{{ run.preview }}</p>
              <p v-else-if="run.error" class="fs-mono truncate mt-0.5 ink-error">{{ run.error }}</p>
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
