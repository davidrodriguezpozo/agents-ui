<script setup lang="ts">
import { LANDING_OUTCOMES, type LandingRun } from '~/composables/useLanding'

/**
 * A landing in progress, or the last one.
 *
 * Worth a panel rather than a toast because it takes minutes and its result is
 * a list rather than a sentence — six sessions, some merged, some left alone,
 * each for a reason you may want to act on. A toast would say "merged 4" and
 * throw away the half that needs you.
 */
const props = defineProps<{ run: LandingRun }>()

const done = computed(() => props.run.steps.filter(s => s.outcome).length)

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
  return step.outcome === 'merged' ? 'i-lucide-git-merge' : 'i-lucide-circle-alert'
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
        <template v-else>{{ run.summary }}</template>
      </span>
      <span v-if="run.status === 'running'" class="flex-1" />
      <span v-if="current" class="type-meta truncate">
        running checks on {{ current.title }}
      </span>
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
