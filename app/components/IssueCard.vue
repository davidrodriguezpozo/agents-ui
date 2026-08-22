<script setup lang="ts">
import { relativeTime } from '~/utils/time'
import type { Issue, IssueState } from '~/composables/useGithubIssues'

/**
 * One issue, and what it wants.
 *
 * Built to the same claim `PullCard` is: the interesting thing about a row is
 * never its title. What you came to find out is whether this one is your problem
 * in the next hour, and that is a verdict the server worked out from the
 * assignees, the conversation and the sessions on this machine at once — so it
 * takes the position the eye lands on and the title sits under it.
 *
 * Quieter than a pull request card on purpose. There is no button: starting a
 * session from a row is brief 07 and writing anything back to GitHub is brief
 * 09, so for now the row's job is to be seen and to open.
 */
const props = defineProps<{ issue: Issue }>()

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
          <span class="font-mono fs-mono shrink-0 ink-4">#{{ issue.number }}</span>
          <span class="truncate">{{ issue.title }}</span>
        </a>

        <div class="flex items-center gap-2 flex-wrap mt-1 type-mono-meta">
          <span>{{ issue.author }}</span>
          <span v-if="issue.comments">
            {{ issue.comments }} {{ issue.comments === 1 ? 'comment' : 'comments' }}
          </span>
          <!-- Age, not last activity: the one that has not moved in a month is
               the one going stale, and sorting by activity would hide it. -->
          <span :title="new Date(issue.createdAt).toLocaleString()">
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
      <a
        :href="issue.url"
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
