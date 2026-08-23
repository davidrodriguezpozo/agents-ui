<script setup lang="ts">
import type { Session } from '~/composables/useSessions'
import type { WorkItem } from '~/utils/workList'
import { railGroups } from '~/utils/workList'
import { errorMessage } from '~/utils/errors'

/**
 * Everything in flight, beside the thing you are doing about it.
 *
 * The Work page used to be a list you went *out* to: opening a session replaced
 * the whole screen, so hopping from one to the next meant a trip back through the
 * list, and while you were in one session you could not see that another had gone
 * red. The TUI has never had that problem — `docs/tui.md` describes a rail of
 * everything that might want you beside a pane showing the row you are on, where
 * "switching between two running agents is a keypress rather than a trip out to a
 * list and back". This is that rail.
 *
 * It is presentation, a filter box and one action — closing a session whose work
 * has landed, which is the only thing the Done group at the bottom is for. The
 * fetching and the poll belong to `layouts/work.vue`, which is mounted for as
 * long as the surface is — if they lived here, collapsing the rail would stop the
 * poll that keeps the session you are *looking at* up to date.
 */
const {
  groups: allGroups, inFlightCount, tabCounts, everything, sessions,
  scope, elsewhere, elsewhereNeedsYou, pullFor,
} = useWorkList()

const { close } = useSessions()
const toast = useToast()

const { open, drawerOpen, width, toggle } = useWorkRail()
const { workingDir } = useWorkingDir()
const { nameFor } = useProjects()
const { pane } = useWorkPane()

const router = useRouter()
const route = useRoute()

/** Filtering the rail, which is not the same box as the one on History. */
const filter = ref('')

const groups = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return allGroups.value

  return railGroups(
    everything.value.filter(item =>
      `${item.title} ${item.detail ?? ''} ${item.outcome}`.toLowerCase().includes(q),
    ),
  )
})

const matching = computed(() => groups.value.reduce((n, group) => n + group.items.length, 0))

/** The session behind a row, when the row is one. `null` means it is a run. */
function sessionFor(item: WorkItem): Session | null {
  if (item.origin !== 'session') return null
  const id = item.key.slice('session:'.length)
  return sessions.value.find(s => s.id === id) ?? null
}

/**
 * The repository a row belongs to, said only when the list spans more than one.
 * Narrowed to "this project" it would be the same word on every row.
 */
function repoFor(item: WorkItem): string | null {
  if (scope.value === 'here') return null
  const session = sessionFor(item)
  return session ? nameFor(session.repoDir) : null
}

/**
 * Closing a merged session from the rail, in two presses.
 *
 * The Done group exists because a session whose work is in the base still has a
 * worktree, a branch and a whole checkout of the repository sitting on disk, and
 * closing it is the only thing left to do with it. Doing that from here rather
 * than from inside the session is the same argument the rail is built on: it is a
 * tidy-up, and a tidy-up that costs a trip into a page and back does not happen.
 *
 * Asked twice, unlike everything else on this rail, because this one cannot be
 * undone — the worktree is removed and the branch deleted. Not a modal, though:
 * a dialog for a decision this small is heavier than the decision, and the second
 * press is on the same 60 pixels as the first.
 *
 * Uncommitted work is refused by the server rather than checked for here. A
 * merged session with edits still in it is unusual enough that spending a rail
 * row on saying so is worse than the toast that says it if you try.
 */
const asking = ref<string | null>(null)
const closingKey = ref<string | null>(null)

async function onClose(item: WorkItem, session: Session) {
  if (asking.value !== item.key) {
    asking.value = item.key
    return
  }

  asking.value = null
  closingKey.value = item.key
  try {
    const result = await close(session.id)
    toast.add({
      title: result.branchKept
        ? `Closed — workspace removed, branch ${result.branchKept} kept`
        : 'Closed — workspace removed and branch deleted',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: 'Could not close it', description: errorMessage(e), color: 'error' })
  } finally {
    closingKey.value = null
  }
}

/** Start something. The page focuses its composer off `?new=1`. */
function startNew() {
  pane.value = 'start'
  router.push({ path: '/work', query: { new: '1' } })
}

function showHistory() {
  pane.value = 'history'
  router.push('/work')
}

/**
 * Put it away. Over the pane that means dismissing the drawer; beside it, that
 * means collapsing the column — and only the second one is remembered, because
 * the drawer being shut is the resting state rather than a preference.
 */
function hide() {
  if (drawerOpen.value) drawerOpen.value = false
  else toggle()
}

// A row you tapped in the drawer has done what the drawer was opened for. A
// half-asked close goes with it: an unanswered question about a row you have
// navigated away from must not still be armed when you come back.
watch(() => route.fullPath, () => {
  drawerOpen.value = false
  asking.value = null
})
</script>

<template>
  <!--
    Below `lg` this same element is a drawer over the pane rather than a column
    beside it — see the media query on `.rail` in main.css. One instance either
    way: two would be two lists to keep in step, and `j` would walk through both
    copies of every session.
  -->
  <aside
    v-if="open || drawerOpen"
    data-rail
    class="rail"
    :class="{ 'rail--shown': drawerOpen }"
    :style="{ '--rail-w': `${width}px` }"
    aria-label="Work in flight"
  >
    <!-- Heading, the count, and the way to put it away -->
    <div
      class="shrink-0 flex items-center gap-2 px-3"
      :style="{ height: 'var(--header-h)', borderBottom: '1px solid var(--border-subtle)' }"
    >
      <span class="text-section-label flex-1 min-w-0">In flight</span>
      <span v-if="inFlightCount" class="type-mono-meta">{{ inFlightCount }}</span>
      <UButton
        icon="i-lucide-panel-left-close"
        size="xs"
        variant="ghost"
        color="neutral"
        title="Hide the rail (\ brings it back)"
        @click="hide"
      />
    </div>

    <div class="px-2.5 pt-2.5 pb-1.5 space-y-1.5 shrink-0">
      <UButton
        label="New session"
        icon="i-lucide-plus"
        size="xs"
        block
        :disabled="!workingDir"
        :title="workingDir ? 'Start a session — n' : 'Pick a project first'"
        @click="startNew"
      />

      <!--
        Only worth a box once there is enough here to lose something in. Below
        that it is a control that can only ever narrow a list you can already
        see all of.
      -->
      <input
        v-if="inFlightCount > 5"
        v-model="filter"
        class="field-search w-full"
        placeholder="Filter…"
      />

      <!--
        Only worth a control when there is somewhere else to look. One project
        means one possible answer, and a toggle with one position is furniture.
      -->
      <div
        v-if="workingDir && elsewhere.length"
        class="flex items-center gap-0.5 p-0.5 rounded-md"
        style="background: var(--input-bg); border: 1px solid var(--border-subtle);"
      >
        <button
          v-for="option in [{ value: 'here' as const, label: 'This project' }, { value: 'all' as const, label: 'All' }]"
          :key="option.value"
          class="flex-1 px-2 py-0.5 rounded fs-micro font-medium transition-all focus-ring flex items-center justify-center gap-1"
          :style="{
            background: scope === option.value ? 'var(--accent-muted)' : 'transparent',
            color: scope === option.value ? 'var(--accent)' : 'var(--text-disabled)',
          }"
          @click="scope = option.value"
        >
          {{ option.label }}
          <!--
            The one number that justifies switching: work blocked in a project
            this view is currently hiding.
          -->
          <span
            v-if="option.value === 'all' && scope === 'here' && elsewhereNeedsYou"
            style="color: var(--error);"
          >{{ elsewhereNeedsYou }}</span>
        </button>
      </div>
    </div>

    <div class="rail__list">
      <template v-for="group in groups" :key="group.status">
        <div class="rail-group">
          <span class="flex-1 min-w-0">{{ group.title }}</span>
          <span class="rail-group__count">{{ group.items.length }}</span>
        </div>
        <!--
          Wrapped rather than given a button of its own inside the row, because
          the row is a link: a second target inside one is invalid markup and a
          click nobody can aim — the same call `SessionCard` makes about a pull
          request. So the control is a sibling laid over the row's right edge,
          and only the Done group has one.
        -->
        <div
          v-for="item in group.items"
          :key="item.key"
          class="rail-slot"
          :class="{ 'rail-slot--closeable': item.status === 'landed' }"
        >
          <WorkRailRow
            :item="item"
            :session="sessionFor(item)"
            :pull="sessionFor(item) ? pullFor(sessionFor(item)!) : null"
            :repo-name="repoFor(item)"
          />
          <button
            v-if="item.status === 'landed' && sessionFor(item)"
            class="rail-slot__close"
            :class="{ 'is-asking': asking === item.key }"
            :disabled="closingKey === item.key"
            :title="asking === item.key
              ? `Removes ${sessionFor(item)!.worktreePath} and deletes the branch. The commits are in ${sessionFor(item)!.baseBranch}.`
              : `Close it — remove the workspace now its commits are in ${sessionFor(item)!.baseBranch}`"
            @click="onClose(item, sessionFor(item)!)"
          >
            {{ closingKey === item.key ? 'Closing…' : asking === item.key ? 'Remove?' : 'Close' }}
          </button>
        </div>
      </template>

      <!--
        Two different empty states, because they are two different situations and
        only one of them is a dead end.
      -->
      <p v-if="filter.trim() && !matching" class="type-meta px-3 py-4">
        Nothing in flight matches “{{ filter.trim() }}”.
      </p>
      <p v-else-if="!inFlightCount" class="type-meta px-3 py-4 leading-relaxed">
        Nothing is in flight. Start a session and it appears here while it works
        and while it is waiting on you.
      </p>
    </div>

    <!-- What is not in flight, and therefore not in the rail -->
    <div
      class="shrink-0 px-2.5 py-2"
      style="border-top: 1px solid var(--border-subtle);"
    >
      <button
        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover-row focus-ring fs-mono"
        :style="{ color: pane === 'history' ? 'var(--accent)' : 'var(--text-tertiary)' }"
        title="Sessions, rituals and commands that are finished with"
        @click="showHistory"
      >
        <UIcon name="i-lucide-history" class="size-3.5 shrink-0" />
        <span class="flex-1 text-left">History</span>
        <span v-if="tabCounts.history" class="type-mono-meta">{{ tabCounts.history }}</span>
      </button>
    </div>
  </aside>
</template>
