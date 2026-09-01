<script setup lang="ts">
import { buildNowQueue, NOW_LOOK, type NowItem } from '~/utils/nowQueue'
import { errorMessage } from '~/utils/errors'
import { agedFor, relativeTime } from '~/utils/time'
import type { Arrival } from '~/composables/useQuickActions'

/**
 * What needs you, in one place, ranked.
 *
 * The four red counters in the sidebar were an admission that this view was
 * missing: blocked sessions lived on /sessions, reviews on /land, failing
 * rituals on /schedules, and the morning report on /. You had to visit four
 * pages to find out whether your morning was going to go well.
 *
 * Every row resolves from here or goes straight to the one place it can be
 * resolved. Reporting a blocked ritual and then sending you elsewhere to do
 * something about it is most of a feature.
 */
const { digest, loading: digestLoading, load: loadDigest } = useDigest()
const { all: pulls, loading: pullsLoading, work } = useGithubPulls()
const { attention, refresh: refreshAttention } = useAttention()
const { allowRules } = useSchedules()
const {
  sources: inboxSources, refreshing, load: loadInbox, refresh: refreshInbox, setSchedule,
} = useInbox()
const { create: createSession, sessions, fetchAll: fetchSessions } = useSessions()
/** Where a resolved row leaves you, on the same switch Land reads. */
const { load: loadQuickActions, arrive } = useQuickActions()
const toast = useToast()

onMounted(() => {
  if (!digest.value) void loadDigest()
  void loadInbox()
  void loadQuickActions()
  // Needed to answer "have I already started on this pull request?" — see
  // `NowInput.sessions`. `app.vue` fetches them at start-up, so this is usually
  // a re-read of a list already in memory; it matters on a hard reload of `/`.
  void fetchSessions()
})

/** Resolved locally so a row disappears the moment you deal with it. */
const settled = ref<Set<string>>(new Set())
const busy = ref<string | null>(null)

/**
 * Only this project's, which is what `workersOnPull` requires of its caller: a
 * session knows its `repoDir` and a pull request, by the time it reaches here,
 * does not — so #482 in one repository would otherwise match a session on #482
 * in another.
 */
const sessionsHere = computed(() => sessions.value.filter(s => s.inCurrentProject))

const items = computed(() =>
  buildNowQueue({
    attention: attention.value.items,
    pulls: pulls.value,
    digest: digest.value,
    inbox: inboxSources.value,
    sessions: sessionsHere.value,
  }).filter(item => !settled.value.has(item.key)),
)

const loading = computed(() => (digestLoading.value || pullsLoading.value) && !digest.value)

/**
 * Sources that could not be looked at, so "nothing is waiting" is not claimed
 * over the top of them.
 *
 * This is the same mistake as the badge and the queue disagreeing, made once
 * more: the empty state was a fixed sentence rather than a reading of the same
 * inputs the list is built from. It said "Nothing is waiting on you. No session
 * is blocked, no ritual has broken, and nothing is sitting unreviewed" while a
 * Notion refresh had been refused the tools it needed and knew nothing at all.
 *
 * An all-clear is a claim. It needs to be true of everything it covers.
 */
const unchecked = computed(() => inboxSources.value.filter(source => source.error))

/**
 * Refreshing takes a minute or two, so it says what it is doing and what
 * happened — never a spinner that stops with no verdict.
 */
async function onRefresh(key: string, label: string) {
  const result = await refreshInbox(key)
  if (result.ok) return
  toast.add({ title: `Could not refresh ${label}`, description: result.reason, color: 'error' })
}

/**
 * Off, or 08:00 — deliberately not a time picker.
 *
 * The choice worth offering is "before I start work" versus "only when I ask".
 * Anybody who wants 06:45 can have it from the API; putting a clock widget in a
 * footer would be the interface arguing with itself about what matters.
 */
const DAILY_AT = '08:00'

async function onSchedule(source: { key: string; label: string; refreshAt?: string }) {
  const wanted = source.refreshAt ? null : DAILY_AT
  const result = await setSchedule(source.key, wanted)

  if (!result.ok) {
    toast.add({ title: `Could not schedule ${source.label}`, description: result.reason, color: 'error' })
    return
  }

  toast.add({
    title: wanted ? `${source.label} will refresh at ${DAILY_AT}` : `${source.label} is manual again`,
    description: wanted
      ? 'Once a day, before you start. It takes about a minute and runs on its own.'
      : 'It will only look when you press refresh.',
    color: 'success',
  })
}

/** The same words either way a row is resolved into a session. */
function startedOn(item: NowItem): Arrival {
  return {
    title: `Working on ${item.title}`,
    description: 'A session has it in its own worktree. It is on Work until it finishes.',
  }
}

async function resolve(item: NowItem) {
  if (!item.action) return
  busy.value = item.key

  try {
    if (item.action.kind === 'allow-rules') {
      await allowRules(String(item.action.target), item.action.rules ?? [])
      settled.value = new Set([...settled.value, item.key])
      // The badge counts a failing streak, which granting a rule does not
      // clear — but the next run will. Re-read so the two stay in step.
      void refreshAttention()
      toast.add({
        title: `${item.title} can do that now`,
        description: 'It will not stop for these again. Nothing else was granted.',
        color: 'success',
      })
      return
    }

    // Resolving a row is a dispatch, not a decision to go and watch one — the
    // whole point of the queue is getting through it — so where it leaves you is
    // the preference Land reads, and the toast carries the way in.
    if (item.action.kind === 'work-on-pull') {
      const session = await work(Number(item.action.target))
      settled.value = new Set([...settled.value, item.key])
      if (session?.id) await arrive(session.id, startedOn(item))
      return
    }

    // The payoff of having an inbox rather than a dashboard: the ticket becomes
    // Claude working on it, in its own checkout.
    if (item.action.kind === 'work-on-inbox') {
      const session = await createSession(item.action.prompt ?? String(item.action.target))
      settled.value = new Set([...settled.value, item.key])
      if (session?.id) await arrive(session.id, startedOn(item))
    }
  } catch (e) {
    toast.add({ title: 'Could not do that', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <section aria-labelledby="now-queue-title">
    <div class="flex items-baseline gap-2.5 mb-3">
      <h2 id="now-queue-title" class="text-section-label">Needs you</h2>
      <span v-if="items.length" class="type-mono-meta">{{ items.length }}</span>
    </div>

    <div v-if="loading" class="space-y-1">
      <SkeletonRow v-for="i in 3" :key="i" />
    </div>

    <!--
      Said plainly. An empty list on the one screen that is meant to tell you
      whether anything is wrong reads as a page that failed to load.

      But only said when it is true of everything: a source that could not be
      looked at gets a different sentence and a different icon, because "nothing
      is waiting on you" over the top of an inbox that knows nothing is the one
      failure that would make somebody stop trusting this screen.
    -->
    <div
      v-else-if="!items.length"
      class="rounded-lg px-4 py-5 flex items-start gap-3 bg-card"
    >
      <UIcon
        :name="unchecked.length ? 'i-lucide-alert-triangle' : 'i-lucide-check'"
        class="size-4 shrink-0 mt-0.5"
        :style="{ color: unchecked.length ? 'var(--warning)' : 'var(--success)' }"
      />
      <div v-if="unchecked.length">
        <p class="type-strong">
          Nothing local is waiting — but {{ unchecked.map(s => s.label).join(' and ') }}
          could not be checked.
        </p>
        <p class="type-detail mt-0.5">
          No session is blocked, no ritual has broken, and nothing is sitting unreviewed.
          {{ unchecked[0]?.error }}
        </p>
      </div>
      <div v-else>
        <p class="type-strong">Nothing is waiting on you.</p>
        <p class="type-detail mt-0.5">
          No session is blocked, no ritual has broken, and nothing is sitting unreviewed.
        </p>
      </div>
    </div>

    <ul v-else class="rounded-lg overflow-hidden bg-card divide-y" style="border-color: var(--border-subtle);">
      <li
        v-for="item in items"
        :key="item.key"
        class="flex items-start gap-3 px-4 py-3 hover-row"
      >
        <UIcon
          :name="NOW_LOOK[item.kind].icon"
          class="size-4 shrink-0 mt-0.5"
          :style="{ color: NOW_LOOK[item.kind].colour }"
        />

        <div class="flex-1 min-w-0">
          <!-- The whole row is the link; the action beside it is the shortcut. -->
          <component
            :is="item.href ? 'a' : 'NuxtLink'"
            :to="item.href ? undefined : item.to"
            :href="item.href"
            :target="item.href ? '_blank' : undefined"
            data-row
            class="type-strong block truncate focus-ring rounded"
          >
            {{ item.title }}
          </component>
          <p class="type-detail mt-0.5">{{ item.because }}</p>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <!--
            For a live row, when. For one that has gone quiet, how long — and
            not hidden on a narrow screen, because on that row it is the fact
            that decides whether you look at it at all. "Apr 20" in a right-hand
            column is arithmetic; "quiet 4mo" is an answer.
          -->
          <span
            v-if="item.at && item.quiet"
            class="type-mono-meta text-meta"
            :title="`Nothing has moved on it since ${new Date(item.at).toLocaleDateString()}.`"
          >quiet {{ agedFor(item.at) }}</span>
          <span v-else-if="item.at" class="type-mono-meta hidden sm:inline">{{ relativeTime(item.at) }}</span>
          <UButton
            v-if="item.action"
            :label="item.action.label"
            size="xs"
            variant="soft"
            :loading="busy === item.key"
            :disabled="busy !== null && busy !== item.key"
            @click="resolve(item)"
          />
        </div>
      </li>
    </ul>
    <!--
      Where the rows from elsewhere came from, and how old the answer is.

      Said out loud because a refresh is a job, not a request: a real Notion one
      here takes between half a minute and a minute and a half. Nothing polls it,
      so the age of the answer is part of the answer.

      It reads in seconds rather than dollars on purpose. The CLI reports a
      `total_cost_usd` per run and the app stores it, but almost everybody runs
      Claude Code on a subscription, where that figure is the notional value of
      the tokens and not a charge. "$0.85" beside a button would tell most people
      they are about to be billed for something they are not. Time is true for
      everyone.
    -->
    <div v-if="inboxSources.length" class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <div
        v-for="source in inboxSources"
        :key="source.key"
        class="flex items-center gap-2"
      >
        <UIcon :name="source.icon" class="size-3 shrink-0 text-meta" />
        <span class="type-meta">{{ source.label }}</span>

        <!--
          The reason, not a hover. "last refresh failed" in a tooltip was enough
          when the failure was a timeout; it is not when the failure is "it was
          not allowed to use these tools, so nothing here is up to date" — that
          is the difference between a blank inbox and a wrong one, and it needs
          reading without a mouse.
        -->
        <span v-if="source.error" class="type-meta ink-error">{{ source.error }}</span>
        <span v-else-if="source.checkedAt" class="type-meta">
          {{ source.items.length }} · {{ relativeTime(source.checkedAt) }}<template v-if="source.durationMs"> · {{ Math.round(source.durationMs / 1000) }}s</template>
        </span>
        <span v-else class="type-meta">never checked</span>

        <button
          class="type-meta ink-accent hover:underline focus-ring rounded disabled:opacity-50"
          :disabled="refreshing !== null"
          @click="onRefresh(source.key, source.label)"
        >
          {{ refreshing === source.key ? 'looking…' : 'refresh' }}
        </button>

        <!--
          Only offered once a source has worked by hand — before that the daily
          run has no project to ask from, and the server refuses with that reason.
        -->
        <button
          v-if="source.checkedAt"
          class="type-meta hover:underline focus-ring rounded"
          :class="source.refreshAt ? 'ink-accent' : ''"
          :title="source.refreshAt
            ? `Refreshes itself daily at ${source.refreshAt}. Click to stop.`
            : `Refresh it every day at ${DAILY_AT}, once, before you start work.`"
          @click="onSchedule(source)"
        >
          {{ source.refreshAt ? `daily ${source.refreshAt}` : 'daily?' }}
        </button>
      </div>
    </div>
  </section>
</template>
