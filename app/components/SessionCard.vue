<script setup lang="ts">
import type { Session } from '~/composables/useSessions'
import { driftNote } from '~/utils/checkout'
import { describeOverlap } from '~/utils/overlap'
import type { WallPull } from '~/utils/wall'

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
  /**
   * The pull request this session's branch is behind, when there is one.
   *
   * Passed in rather than fetched here: it comes from the reading that already
   * covers every project once a minute, and forty-five cards each asking GitHub
   * about their own branch would be forty-five subprocesses a minute for a fact
   * one request already knows. Null means either "no pull request" or "GitHub
   * has not been asked yet", and the card says nothing in both cases — the same
   * as it did before it could say anything at all.
   */
  pull?: WallPull | null
}>()

/**
 * The card's own words for a pull request's state.
 *
 * Deliberately not `pull.label`: that is written for the Land page, where the
 * reader is deciding what to do about the pull request itself ("Your review",
 * "Nobody has reviewed it yet"). Here the pull request is context for a piece of
 * work, and the only thing worth two words is whether it is finished, stuck, or
 * simply open.
 */
const pullState = computed(() => {
  const pull = props.pull
  if (!pull) return null

  // Ordered by what stops the work, which is not the order the states are
  // declared in: a conflicted draft is a conflict you have to deal with, and a
  // draft with red CI is red CI.
  switch (pull.state) {
    case 'conflicted': return { text: 'conflicted', color: 'var(--error)' }
    case 'checks-failing': return { text: 'CI red', color: 'var(--error)' }
    case 'changes-requested': return { text: 'changes requested', color: 'var(--warning)' }
    case 'ready': return { text: 'ready', color: 'var(--success)' }
    case 'draft': return { text: 'draft', color: 'var(--text-disabled)' }
    default:
      // 'unanswered', 'checks-running' and 'awaiting-review' are all "open and
      // waiting", which the number already says. Only whether it is waiting on
      // *you* adds anything.
      return pull.onYou ? { text: 'on you', color: 'var(--accent)' } : null
  }
})

/**
 * The worktree is on a branch this session's record does not name.
 *
 * Said on the row, in the same place the branch is, because that is the fact it
 * contradicts. Everything else the card shows about this session — its files, its
 * commits, whether it landed — is measured somewhere other than where the record
 * says, and a row that shows those numbers without saying so is the row that got
 * this wrong in the first place.
 */
const drifted = computed(() => props.session.driftedTo ?? null)

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
    data-row
    class="block rounded-md p-4 focus-ring hover-card bg-card"
    :style="accent"
  >
    <div class="flex items-start gap-3">
      <div class="flex-1 min-w-0 space-y-1.5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="type-strong truncate">{{ session.title }}</span>
          <!--
            `check-stale` and `behind` were both missing here, so the row wore
            plain green while the counters underneath it said the verdict was
            void. The badge is the part people read.
          -->
          <SessionStatus
            :activity="session.activity"
            :changed-files="session.worktree.changedFiles"
            :dirty="session.worktree.dirty"
            :check="session.check"
            :check-stale="session.checkStale"
            :behind="session.worktree.behind"
            :landed="session.landed"
          />
        </div>

        <!--
          What it did, in words. The counts below say how much changed;
          this is the only thing on the row that says what the change
          was, which is what you actually decide on.
        -->
        <p v-if="session.summary" class="type-detail leading-snug ink-2">
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
          <!--
            Not for a session that has landed. It is behind by the very merge
            commit that landed it, so saying so in warning amber asserts there is
            something to do about work that is finished.
          -->
          <span
            v-if="session.worktree.behind && !session.landed"
            class="flex items-center gap-1"
            style="color: var(--warning);"
            :title="`${session.baseBranch} has moved on since this was last checked`"
          >
            <UIcon name="i-lucide-git-pull-request-arrow" class="size-3 shrink-0" />
            {{ session.worktree.behind }} behind
          </span>
          <span
            v-else-if="session.landed"
            class="flex items-center gap-1"
            style="color: var(--success);"
            :title="`Its commits are in ${session.baseBranch}`"
          >
            <UIcon name="i-lucide-git-merge" class="size-3 shrink-0" />
            in {{ session.baseBranch }}
          </span>
          <!--
            Two sessions changing the same file. The complement to `behind`,
            which only becomes true once one of them has merged — by which point
            the other is already judged against a base it does not have. This is
            the same collision said while it is still cheap to know.

            Deliberately not amber. Two sessions on one file is ordinary and
            often intended; it is worth a glance, not a warning, and nothing is
            blocked by it.
          -->
          <span
            v-if="session.overlaps?.length"
            class="flex items-center gap-1"
            style="color: var(--text-tertiary);"
            :title="describeOverlap(session.overlaps)"
          >
            <UIcon name="i-lucide-git-compare-arrows" class="size-3 shrink-0" />
            shared {{ session.overlaps.length === 1 ? 'files' : `with ${session.overlaps.length}` }}
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
      <!--
        Where the work is going, when it is going anywhere. Text rather than a
        link because the whole card is already one, and a second target inside it
        is both invalid markup and a click nobody can aim.
      -->
      <template v-if="pull">
        <span class="shrink-0">·</span>
        <span class="shrink-0 flex items-center gap-1" :title="`#${pull.number} ${pull.title}`">
          <UIcon name="i-lucide-git-pull-request" class="size-2.5 shrink-0" />
          #{{ pull.number }}
          <span v-if="pullState" :style="{ color: pullState.color }">{{ pullState.text }}</span>
        </span>
      </template>
      <template v-if="drifted">
        <span class="shrink-0">·</span>
        <span
          class="shrink-0 flex items-center gap-1"
          style="color: var(--warning);"
          :title="driftNote(session.branch, drifted)"
        >
          <UIcon name="i-lucide-git-compare-arrows" class="size-2.5 shrink-0" />
          on {{ drifted }}
        </span>
      </template>
      <template v-if="repoName">
        <span class="shrink-0">·</span>
        <UIcon name="i-lucide-folder-git-2" class="size-2.5 shrink-0" />
        <span class="shrink-0">{{ repoName }}</span>
      </template>
    </div>
  </NuxtLink>
</template>
