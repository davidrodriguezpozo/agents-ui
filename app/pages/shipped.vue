<script setup lang="ts">
/**
 * The page you can turn a laptop around and show somebody.
 *
 * Everything else here is for the person running the work. This is for the
 * person who asked for it: one sentence per thing that shipped, who shipped it,
 * which repository, and whether the checks were green when it went in. No branch
 * names, no commits, no dollars, no token counts — not hidden behind a toggle,
 * simply not on the page. The technical half is one press away, on the session.
 *
 * Two pieces of copy are doing real work:
 *
 *   - **A day with nothing says so.** Every day in the window is listed, empty
 *     ones included, because a list that skips days reads as a list still
 *     loading — and "nothing shipped on Tuesday" is a fact somebody is entitled
 *     to read.
 *   - **The verdict is on every row.** A board that only says what shipped is a
 *     board that flatters. "Merged with the checks failing" is the one technical
 *     fact a non-engineer genuinely needs, and it names who decided.
 */

interface Item {
  sessionId: string
  what: string
  fromTitle: boolean
  who: string | null
  where: string | null
  verdict: 'green' | 'overridden' | 'red' | 'unchecked'
  at: number
}

interface Day {
  day: string
  at: number
  items: Item[]
}

const days = ref<Day[]>([])
const summary = ref('')
const windowDays = ref(14)

const WINDOWS = [
  { value: 7, label: 'the last week' },
  { value: 14, label: 'the last fortnight' },
  { value: 30, label: 'the last month' },
]
const loading = ref(true)

/**
 * What each verdict says, in words rather than a colour.
 *
 * A tick and a cross are read differently by different people, and one of the
 * four states — nothing was ever run — has no obvious icon at all.
 */
const VERDICTS: Record<Item['verdict'], { says: string; tone: string }> = {
  'green': { says: 'checks passed', tone: 'var(--success)' },
  'overridden': { says: 'merged with the checks failing', tone: 'var(--warning)' },
  'red': { says: 'checks were not passing', tone: 'var(--error)' },
  'unchecked': { says: 'no checks were run', tone: 'var(--text-tertiary)' },
}

async function load(request = windowDays.value) {
  loading.value = true
  try {
    const board = await $fetch<{ days: Day[]; summary: string; windowDays: number }>(
      '/api/shipped',
      { query: { days: request } },
    )
    days.value = board.days
    summary.value = board.summary
    windowDays.value = board.windowDays
  } finally {
    loading.value = false
  }
}

onMounted(() => load())

/** Today and yesterday by name; everything else by date, in the reader's format. */
function dayLabel(at: number): string {
  const midnight = new Date().setHours(0, 0, 0, 0)

  if (at === midnight) return 'Today'
  if (at === midnight - 86_400_000) return 'Yesterday'

  return new Date(at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div>
    <PageHeader title="Shipped">
      <template #right>
        <FieldSelect
          :model-value="windowDays"
          :options="WINDOWS"
          variant="inline"
          align="end"
          aria-label="How far back to show"
          @update:model-value="value => load(Number(value))"
        />
      </template>
    </PageHeader>

    <div class="page-container page-container--measure py-4 space-y-6">
      <p class="fs-sm text-meta">
        <template v-if="loading">Reading…</template>
        <template v-else>{{ summary }}</template>
      </p>

      <section v-for="day in days" :key="day.day" class="space-y-2">
        <h2 class="text-section-label">{{ dayLabel(day.at) }}</h2>

        <!-- Said plainly, in the same voice as a day with something in it. -->
        <p v-if="!day.items.length" class="type-meta pl-1">Nothing shipped.</p>

        <ul v-else class="space-y-2">
          <li v-for="item in day.items" :key="item.sessionId">
            <!--
              The row *is* the link, which does three things at once: it is
              walkable with the same keys as every other list here, Enter opens it
              because the browser opens a link, and there is nothing else on it to
              press — which is how this page stays read-only by construction
              rather than by discipline.

              What it opens is the technical half: the branch, the diff, the cost,
              what the checks actually said. None of that is on this page.
            -->
            <NuxtLink
              data-row
              data-row-open
              :to="`/sessions/${item.sessionId}`"
              class="row focus-ring"
            >
              <span class="type-strong text-body">{{ item.what }}</span>
              <span class="type-meta">
                <template v-if="item.who">{{ item.who }} · </template>
                <template v-if="item.where">{{ item.where }} · </template>
                {{ timeLabel(item.at) }}
                ·
                <span :style="{ color: VERDICTS[item.verdict].tone }">{{ VERDICTS[item.verdict].says }}</span>
                <template v-if="item.fromTitle"> · no summary was written</template>
              </span>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--surface-raised);
  color: inherit;
  text-decoration: none;
}
.row:hover { background: var(--surface-hover, var(--surface-raised)); }
</style>
