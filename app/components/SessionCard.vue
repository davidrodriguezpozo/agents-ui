<script setup lang="ts">
import type { Session } from '~/composables/useSessions'

/**
 * A session on a list.
 *
 * Extracted when the list stopped being about one repository: a session in
 * another project used to be a thin row with a title and nothing else, which
 * made "is anything blocked over there" unanswerable without switching to it
 * first. There is no reason the answer should depend on which project you
 * happen to be looking at, so every session gets the same card.
 */
const props = defineProps<{
  session: Session
  /** Shown when the list spans repositories and the row needs to say which. */
  repoName?: string | null
}>()

function relative(ts: number) {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Two things earn a card an outline: it is waiting on you, or it has produced
 * something that does not work. Both are cases where scrolling past would be a
 * mistake, which is the only thing an outline is for.
 */
const accent = computed(() => {
  const { session } = props
  if (session.activity === 'awaiting-permission') return 'border-color: var(--accent-glow);'
  if (session.activity === 'idle' && session.check?.status === 'failing') {
    return 'border-color: var(--error);'
  }
  return undefined
})
</script>

<template>
  <NuxtLink
    :to="`/sessions/${session.id}`"
    class="block rounded-md p-4 focus-ring hover-card bg-card"
    :style="accent"
  >
    <div class="flex items-start gap-3">
      <div class="flex-1 min-w-0 space-y-1.5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="type-strong truncate">{{ session.title }}</span>
          <SessionStatus
            :activity="session.activity"
            :changed-files="session.worktree.changedFiles"
            :dirty="session.worktree.dirty"
            :check="session.check"
          />
        </div>

        <!--
          What it did, in words. The counts below say how much changed;
          this is the only thing on the row that says what the change
          was, which is what you actually decide on.
        -->
        <p v-if="session.summary" class="type-detail leading-snug" style="color: var(--text-secondary);">
          {{ session.summary.text }}
        </p>

        <!-- What it has produced, which is what you decide on -->
        <div class="flex items-center gap-3 type-meta">
          <span v-if="session.worktree.changedFiles" class="flex items-center gap-1">
            <UIcon name="i-lucide-file-diff" class="size-3 shrink-0" />
            {{ session.worktree.changedFiles }} file{{ session.worktree.changedFiles === 1 ? '' : 's' }}
          </span>
          <span v-if="session.worktree.ahead" class="flex items-center gap-1">
            <UIcon name="i-lucide-git-commit-horizontal" class="size-3 shrink-0" />
            {{ session.worktree.ahead }} commit{{ session.worktree.ahead === 1 ? '' : 's' }}
          </span>
          <span v-if="session.worktree.dirty" style="color: var(--accent);">uncommitted</span>
          <!--
            Said on the row because it is the one that goes wrong quietly: merge
            one session and every other one is now judged against a base it does
            not have, while still showing the green it earned beforehand.
          -->
          <span
            v-if="session.worktree.behind"
            class="flex items-center gap-1"
            style="color: var(--warning);"
            :title="`${session.baseBranch} has moved on since this was last checked`"
          >
            <UIcon name="i-lucide-git-pull-request-arrow" class="size-3 shrink-0" />
            {{ session.worktree.behind }} behind
          </span>
          <span v-if="session.turnCount" class="flex items-center gap-1">
            <UIcon name="i-lucide-message-square" class="size-3 shrink-0" />
            {{ session.turnCount }}
          </span>
          <span v-if="!session.worktree.changedFiles && !session.turnCount">
            Nothing yet
          </span>
        </div>
      </div>

      <span class="type-mono-meta shrink-0">{{ relative(session.updatedAt) }}</span>
    </div>

    <!-- Branch detail last: useful, but not what you scan for -->
    <div class="flex items-center gap-1.5 mt-2.5 pt-2.5 type-mono-meta" style="border-top: 1px solid var(--border-subtle);">
      <UIcon name="i-lucide-git-branch" class="size-2.5 shrink-0" />
      <span class="truncate">{{ session.branch }}</span>
      <span class="shrink-0">from {{ session.baseBranch }}</span>
      <template v-if="repoName">
        <span class="shrink-0">·</span>
        <UIcon name="i-lucide-folder-git-2" class="size-2.5 shrink-0" />
        <span class="shrink-0">{{ repoName }}</span>
      </template>
    </div>
  </NuxtLink>
</template>
