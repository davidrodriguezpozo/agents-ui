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

/**
 * That the work landed and was then taken back out.
 *
 * The row's own words rather than the server's sentence, for the reason
 * `pullState` gives above: this is a column two words wide, and the whole account
 * — who, when, what the revert called itself — belongs in the hover.
 *
 * Deliberately not amber and not red. Nothing here is broken and nothing is
 * waiting on you: a revert is very often the right thing to have happened, and a
 * row that shouted at you about somebody else's decision would be wrong more
 * often than it was right. It replaces the green "in main" because that claim is
 * no longer true, and that is the whole of what it does.
 */
const reverted = computed(() => {
  const record = props.session.reverted
  if (!record) return null

  const when = new Date(record.committedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const by = record.by ? ` by ${record.by}` : ''

  return {
    text: `reverted from ${record.branch}`,
    title: `${record.subject} — ${when}${by}. Its merge is no longer in ${record.branch}.`,
  }
})

function relative(ts: number) {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Two things earn a row a marker: it is waiting on you, or it has produced
 * something that does not work. Both are cases where scrolling past would be a
 * mistake, which is the only thing a marker is for.
 *
 * This was a border round the whole card. At row density that reads as a box
 * drawn round a strip of text, so it is a bar in the left gutter now — see
 * `--row-marker` in `.work-row`.
 */
const marker = computed(() => {
  const { session } = props
  if (session.activity === 'awaiting-permission') return { '--row-marker': 'var(--accent)' }
  if (session.activity === 'idle' && session.check?.status === 'failing') {
    return { '--row-marker': 'var(--error)' }
  }
  return undefined
})
</script>

<template>
  <NuxtLink
    :to="`/sessions/${session.id}`"
    data-row
    class="work-row focus-ring"
    :style="marker"
  >
    <!-- Is it fine. A 14px mark on a fixed axis; the words are in its title. -->
    <SessionStatus
      glyph
      :activity="session.activity"
      :changed-files="session.worktree.changedFiles"
      :dirty="session.worktree.dirty"
      :check="session.check"
      :check-stale="session.checkStale"
      :behind="session.worktree.behind"
      :landed="session.landed"
      :reverted="Boolean(session.reverted)"
    />

    <span class="work-row__title">{{ session.title }}</span>

    <!--
      What it did, in words — and the only column allowed to be truncated,
      because it is the only one where half the fact is still a fact.
    -->
    <span class="work-row__summary">{{ session.summary?.text }}</span>

    <!-- What it produced, which is what you decide on -->
    <span class="work-row__meta">
      <span v-if="session.worktree.changedFiles" class="flex items-center gap-1">
        <UIcon name="i-lucide-file-diff" class="size-3 shrink-0" />
        {{ session.worktree.changedFiles }}
      </span>
      <span v-if="session.worktree.ahead" class="flex items-center gap-1">
        <UIcon name="i-lucide-git-commit-horizontal" class="size-3 shrink-0" />
        {{ session.worktree.ahead }}
      </span>
      <span v-if="session.turnCount" class="flex items-center gap-1">
        <UIcon name="i-lucide-message-square" class="size-3 shrink-0" />
        {{ session.turnCount }}
      </span>
      <span v-if="session.worktree.dirty" class="ink-accent" title="Uncommitted changes in the workspace">
        uncommitted
      </span>
      <!--
        Which agent, but only when it is not the usual one. A badge reading
        "Claude Code" on every row of a machine that has only ever used Claude
        Code is a column identical on every row — the row worth a glance is the
        one that differs.
      -->
      <span
        v-if="marksProvider(session.provider)"
        class="ink-3 flex items-center gap-1"
        :title="`This session's turns run through ${providerLabel(session.provider)}`"
      >
        <UIcon :name="providerLook(session.provider).icon" class="size-3 shrink-0" />
        {{ providerLabel(session.provider) }}
      </span>
      <!--
        Said on the row because it is the one that goes wrong quietly: merge one
        session and every other one is now judged against a base it does not
        have, while still showing the green it earned beforehand.

        Not for a session that has landed. It is behind by the very merge commit
        that landed it, so saying so in warning amber asserts there is something
        to do about work that is finished.
      -->
      <!--
        Ahead of both of the below, because it contradicts both. A reverted
        session's branch is still contained in the base — that is what a revert
        leaves behind — so it would otherwise read "in main" over work that main
        no longer has.
      -->
      <span
        v-if="reverted"
        class="ink-3 flex items-center gap-1"
        :title="reverted.title"
      >
        <UIcon name="i-lucide-undo-2" class="size-3 shrink-0" />
        {{ reverted.text }}
      </span>
      <span
        v-else-if="session.worktree.behind && !session.landed"
        class="ink-warn flex items-center gap-1"
        :title="`${session.baseBranch} has moved on since this was last checked`"
      >
        <UIcon name="i-lucide-git-pull-request-arrow" class="size-3 shrink-0" />
        {{ session.worktree.behind }}
      </span>
      <span
        v-else-if="session.landed"
        class="ink-ok flex items-center gap-1"
        :title="`Its commits are in ${session.baseBranch}`"
      >
        <UIcon name="i-lucide-git-merge" class="size-3 shrink-0" />
        in {{ session.baseBranch }}
      </span>
      <!--
        Two sessions changing the same file. Deliberately not amber: two
        sessions on one file is ordinary and often intended; it is worth a
        glance, not a warning, and nothing is blocked by it.
      -->
      <span
        v-if="session.overlaps?.length"
        class="ink-3 flex items-center gap-1"
        :title="describeOverlap(session.overlaps)"
      >
        <UIcon name="i-lucide-git-compare-arrows" class="size-3 shrink-0" />
        {{ session.overlaps.length }}
      </span>
      <!--
        Where the work is going, when it is going anywhere. Text rather than a
        link because the whole row is already one, and a second target inside it
        is both invalid markup and a click nobody can aim.
      -->
      <span v-if="pull" class="flex items-center gap-1" :title="`#${pull.number} ${pull.title}`">
        <UIcon name="i-lucide-git-pull-request" class="size-3 shrink-0" />
        #{{ pull.number }}
        <span v-if="pullState" :style="{ color: pullState.color }">{{ pullState.text }}</span>
      </span>
      <span
        v-if="drifted"
        class="ink-warn flex items-center gap-1"
        :title="driftNote(session.branch, drifted)"
      >
        <UIcon name="i-lucide-git-compare-arrows" class="size-3 shrink-0" />
        on {{ drifted }}
      </span>
      <span v-if="repoName" class="flex items-center gap-1">
        <UIcon name="i-lucide-folder-git-2" class="size-3 shrink-0" />
        {{ repoName }}
      </span>
    </span>

    <!-- Where it is. Useful, but not what you scan for. -->
    <span class="work-row__branch" :title="`${session.branch} from ${session.baseBranch}`">
      <UIcon name="i-lucide-git-branch" class="size-2.5 shrink-0" />
      <span class="work-row__branch-name">{{ session.branch }}</span>
    </span>

    <span class="work-row__when">{{ relative(session.updatedAt) }}</span>
  </NuxtLink>
</template>
