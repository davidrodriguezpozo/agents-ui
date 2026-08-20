<script setup lang="ts">
import { relativeTime } from '~/utils/time'
import type { PullWork, PullWorkTone } from '~/utils/pullWork'
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
  /**
   * Work you have already started on this pull request. Null means none — see
   * `~/utils/pullWork`, which is where the decision is made.
   */
  work?: PullWork | null
}>()

const emit = defineEmits<{ work: [WorkIntent | undefined]; merge: [] }>()

/**
 * The open threads, read on the press.
 *
 * Kept on the row rather than lifted to the page, because it is state about one
 * row and there can be twenty of them: hoisting it would mean the page holding a
 * map keyed by pull request number to answer a question only the row asks.
 */
interface ReviewThread {
  author: string
  path: string | null
  line: number | null
  body: string
  replies: number
}

const threadsOpen = ref(false)
const threadsLoading = ref(false)
const threadsError = ref<string | null>(null)
const threads = ref<ReviewThread[]>([])

async function toggleThreads() {
  if (threadsOpen.value) {
    threadsOpen.value = false
    return
  }

  // Read once and kept. A thread that has been resolved since is a stale reading
  // of a list somebody is about to act on anyway, and re-fetching on every
  // expand would make the button feel like it is doing work twice.
  if (threads.value.length || threadsError.value) {
    threadsOpen.value = true
    return
  }

  threadsLoading.value = true
  try {
    const result = await $fetch<{ ok: boolean; threads: ReviewThread[]; reason?: string }>(
      '/api/github/pulls/threads',
      { query: { number: props.pull.number } },
    )
    if (result.ok) threads.value = result.threads
    else threadsError.value = result.reason ?? 'GitHub could not be asked.'
    threadsOpen.value = true
  } catch (e: any) {
    threadsError.value = e?.data?.data?.message ?? e?.message ?? 'GitHub could not be asked.'
    threadsOpen.value = true
  } finally {
    threadsLoading.value = false
  }
}

/**
 * A colour per state, in the two roles a row uses it: the stripe and the badge.
 *
 * Red is spent only on things that are actually wrong. A pull request waiting
 * on a reviewer is not a problem, and a page where everything is red is a page
 * where nothing is.
 */
const TONES: Record<PullState, { fg: string; bg: string; icon: string }> = {
  'draft': { fg: 'var(--text-tertiary)', bg: 'var(--badge-subtle-bg)', icon: 'i-lucide-git-pull-request-draft' },
  'conflicted': { fg: 'var(--error)', bg: 'var(--error-tint)', icon: 'i-lucide-git-merge' },
  'changes-requested': { fg: 'var(--warning)', bg: 'var(--warning-tint)', icon: 'i-lucide-message-square-warning' },
  'unanswered': { fg: 'var(--warning)', bg: 'var(--warning-tint)', icon: 'i-lucide-message-circle-more' },
  'checks-failing': { fg: 'var(--error)', bg: 'var(--error-tint)', icon: 'i-lucide-circle-x' },
  'checks-running': { fg: 'var(--accent)', bg: 'var(--accent-muted)', icon: 'i-lucide-loader-2' },
  'ready': { fg: 'var(--success)', bg: 'var(--success-tint)', icon: 'i-lucide-circle-check' },
  'awaiting-review': { fg: 'var(--accent)', bg: 'var(--accent-muted)', icon: 'i-lucide-eye' },
}

const tone = computed(() => TONES[props.pull.verdict.state])

/**
 * The colours of "you have already started this".
 *
 * Deliberately quieter than the verdict beside it, and never red for merely
 * existing. The verdict is what the pull request needs; this is a fact about
 * your own machine, and a row where both chips shout reads as two problems when
 * one of them is a shortcut.
 */
const WORK_TONES: Record<PullWorkTone, { fg: string; bg: string }> = {
  attention: { fg: 'var(--accent)', bg: 'var(--accent-muted)' },
  problem: { fg: 'var(--error)', bg: 'var(--error-tint)' },
  live: { fg: 'var(--accent)', bg: 'var(--accent-muted)' },
  ready: { fg: 'var(--text-secondary)', bg: 'var(--badge-subtle-bg)' },
  quiet: { fg: 'var(--text-disabled)', bg: 'var(--badge-subtle-bg)' },
}

const workTone = computed(() => props.work ? WORK_TONES[props.work.tone] : null)

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

/**
 * What the button will really do when work on this already exists.
 *
 * Three different things, and the difference is worth having on the hover
 * rather than in a toast afterwards: a review is a fresh detached checkout and
 * can happen any number of times, an intent that changes the branch lands in
 * the workspace that already holds it, and neither of those touches a session
 * that is mid-turn — that one gets opened. This mirrors `pulls/work.post.ts`;
 * the server is the authority.
 */
const workNote = computed(() => {
  const work = props.work
  if (!work) return null

  if (props.pull.intent === 'review') {
    return 'You already have a session on this. Reviewing again opens a second, read-only checkout.'
  }

  // A review holds no branch — that is the point of it — so it cannot be what
  // the instruction lands in. Only a session that holds the branch can be.
  const holder = work.workers.find(w => !w.reviewing)
  if (!holder) return 'You have a review of this open. This starts work on the branch itself.'

  return holder.activity === 'working'
    ? 'A session is mid-turn on this branch. This opens it rather than starting anything.'
    : 'A session already has this branch. The instruction goes there rather than to a second one.'
})
</script>

<template>
  <!--
    A row the keyboard can reach. `tabindex` because the root is a div and has
    to be — the card carries a merge button and a link to a session, and an
    anchor wrapping either is a link inside a link.
  -->
  <div
    data-row
    tabindex="0"
    class="relative flex gap-3 rounded-lg overflow-hidden transition-all hover-card focus-ring"
    style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
    :style="pull.verdict.onYou ? { borderColor: 'var(--border-default)' } : undefined"
  >
    <!-- The verdict again, as a colour, so a column of these reads at a glance -->
    <div class="w-[3px] shrink-0" :style="{ background: tone.fg, opacity: pull.verdict.onYou ? 1 : 0.35 }" />

    <div class="flex-1 min-w-0 py-3 pr-3 space-y-2">
      <!-- Where it has got to, first. The title is the second question. -->
      <div class="flex items-center gap-2 flex-wrap">
        <span
          class="inline-flex items-center gap-1.5 fs-micro font-medium px-2 py-0.5 rounded-full shrink-0"
          :style="{ background: tone.bg, color: tone.fg }"
        >
          <UIcon
            :name="tone.icon"
            class="size-3"
            :class="{ 'animate-spin': pull.verdict.state === 'checks-running' }"
          />
          {{ pull.verdict.label }}
        </span>

        <!--
          Work you have already started, next to the verdict because it changes
          what the row is asking. "Address it" over a session that is mid-turn on
          this branch is not an invitation to start; it is an invitation to go
          and look — and this chip is the link that does it.
        -->
        <NuxtLink
          v-if="work && workTone"
          :to="`/sessions/${work.primary.id}`"
          class="inline-flex items-center gap-1.5 fs-micro font-medium px-2 py-0.5 rounded-full shrink-0 focus-ring hover:underline"
          :style="{ background: workTone.bg, color: workTone.fg }"
          :title="work.detail"
        >
          <UIcon :name="work.icon" class="size-3" :class="{ 'animate-spin': work.spin }" />
          {{ work.label }}
        </NuxtLink>

        <span class="type-meta truncate">{{ pull.verdict.detail }}</span>
      </div>

      <div class="min-w-0">
        <!--
          What Enter opens. Marked here rather than left to be guessed: the chip
          above links to a session, so on a pull request you have already started
          the first anchor in this card is not the pull request.
        -->
        <a
          data-row-open
          :href="pull.url"
          target="_blank"
          rel="noopener"
          class="type-strong text-body hover:underline inline-flex items-baseline gap-1.5 min-w-0 focus-ring rounded"
        >
          <span class="font-mono fs-mono shrink-0 ink-4">#{{ pull.number }}</span>
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
            class="fs-micro px-1.5 py-px rounded-full"
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

      <!--
        What the open threads actually say.
        
        The count on the verdict above answers "does somebody want something",
        which is the right question on a list. It cannot answer the one that
        decides what you do next — the difference between "rename this variable"
        and "this whole approach is wrong" is the entire decision, and it used to
        be a browser tab away.
        
        Fetched on the press rather than with the list: the bodies are affordable
        for the one pull request you have decided to look at, and were not for
        eight at once. See `readThreads`.
      -->
      <div v-if="pull.unresolved" class="space-y-1.5">
        <button
          class="inline-flex items-center gap-1.5 fs-mono focus-ring cursor-pointer"
          style="color: var(--text-disabled);"
          :disabled="threadsLoading"
          @click="toggleThreads"
        >
          <UIcon
            :name="threadsLoading ? 'i-lucide-loader-2' : threadsOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-3"
            :class="{ 'animate-spin': threadsLoading }"
          />
          {{ threadsOpen ? 'Hide' : 'Read' }} the {{ pull.unresolved }}
          {{ pull.unresolved === 1 ? 'open comment' : 'open comments' }}
        </button>

        <div v-if="threadsOpen" class="space-y-1.5">
          <p v-if="threadsError" class="type-detail" style="color: var(--error);">{{ threadsError }}</p>
          <p
            v-else-if="!threads.length"
            class="type-detail"
            style="color: var(--text-tertiary);"
          >
            Nothing unresolved left — the count came from a reading taken a moment ago.
          </p>
          <div
            v-for="(thread, i) in threads"
            :key="i"
            class="px-2.5 py-1.5 rounded space-y-0.5"
            style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
          >
            <p class="type-mono-meta" style="color: var(--text-tertiary);">
              {{ thread.author }}<template v-if="thread.path"> · {{ thread.path }}<template v-if="thread.line">:{{ thread.line }}</template></template>
              <template v-if="thread.replies"> · {{ thread.replies }} {{ thread.replies === 1 ? 'reply' : 'replies' }}</template>
            </p>
            <p class="type-detail whitespace-pre-wrap" style="color: var(--text-secondary);">{{ thread.body }}</p>
          </div>
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
          class="inline-flex items-center gap-1 fs-micro font-mono px-1.5 py-0.5 rounded hover:underline focus-ring"
          style="background: var(--error-tint); color: var(--error);"
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
        class="fs-mono px-2.5 py-1.5 rounded-md font-medium press-scale focus-ring cursor-pointer transition-colors"
        style="background: var(--success-tint); color: var(--success);"
        :disabled="busy"
        @click="emit('merge')"
      >
        Merge
      </button>

      <!-- The whole reason this page is not a link to github.com -->
      <button
        v-if="pull.intent"
        class="inline-flex items-center gap-1.5 fs-mono px-2.5 py-1.5 rounded-md font-medium press-scale focus-ring cursor-pointer transition-colors"
        style="background: var(--accent-muted); color: var(--accent);"
        :disabled="busy"
        :title="workNote ?? 'Start a session on this branch, already working on it'"
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
