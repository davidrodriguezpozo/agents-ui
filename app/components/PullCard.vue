<script setup lang="ts">
import { relativeTime } from '~/utils/time'
import type { Pull, PullState, WorkIntent } from '~/composables/useGithubPulls'

/**
 * One pull request, and what it wants.
 *
 * The layout is built around a claim: the interesting thing about a pull
 * request is never its title. You know what your own are, and somebody else's
 * title tells you almost nothing about whether it needs you in the next hour.
 * What you came to find out is where it has got to — and that is a verdict the
 * server worked out from four fields at once, so it gets the position the eye
 * lands on and the title sits under it.
 *
 * The stripe down the left is the same verdict again, in colour, so a column of
 * these is readable without reading any of them.
 */
const props = defineProps<{
  pull: Pull
  /** A press on this row is in flight. */
  busy?: boolean
  /** Whether this row offers to merge — only ever your own, only when ready. */
  canMerge?: boolean
}>()

const emit = defineEmits<{ work: [WorkIntent | undefined]; merge: [] }>()

/**
 * A colour per state, in the two roles a row uses it: the stripe and the badge.
 *
 * Red is spent only on things that are actually wrong. A pull request waiting
 * on a reviewer is not a problem, and a page where everything is red is a page
 * where nothing is.
 */
const TONES: Record<PullState, { fg: string; bg: string; icon: string }> = {
  'draft': { fg: 'var(--text-tertiary)', bg: 'var(--badge-subtle-bg)', icon: 'i-lucide-git-pull-request-draft' },
  'conflicted': { fg: 'var(--error)', bg: 'rgba(248,113,113,0.12)', icon: 'i-lucide-git-merge' },
  'changes-requested': { fg: 'var(--warning)', bg: 'rgba(217,119,6,0.12)', icon: 'i-lucide-message-square-warning' },
  'unanswered': { fg: 'var(--warning)', bg: 'rgba(217,119,6,0.12)', icon: 'i-lucide-message-circle-more' },
  'checks-failing': { fg: 'var(--error)', bg: 'rgba(248,113,113,0.12)', icon: 'i-lucide-circle-x' },
  'checks-running': { fg: 'var(--accent)', bg: 'var(--accent-muted)', icon: 'i-lucide-loader-2' },
  'ready': { fg: 'var(--success)', bg: 'rgba(34,197,94,0.12)', icon: 'i-lucide-circle-check' },
  'awaiting-review': { fg: 'var(--accent)', bg: 'var(--accent-muted)', icon: 'i-lucide-eye' },
}

const tone = computed(() => TONES[props.pull.verdict.state])

/** Mirrors `INTENT_LABELS` on the server, which is what the prompt is built from. */
const INTENT_LABELS: Record<WorkIntent, string> = {
  review: 'Review it',
  address: 'Address it',
  fix: 'Fix CI',
  update: 'Resolve conflicts',
}

const INTENT_ICONS: Record<WorkIntent, string> = {
  review: 'i-lucide-scan-eye',
  address: 'i-lucide-reply',
  fix: 'i-lucide-wrench',
  update: 'i-lucide-git-merge',
}

/** `+41 −8`, which says more about a diff's size than a file count does. */
const size = computed(() => {
  const { additions, deletions, changedFiles } = props.pull
  const files = `${changedFiles} ${changedFiles === 1 ? 'file' : 'files'}`
  return { files, churn: `+${additions.toLocaleString()} −${deletions.toLocaleString()}` }
})

/**
 * Approvals, only once there are some.
 *
 * Null means GitHub was not asked rather than nobody approved, so it draws
 * nothing at all — a "0 approvals" that is really "we did not check" is the
 * kind of confident wrong number that costs a page its credibility.
 */
const approvals = computed(() => props.pull.approvals || 0)
</script>

<template>
  <div
    class="relative flex gap-3 rounded-lg overflow-hidden transition-all hover-card"
    style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
    :style="pull.verdict.onYou ? { borderColor: 'var(--border-default)' } : undefined"
  >
    <!-- The verdict again, as a colour, so a column of these reads at a glance -->
    <div class="w-[3px] shrink-0" :style="{ background: tone.fg, opacity: pull.verdict.onYou ? 1 : 0.35 }" />

    <div class="flex-1 min-w-0 py-3 pr-3 space-y-2">
      <!-- Where it has got to, first. The title is the second question. -->
      <div class="flex items-center gap-2 flex-wrap">
        <span
          class="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
          :style="{ background: tone.bg, color: tone.fg }"
        >
          <UIcon
            :name="tone.icon"
            class="size-3"
            :class="{ 'animate-spin': pull.verdict.state === 'checks-running' }"
          />
          {{ pull.verdict.label }}
        </span>

        <span class="type-meta truncate">{{ pull.verdict.detail }}</span>
      </div>

      <div class="min-w-0">
        <a
          :href="pull.url"
          target="_blank"
          rel="noopener"
          class="type-strong text-body hover:underline inline-flex items-baseline gap-1.5 min-w-0 focus-ring rounded"
        >
          <span class="font-mono text-[11px] shrink-0" style="color: var(--text-disabled);">#{{ pull.number }}</span>
          <span class="truncate">{{ pull.title }}</span>
        </a>

        <div class="flex items-center gap-2 flex-wrap mt-1 type-mono-meta">
          <span v-if="!pull.mine">{{ pull.author }}</span>
          <!--
            Truncated on the head branch alone. Truncating the pair together ate
            the base — `feature/expense-paid-status-3 → mast…` — and which branch
            this lands on is the half you cannot guess from the other.
          -->
          <span class="inline-flex items-baseline gap-1 min-w-0 max-w-[280px]">
            <span class="truncate">{{ pull.headBranch }}</span>
            <span class="shrink-0">→ {{ pull.baseBranch }}</span>
          </span>
          <span>{{ size.files }}</span>
          <span>{{ size.churn }}</span>
          <!-- Age, not last activity: the one that has not moved in a week is
               the one going stale, and sorting by activity would hide it. -->
          <span :title="new Date(pull.createdAt).toLocaleString()">opened {{ relativeTime(pull.createdAt) }}</span>
          <span
            v-if="approvals"
            class="inline-flex items-center gap-1"
            style="color: var(--success);"
          >
            <UIcon name="i-lucide-check" class="size-3" />
            {{ approvals }}
          </span>
        </div>

        <div v-if="pull.labels.length" class="flex items-center gap-1 flex-wrap mt-1.5">
          <!-- GitHub's own colours: a label people recognise is doing its job -->
          <span
            v-for="label in pull.labels.slice(0, 4)"
            :key="label.name"
            class="text-[9px] px-1.5 py-px rounded-full"
            :style="{
              background: `#${label.color}1f`,
              color: `#${label.color}`,
              border: `1px solid #${label.color}44`,
            }"
          >
            {{ label.name }}
          </span>
        </div>
      </div>

      <!-- Which checks, by name, with the link to the run that failed -->
      <div v-if="pull.failing.length" class="flex items-center gap-1.5 flex-wrap">
        <a
          v-for="check in pull.failing.slice(0, 3)"
          :key="check.name"
          :href="check.url || pull.url"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded hover:underline focus-ring"
          style="background: rgba(248,113,113,0.10); color: var(--error);"
        >
          <UIcon name="i-lucide-x" class="size-2.5" />
          {{ check.name }}
        </a>
        <span v-if="pull.failing.length > 3" class="type-mono-meta">
          +{{ pull.failing.length - 3 }} more
        </span>
      </div>
    </div>

    <div class="flex items-center gap-1.5 pr-3 shrink-0">
      <!--
        Merging is the one thing here anybody else can see, so it is never the
        thing your thumb lands on by accident: it only appears on a pull request
        that is yours and ready, and the page asks again before it happens.
      -->
      <button
        v-if="canMerge"
        class="text-[11px] px-2.5 py-1.5 rounded-md font-medium press-scale focus-ring cursor-pointer transition-colors"
        style="background: rgba(34,197,94,0.12); color: var(--success);"
        :disabled="busy"
        @click="emit('merge')"
      >
        Merge
      </button>

      <!-- The whole reason this page is not a link to github.com -->
      <button
        v-if="pull.intent"
        class="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md font-medium press-scale focus-ring cursor-pointer transition-colors"
        style="background: var(--accent-muted); color: var(--accent);"
        :disabled="busy"
        :title="`Start a session on this branch, already working on it`"
        @click="emit('work', undefined)"
      >
        <UIcon
          :name="busy ? 'i-lucide-loader-2' : INTENT_ICONS[pull.intent]"
          class="size-3.5"
          :class="{ 'animate-spin': busy }"
        />
        {{ INTENT_LABELS[pull.intent] }}
      </button>

      <a
        :href="pull.url"
        target="_blank"
        rel="noopener"
        class="p-1.5 rounded-md hover-bg focus-ring"
        style="color: var(--text-disabled);"
        title="Open on GitHub"
      >
        <UIcon name="i-lucide-external-link" class="size-3.5" />
      </a>
    </div>
  </div>
</template>
