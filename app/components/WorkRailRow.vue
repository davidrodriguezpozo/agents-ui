<script setup lang="ts">
import type { Session } from '~/composables/useSessions'
import { STATUS_LOOK, type WorkItem } from '~/utils/workList'
import type { WallPull } from '~/utils/wall'

/**
 * A piece of work in flight, at rail width.
 *
 * Deliberately not `SessionCard` with a `compact` prop. That row is a six-column
 * table whose whole value is that every column sits on a fixed axis across forty
 * rows; at 264px each of those columns gets forty pixels and the table becomes
 * six truncations. Two rows of one component would also have to agree about
 * which columns to drop at which width, which is how you get a row that shows a
 * branch and hides the thing that is broken.
 *
 * What survives the narrowing is chosen rather than fitted: the mark, the title,
 * where it got to, and when. The counters, the branch, the overlaps and the
 * repository are all on the wide row and in the pane — this one is for deciding
 * which session to look at, not for deciding what to do about it.
 */
const props = defineProps<{
  item: WorkItem
  /**
   * The session behind the row, when the row is one. A run has none, and gets
   * the coarse status mark instead — `SessionStatus` reads worktree fields a run
   * has never had.
   */
  session?: Session | null
  /** Its pull request, for the one word about it that fits here. */
  pull?: WallPull | null
  /**
   * Which repository it is in — passed only when the rail spans more than one,
   * because narrowed to a single project it would be the same word on every row.
   */
  repoName?: string | null
}>()

/** A run's mark. `STATUS_LOOK` is the same table the filter chips are drawn from. */
const look = computed(() => STATUS_LOOK[props.item.status])

/**
 * Two things earn a row a marker: it is waiting on you, or it has produced
 * something that does not work. Both are cases where scrolling past would be a
 * mistake, which is the only thing a marker is for. Same rule and same gutter as
 * `.work-row`, so a session marked on the wide list is marked here too.
 */
const marker = computed(() => {
  const { session, item } = props
  if (session) {
    if (session.activity === 'awaiting-permission') return { '--row-marker': 'var(--accent)' }
    if (session.activity === 'idle' && session.check?.status === 'failing') {
      return { '--row-marker': 'var(--error)' }
    }
    return undefined
  }
  return item.status === 'needs-you' ? { '--row-marker': 'var(--warning)' } : undefined
})

/**
 * Only the states that stop the work. On the wide row a pull request gets its
 * number and a word; here the number is not what you are choosing between, and
 * "open, waiting" is not news.
 */
const pullNote = computed(() => {
  switch (props.pull?.state) {
    case 'conflicted': return { text: 'conflicted', color: 'var(--error)' }
    case 'checks-failing': return { text: 'CI red', color: 'var(--error)' }
    case 'changes-requested': return { text: 'changes requested', color: 'var(--warning)' }
    default: return null
  }
})
</script>

<template>
  <NuxtLink
    :to="item.to"
    data-row
    data-rail-row
    class="rail-row focus-ring"
    :style="marker"
    :title="item.title"
  >
    <span class="rail-row__glyph">
      <SessionStatus
        v-if="session"
        glyph
        :activity="session.activity"
        :changed-files="session.worktree.changedFiles"
        :dirty="session.worktree.dirty"
        :check="session.check"
        :check-stale="session.checkStale"
        :behind="session.worktree.behind"
        :landed="session.landed"
      />
      <UIcon
        v-else
        :name="look.icon"
        class="size-3.5 shrink-0"
        :class="{ 'animate-spin': item.status === 'running' }"
        :style="{ color: look.colour }"
        :title="item.outcome"
      />
    </span>

    <span class="rail-row__title">{{ item.title }}</span>

    <span class="rail-row__note">
      <!-- What is wrong with the pull request outranks where the session got to -->
      <span v-if="pullNote" :style="{ color: pullNote.color }">{{ pullNote.text }}</span>
      <span v-else>{{ item.outcome }}</span>
      <span v-if="repoName" class="shrink-0 ink-4">{{ repoName }}</span>
    </span>

    <span class="rail-row__when">{{ relativeTime(item.at) }}</span>
  </NuxtLink>
</template>
