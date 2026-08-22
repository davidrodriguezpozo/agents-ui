<script setup lang="ts">
/**
 * The offer that appears after something has landed.
 *
 * A merge is not one event: every other session in that repository is behind the
 * moment it lands, and each of their green verdicts was earned against a branch
 * that no longer exists. Bringing one forward has always been possible from that
 * session's own page — so the work was there, and the person had to remember to
 * do it five times, on five pages.
 *
 * It is an offer and never an action taken for them. Three things follow from
 * that, and each of them is why this is a panel rather than a toast:
 *
 *   - **It says how many, before it does anything.** Five workspaces written to
 *     is not implied by having merged one, and a count is the difference between
 *     a press and a surprise.
 *   - **It says who it will leave alone, and why.** A session mid-turn, one with
 *     uncommitted work, one whose branch something else is holding — those are
 *     the interesting rows, because they are the ones the person still has to do
 *     something about.
 *   - **A conflict reads as work started, not as a failure.** The session has the
 *     conflict and has been asked to resolve it; the row says so and links to the
 *     turn.
 */

const { plan, results, summary, running, load, run, dismiss } = useBaseSweep()
const toast = useToast()

onMounted(() => { void load() })

const behind = computed(() => plan.value?.updating ?? 0)
const skipped = computed(() =>
  (plan.value?.candidates ?? []).filter(candidate => candidate.disposition === 'skip'))

/** Nothing to offer and nothing to report is nothing to draw. */
const show = computed(() => Boolean(results.value?.length) || behind.value > 0)

const OUTCOMES: Record<string, { label: string; tone: string }> = {
  'updated': { label: 'brought forward', tone: 'var(--success)' },
  'updated-unverified': { label: 'brought forward, unchecked', tone: 'var(--warning)' },
  'conflicted': { label: 'resolving a conflict', tone: 'var(--warning)' },
  'skipped': { label: 'nothing to do', tone: 'var(--text-tertiary)' },
  'failed': { label: 'could not', tone: 'var(--error)' },
}

async function onRun() {
  const answer = await run()
  if (answer) toast.add({ title: answer.summary, color: 'success' })
  else toast.add({ title: 'Could not bring the base in', color: 'error' })
}
</script>

<template>
  <section v-if="show" class="rounded-lg p-4 bg-card space-y-3">
    <header class="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h2 class="type-strong text-body">
          <template v-if="results?.length">What came forward</template>
          <template v-else>
            {{ behind }} {{ behind === 1 ? 'session is' : 'sessions are' }} behind
            <span class="font-mono">{{ plan?.baseBranch }}</span>
          </template>
        </h2>
        <p class="type-meta">
          <template v-if="results?.length">{{ summary }}</template>
          <template v-else>
            Their checks were run against a branch that has moved. Bringing the base in re-runs
            them, and a conflict is handed to the session that has it.
          </template>
        </p>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <UButton
          v-if="behind > 0"
          :label="results?.length ? 'Bring the rest forward' : `Bring ${plan?.baseBranch} into ${behind}`"
          icon="i-lucide-git-merge"
          size="xs"
          variant="soft"
          :loading="running"
          @click="onRun"
        />
        <UButton
          v-if="results?.length"
          label="Dismiss"
          size="xs"
          variant="ghost"
          color="neutral"
          @click="dismiss"
        />
      </div>
    </header>

    <ul v-if="results?.length" class="space-y-1">
      <li v-for="result in results" :key="result.id" class="flex items-start gap-2 type-detail">
        <span
          class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0"
          :style="{ color: OUTCOMES[result.outcome]?.tone }"
        >{{ OUTCOMES[result.outcome]?.label ?? result.outcome }}</span>
        <span class="min-w-0">
          <span class="type-strong">{{ result.title }}</span>
          <span class="ink-3"> · {{ result.message }}</span>
          <NuxtLink
            v-if="result.runId"
            :to="`/runs/${result.runId}`"
            class="underline hover:opacity-80 ml-1"
          >watch it</NuxtLink>
        </span>
      </li>
    </ul>

    <!--
      Who is being left alone. Shown before the press rather than after, because
      these are the rows the person still has to do something about — and a
      session mid-turn is not a problem, it is a "come back in a minute".
    -->
    <ul v-else-if="skipped.length" class="space-y-1">
      <li v-for="candidate in skipped" :key="candidate.id" class="type-detail">
        <span class="type-strong">{{ candidate.title }}</span>
        <span class="ink-3"> · {{ candidate.reason }}</span>
      </li>
    </ul>
  </section>
</template>
