<script setup lang="ts">
import { describeToolCall } from '~/utils/toolCalls'
import type { WallTick } from '~/utils/wall'

/**
 * Every step the fleet is taking, as it takes it.
 *
 * The tiles say what each session is doing; this says that *something* is
 * happening at all, which is a different question and the one a room answers
 * first. It is the closest thing here to a heartbeat, and it is the piece that
 * makes an otherwise static dashboard read as alive.
 *
 * Newest at the top rather than scrolling upward from the bottom. A feed that
 * moves everything on every poll cannot be read at a glance — the eye has to
 * find its place again each time — so lines fade in where they will stay, and
 * the oldest drops off the end.
 *
 * It is only ever fed live runs (see `/api/wall`), because a finished run's last
 * few calls streaming past as though they were happening is the one thing a
 * heartbeat must not do.
 */
const props = withDefaults(defineProps<{
  ticks: WallTick[]
  now: number
  /**
   * One row instead of a column, for the tape along the bottom of the wall.
   *
   * The column version is the whole feed; this is the newest few on a single line,
   * which is the smallest thing that still says "this is happening now". It exists
   * because the wall's rail has no room for a column and still needs the
   * heartbeat — without it a quiet minute reads as a machine that has stopped.
   */
  line?: boolean
}>(), { line: false })

const LINE_MAX = 3

const lines = computed(() => (props.line ? props.ticks.slice(0, LINE_MAX) : props.ticks).map((tick) => {
  const activity = describeToolCall({ toolName: tick.toolName, input: tick.input })
  return {
    key: `${tick.sessionId}-${tick.at}-${tick.toolName}`,
    repo: tick.repo,
    icon: activity.icon,
    verb: activity.verb,
    target: activity.target,
    /** Under a poll old, so it can arrive lit and settle. */
    fresh: props.now - tick.at < 4000,
  }
}))
</script>

<template>
  <div class="wall-ticker" :class="{ 'is-line': line }">
    <TransitionGroup name="tick">
      <p v-for="entry in lines" :key="entry.key" class="wall-tick" :class="{ 'is-fresh': entry.fresh }">
        <UIcon :name="entry.icon" class="wall-tick-icon shrink-0" />
        <span class="wall-tick-repo">{{ entry.repo }}</span>
        <span class="wall-tick-verb">{{ entry.verb }}</span>
        <span class="wall-tick-target truncate">{{ entry.target }}</span>
      </p>
    </TransitionGroup>

    <!--
      "No tool calls" rather than "nothing is running": a live run between two
      calls — thinking, or waiting on a process — produces no ticks, and this sat
      next to a table saying a session was working. A heartbeat that contradicts
      the thing it is under is worse than a quiet one.
    -->
    <p v-if="!lines.length" class="wall-tick-empty">No tool calls right now.</p>
  </div>
</template>

<style scoped>
.wall-ticker {
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
  /* Fades into the panel's edge rather than being cut, so the list reads as
     continuing rather than as having run out. */
  mask-image: linear-gradient(to bottom, black 88%, transparent 100%);
}

/*
 * The strip version. Row rather than column, and no mask — a single line that
 * faded at one end would read as text that had been cut off.
 */
.wall-ticker.is-line {
  flex-direction: row;
  align-items: center;
  gap: clamp(12px, 1.6vw, 32px);
  mask-image: none;
}

.wall-ticker.is-line .wall-tick {
  min-width: 0;
  flex: 0 1 auto;
}

/* Only the newest survives a narrow screen, rather than three truncated stubs. */
@media (max-width: 900px) {
  .wall-ticker.is-line .wall-tick:not(:first-child) {
    display: none;
  }
}

.wall-tick {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: clamp(10px, 0.75vw, 13px);
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: nowrap;
}

/*
 * Brighter than the lines below it rather than merely a different grey. On a
 * screen read from across a room the difference between two greys is not a
 * difference, and this one is carrying the only "it is happening *now*" the
 * panel has.
 */
.wall-tick.is-fresh {
  color: var(--text-primary);
}

.wall-tick-icon {
  width: clamp(10px, 0.7vw, 13px);
  height: clamp(10px, 0.7vw, 13px);
}

.wall-tick.is-fresh .wall-tick-icon {
  color: var(--accent);
}

.wall-tick-repo {
  color: var(--text-tertiary);
}

.wall-tick-verb {
  color: inherit;
}

.wall-tick-target {
  min-width: 0;
}

.wall-tick-empty {
  font-family: var(--font-mono);
  font-size: clamp(10px, 0.75vw, 13px);
  color: var(--text-disabled);
}

.tick-enter-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}

.tick-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.tick-leave-active {
  /* Absolute so the rest of the list does not jump while one leaves. */
  position: absolute;
  opacity: 0;
  transition: opacity 0.2s ease;
}

@media (prefers-reduced-motion: reduce) {
  .tick-enter-active, .tick-leave-active {
    transition: none;
  }
}
</style>
