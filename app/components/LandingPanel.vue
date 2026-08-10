<script setup lang="ts">
import { LANDING_OUTCOMES, type LandingRun } from '~/composables/useLanding'
import { relativeTime } from '~/utils/time'

/**
 * A landing in progress, or the last one.
 *
 * Worth a panel rather than a toast because it takes minutes and its result is
 * a list rather than a sentence — six sessions, some merged, some left alone,
 * each for a reason you may want to act on. A toast would say "merged 4" and
 * throw away the half that needs you.
 */
const props = defineProps<{
  run: LandingRun
  /**
   * Whether it can be put away. Only once it has stopped — dismissing a landing
   * mid-flight would hide the one thing on the page that is still changing.
   */
  dismissable?: boolean
}>()

const emit = defineEmits<{ dismiss: [] }>()

const done = computed(() => props.run.steps.filter(s => s.outcome).length)

/**
 * A headline for a run that never wrote a usable one.
 *
 * The summary is a sentence cached when the landing finished, so two kinds of run
 * arrive here without one worth showing. A run the server was killed part-way
 * through has none at all, and the panel rendered a blank line where its one
 * sentence should be. And a run from before `describeLanding` was fixed has
 * "Merged 0 sessions." — a count of nothing standing where the reason belongs,
 * which is still on disk in every record written back then.
 *
 * Both are recoverable from the steps, which are the same thing the summary was
 * derived from in the first place.
 */
const headline = computed(() => {
  if (props.run.summary && !props.run.summary.startsWith('Merged 0 session')) {
    return props.run.summary
  }

  const merged = props.run.steps.filter(s => s.outcome === 'merged').length
  const stopped = props.run.status === 'stopped'

  if (!merged) return stopped ? 'Landing stopped before merging anything.' : 'Nothing was merged.'
  return `${merged === 1 ? 'Merged 1 session' : `Merged ${merged} sessions`}${stopped ? ', then stopped.' : '.'}`
})

/** The one in flight, which is where the minutes are going. */
const current = computed(() => props.run.steps.find(s => s.startedAt && !s.outcome) ?? null)

function stepStyle(outcome?: string) {
  if (!outcome) return { color: 'var(--text-disabled)' }
  return LANDING_OUTCOMES[outcome as keyof typeof LANDING_OUTCOMES]?.good
    ? { color: 'var(--success)' }
    : { color: 'var(--warning)' }
}

function stepIcon(step: LandingRun['steps'][number], isCurrent: boolean) {
  if (isCurrent) return 'i-lucide-loader-2'
  if (!step.outcome) return 'i-lucide-circle-dashed'
  if (step.outcome === 'merged') return 'i-lucide-git-merge'
  // Already in is not an alarm — it is the same good ending, reached earlier.
  if (step.outcome === 'already-landed') return 'i-lucide-check'
  return 'i-lucide-circle-alert'
}
</script>

<template>
  <div class="rounded-lg p-4 space-y-3 bg-card" style="border: 1px solid var(--border-subtle);">
    <div class="flex items-center gap-2 flex-wrap">
      <UIcon
        :name="run.status === 'running' ? 'i-lucide-loader-2' : 'i-lucide-git-merge'"
        class="size-4 shrink-0"
        :class="{ 'animate-spin': run.status === 'running' }"
        :style="{ color: run.status === 'running' ? 'var(--accent)' : 'var(--text-secondary)' }"
      />
      <span class="text-[12px] font-medium text-body">
        <template v-if="run.status === 'running'">
          Landing into {{ run.baseBranch }} — {{ done }} of {{ run.steps.length }}
        </template>
        <template v-else>{{ headline }}</template>
      </span>
      <!--
        When, because this is a record and not a status. It sits here until it is
        put away, and its steps describe the repository as it was at the time —
        so a run from forty minutes ago saying a session could not merge reads as
        a claim about right now unless it is dated.
      -->
      <span v-if="run.status !== 'running'" class="type-meta shrink-0">
        {{ relativeTime(run.endedAt ?? run.startedAt) }}
      </span>

      <span v-if="run.status === 'running'" class="flex-1" />
      <span v-if="current" class="type-meta truncate">
        running checks on {{ current.title }}
      </span>

      <button
        v-if="dismissable"
        class="ml-auto rounded p-1 -m-1 focus-ring text-meta hover-bg"
        title="Put this away"
        aria-label="Put this away"
        @click="emit('dismiss')"
      >
        <UIcon name="i-lucide-x" class="size-3.5" />
      </button>
    </div>

    <!--
      Says which sessions, not just how many. The half that did not land is
      the half worth reading, and each line carries the reason.
    -->
    <div class="space-y-1">
      <div
        v-for="step in run.steps"
        :key="step.sessionId"
        class="flex items-baseline gap-2 text-[11px]"
      >
        <UIcon
          :name="stepIcon(step, current?.sessionId === step.sessionId)"
          class="size-3 shrink-0 self-center"
          :class="{ 'animate-spin': current?.sessionId === step.sessionId }"
          :style="stepStyle(step.outcome)"
        />
        <NuxtLink
          :to="`/sessions/${step.sessionId}`"
          class="truncate hover:underline underline-offset-2 text-body"
        >{{ step.title }}</NuxtLink>
        <span v-if="step.outcome" class="shrink-0 type-mono-meta" :style="stepStyle(step.outcome)">
          {{ LANDING_OUTCOMES[step.outcome]?.label ?? step.outcome }}
        </span>
        <span v-if="step.detail" class="truncate text-meta">{{ step.detail }}</span>
      </div>
    </div>

    <p v-if="run.error" class="text-[11px]" style="color: var(--error);">{{ run.error }}</p>

    <!--
      Named rather than counted. "3 were skipped" is the beginning of a
      question; the reason is the answer to it.
    -->
    <div v-if="run.skipped.length" class="pt-2 space-y-1" style="border-top: 1px solid var(--border-subtle);">
      <p class="type-meta">Left alone:</p>
      <p v-for="skip in run.skipped" :key="skip.sessionId" class="text-[11px] flex gap-2">
        <NuxtLink
          :to="`/sessions/${skip.sessionId}`"
          class="truncate hover:underline underline-offset-2 text-label shrink-0 max-w-[16rem]"
        >{{ skip.title }}</NuxtLink>
        <span class="text-meta truncate">{{ skip.reason }}</span>
      </p>
    </div>
  </div>
</template>
