<script setup lang="ts">
/**
 * The work surface: the rail, and whatever you are doing about it.
 *
 * A layout rather than a component dropped into three pages, because the whole
 * value of the rail is that it *survives* the navigation. Remounting it on every
 * hop would reset its scroll position and restart its poll — and a list that
 * jumps back to the top every time you open a row is worse than no list, because
 * you lose your place in the one thing you were reading.
 *
 * Which pages use it: `/work`, `/sessions/[id]` and `/runs/[id]` — the routes
 * where hopping between pieces of work is the job. Everything else stays full
 * width; a rail on Land or Library would be 264px spent on a list nobody on
 * those screens is walking.
 */
const { drawerOpen } = useWorkRail()
const { refresh, watchContinuously, stopWatching, pulls } = useWorkList()
const { ensureLoaded: ensureProjectsLoaded } = useProjects()
const { fetchAll: fetchWorktrees } = useWorktrees()

/**
 * The fetching and the poll live here rather than in the rail, because the rail
 * can be collapsed and the surface cannot. Owned by the rail, `\` would have
 * stopped the poll that keeps the session you are looking at up to date — the
 * status marks and the pane would both go stale because a panel was hidden.
 */
const { reading: pullsReading, watchPulls } = useWallPulls()
watchPulls()

/**
 * The single pull-request reading for this surface, published where the rail and
 * the pane can both see it. `useWallPulls` is one poll per screen by design; two
 * callers would be two pollers, and the second one's reading would be the empty
 * one everything else was rendering from. See the `pulls` docblock in
 * `useWorkList`.
 */
watch(pullsReading, (reading) => { pulls.value = reading }, { immediate: true })

onMounted(async () => {
  await Promise.all([refresh(), fetchWorktrees(), ensureProjectsLoaded()])
  watchContinuously()
})

// The poll belongs to the surface, so it stops when the surface does. Left
// running it would go on shelling out to git behind /land for as long as the tab
// is open.
onUnmounted(stopWatching)
</script>

<template>
  <!--
    `items-start` is what lets the rail be sticky rather than stretched: with the
    default `stretch` it would be as tall as the pane's content and have nothing
    to stick within. `min-h-screen` keeps it from overflowing a pane shorter than
    the window.

    No `<main>` in here — the shell owns the only one, because `visibleRows()`
    queries `main [data-row]` and `scroller()` takes the first `main` in the
    document. Two would make both of those mean two different elements.
  -->
  <div class="flex items-start min-h-screen">
    <WorkRail />

    <!--
      The backdrop for the drawer, which only exists below `lg` — above it the
      rail is a column and there is nothing to dismiss.
    -->
    <Transition name="fade">
      <div
        v-if="drawerOpen"
        class="fixed inset-0 z-30 lg:hidden"
        style="background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px);"
        @click="drawerOpen = false"
      />
    </Transition>

    <!--
      `overflow-x-clip` is what keeps the rail still.

      The shell's `<main>` is one scroll container for both columns, and
      `overflow-y: auto` on it makes the *other* axis scroll too the moment
      anything is wider than the pane. Nothing here is sticky sideways, so the
      rail slid out of view along with the page — a session whose header did not
      quite fit took the list of sessions off screen with it.

      `clip` rather than `hidden`: hidden would make this a scroll container of
      its own, and the page header's `sticky top-0` sticks to whichever ancestor
      scrolls. It would then stick to a box that never scrolls, and scroll away
      with the transcript.
    -->
    <div class="flex-1 min-w-0 overflow-x-clip">
      <!--
        The way back to the rail on a window too narrow to hold it. Offset past
        the shell's own hamburger below `md`, where both are on screen and both
        want the top-left corner; the bottom corner was tried first and sat under
        the terminal dock.
      -->
      <button
        v-if="!drawerOpen"
        class="fixed top-3 left-16 md:left-4 z-30 lg:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-md press-scale focus-ring fs-mono"
        style="background: var(--surface-overlay); border: 1px solid var(--border-default); color: var(--text-secondary);"
        aria-label="Show work in flight"
        @click="drawerOpen = true"
      >
        <UIcon name="i-lucide-panel-left-open" class="size-3.5 shrink-0" />
        In flight
      </button>

      <slot />
    </div>
  </div>
</template>

<style scoped>
/* Matches the shell's own backdrop transition, so the two read as one app. */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
