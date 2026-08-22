<script setup lang="ts">
import { relativeTime } from '~/utils/time'
import type { Issue, IssueIntent, IssueSource, IssueState } from '~/composables/useGithubIssues'

/**
 * One row on the band, and what it wants.
 *
 * Built to the same claim `PullCard` is: the interesting thing about a row is
 * never its title. What you came to find out is whether this one is your problem
 * in the next hour, and that is a verdict the server worked out from the
 * assignees, the conversation and the sessions on this machine at once — so it
 * takes the position the eye lands on and the title sits under it.
 *
 * Two buttons, where a pull request has one. The pull request band can pick the
 * action from the state — a red build wants a fix and a waiting reviewer wants
 * an answer — and an issue cannot, because the thing not yet known about an
 * issue is whether it should be done at all. So the choice is yours and it is
 * the honest one: find out, or do it. Writing anything back to GitHub is brief
 * 09; nothing here comments, labels or closes.
 *
 * **Two sources, one row shape.** A GitHub issue and a Notion ticket are drawn by
 * the same component with a badge saying which, rather than by two components in
 * two bands. What differs between them is what each tracker actually knows: an
 * issue has a number, an author and a comment count, a ticket has a status and
 * none of those. The row shows what is there and says nothing where there is
 * nothing, which is the only way a mixed list stays readable.
 */
const props = defineProps<{
  issue: Issue
  /** A press on this row is in flight. */
  busy?: boolean
}>()

const emit = defineEmits<{ work: [IssueIntent] }>()

/** Mirrors `ISSUE_INTENT_LABELS` on the server, which builds the prompt. */
const ACTIONS: { intent: IssueIntent; label: string; icon: string; title: string }[] = [
  {
    intent: 'investigate',
    label: 'Investigate it',
    icon: 'i-lucide-scan-search',
    title: 'Start a session that reads the code and reports back. It commits nothing.',
  },
  {
    intent: 'implement',
    label: 'Do it',
    icon: 'i-lucide-hammer',
    title: 'Start a session that investigates, makes the change and commits on its own branch.',
  },
]

/**
 * What the buttons will really do when a session already has this issue.
 *
 * Worth having on the hover rather than in a toast afterwards: the instruction
 * lands in that session rather than cutting a second workspace, and a session
 * mid-turn gets opened instead. This mirrors `issues/work.post.ts`; the server
 * is the authority.
 */
const sessionNote = computed(() => props.issue.session
  ? `A session already has this — "${props.issue.session.title}". The instruction goes there rather than to a second one.`
  : null)

/**
 * Where the row came from, said on the row.
 *
 * Not inferred from the URL in the template: the server decides which tracker a
 * row is from, and a second implementation of that in the page is how a badge
 * ends up disagreeing with the endpoint it will be pressed against.
 */
const SOURCES: Record<IssueSource, { label: string; icon: string; where: string }> = {
  github: { label: 'GitHub', icon: 'i-lucide-github', where: 'Open on GitHub' },
  notion: { label: 'Notion', icon: 'i-lucide-file-text', where: 'Open in Notion' },
}

const from = computed(() => SOURCES[props.issue.source])

/**
 * A colour per state.
 *
 * No red anywhere. Nothing on this band is broken — an issue is a request, and
 * the worst of them is only somebody waiting — and spending the error colour
 * here would make the pull requests above it read as less serious than they are.
 */
const TONES: Record<IssueState, { fg: string; bg: string; icon: string }> = {
  'awaiting-reply': { fg: 'var(--warning)', bg: 'var(--warning-tint)', icon: 'i-lucide-message-circle-more' },
  'has-session': { fg: 'var(--text-secondary)', bg: 'var(--badge-subtle-bg)', icon: 'i-lucide-git-branch' },
  'assigned': { fg: 'var(--accent)', bg: 'var(--accent-muted)', icon: 'i-lucide-user-check' },
  'assigned-elsewhere': { fg: 'var(--text-tertiary)', bg: 'var(--badge-subtle-bg)', icon: 'i-lucide-users' },
  'unassigned': { fg: 'var(--text-tertiary)', bg: 'var(--badge-subtle-bg)', icon: 'i-lucide-circle-dot' },
}

const tone = computed(() => TONES[props.issue.verdict.state])
</script>

<template>
  <div
    data-row
    tabindex="0"
    class="relative flex gap-3 rounded-lg overflow-hidden transition-all hover-card focus-ring"
    style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
    :style="issue.verdict.onYou ? { borderColor: 'var(--border-default)' } : undefined"
  >
    <!-- The verdict again, as a colour, so a column of these reads at a glance -->
    <div class="w-[3px] shrink-0" :style="{ background: tone.fg, opacity: issue.verdict.onYou ? 1 : 0.35 }" />

    <div class="flex-1 min-w-0 py-3 pr-3 space-y-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span
          class="inline-flex items-center gap-1.5 fs-micro font-medium px-2 py-0.5 rounded-full shrink-0"
          :style="{ background: tone.bg, color: tone.fg }"
        >
          <UIcon :name="tone.icon" class="size-3" />
          {{ issue.verdict.label }}
        </span>

        <!--
          Which tracker. On every row rather than only on the Notion ones: a
          badge that appears on half a list reads as an exception rather than as
          a fact, and "where is this" is the first thing you need in order to know
          who else can see what you do about it.
        -->
        <span
          class="inline-flex items-center gap-1 fs-micro font-mono px-1.5 py-px rounded-full shrink-0"
          style="background: var(--badge-subtle-bg); color: var(--text-tertiary);"
          :title="`This came from ${from.label}`"
        >
          <UIcon :name="from.icon" class="size-2.5" />
          {{ from.label }}
        </span>

        <!--
          The session, as a link rather than a word, for the reason PullCard
          gives: "has a session already" is only useful if it is also the way to
          go and look at it.
        -->
        <NuxtLink
          v-if="issue.session"
          :to="`/sessions/${issue.session.id}`"
          class="type-meta truncate hover:underline focus-ring rounded"
          :title="issue.session.title"
        >
          {{ issue.verdict.detail }}
        </NuxtLink>
        <span v-else class="type-meta truncate">{{ issue.verdict.detail }}</span>
      </div>

      <div class="min-w-0">
        <a
          data-row-open
          :href="issue.url"
          target="_blank"
          rel="noopener"
          class="type-strong text-body hover:underline inline-flex items-baseline gap-1.5 min-w-0 focus-ring rounded"
        >
          <!-- A number only where there is one. A Notion page id is thirty-two
               hex characters and putting eight of them here would be noise. -->
          <span v-if="issue.number" class="font-mono fs-mono shrink-0 ink-4">#{{ issue.number }}</span>
          <span class="truncate">{{ issue.title }}</span>
        </a>

        <div class="flex items-center gap-2 flex-wrap mt-1 type-mono-meta">
          <!-- Notion tickets carry no author the intake asks for, and an empty
               span reads as a missing word rather than as an absent fact. -->
          <span v-if="issue.author">{{ issue.author }}</span>
          <span v-if="issue.status">{{ issue.status }}</span>
          <span v-if="issue.comments">
            {{ issue.comments }} {{ issue.comments === 1 ? 'comment' : 'comments' }}
          </span>
          <!-- Age, not last activity: the one that has not moved in a month is
               the one going stale, and sorting by activity would hide it. A
               ticket whose page did not say has no date to show. -->
          <span v-if="issue.createdAt" :title="new Date(issue.createdAt).toLocaleString()">
            opened {{ relativeTime(issue.createdAt) }}
          </span>
        </div>

        <div v-if="issue.labels.length" class="flex items-center gap-1 flex-wrap mt-1.5">
          <!-- GitHub's own colours: a label people recognise is doing its job -->
          <span
            v-for="label in issue.labels.slice(0, 4)"
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
    </div>

    <div class="flex items-center gap-1.5 pr-3 shrink-0">
      <!--
        The whole reason this band is not a list of links. Two, because the
        useful first move on an issue is usually to find out whether the ask
        survives reading the code — and that is not the same press as doing it.
      -->
      <button
        v-for="action in ACTIONS"
        :key="action.intent"
        class="inline-flex items-center gap-1.5 fs-mono px-2.5 py-1.5 rounded-md font-medium press-scale focus-ring cursor-pointer transition-colors"
        :style="action.intent === 'implement'
          ? { background: 'var(--accent-muted)', color: 'var(--accent)' }
          : { background: 'var(--badge-subtle-bg)', color: 'var(--text-secondary)' }"
        :disabled="busy"
        :title="sessionNote ?? action.title"
        @click="emit('work', action.intent)"
      >
        <UIcon
          :name="busy ? 'i-lucide-loader-2' : action.icon"
          class="size-3.5"
          :class="{ 'animate-spin': busy }"
        />
        {{ action.label }}
      </button>

      <a
        :href="issue.url"
        target="_blank"
        rel="noopener"
        class="p-1.5 rounded-md hover-bg focus-ring"
        style="color: var(--text-disabled);"
        :title="from.where"
      >
        <UIcon name="i-lucide-external-link" class="size-3.5" />
      </a>
    </div>
  </div>
</template>
