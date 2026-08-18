<script setup lang="ts">
import { untilLabel, type WallRitual, type WallTile } from '~/utils/wall'

/**
 * The tiles, or the reason there are none.
 *
 * Its own component because both layouts need exactly this: the fleet is the
 * left-hand column of the normal wall and one act of the rotation, and two
 * copies of the same grid would drift the day one of them gained a state.
 *
 * The quiet state is most of a working day, so it is not treated as an absence.
 * What somebody glancing at an idle wall wants is the reassurance that it is idle
 * on purpose — the next thing due, and when.
 */
defineProps<{
  tiles: WallTile[]
  /** Tiles that earned a place and did not fit, counted rather than dropped. */
  hidden: number
  nextRitual?: WallRitual | null
  now: number
}>()
</script>

<template>
  <section class="fleet" aria-label="Sessions">
    <div v-if="tiles.length" class="fleet-grid">
      <WallTile v-for="tile in tiles" :key="tile.sessionId" :tile="tile" :now="now" />
    </div>

    <div v-else class="fleet-quiet">
      <UIcon name="i-lucide-moon-star" class="fleet-quiet-icon" />
      <p class="fleet-quiet-line">Nothing is running.</p>
      <p v-if="nextRitual" class="fleet-quiet-next">
        {{ nextRitual.title }}
        <span class="fleet-quiet-when">{{ untilLabel(nextRitual.at, now) }}</span>
      </p>
      <p v-else class="fleet-quiet-next">No scheduled work is due.</p>
    </div>

    <p v-if="hidden" class="fleet-more">and {{ hidden }} more not shown</p>
  </section>
</template>

<style scoped>
.fleet {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/*
 * Auto-fill rather than a fixed count, and rows that share the height equally,
 * so two sessions are two large tiles and eleven are eleven readable ones —
 * without either case scrolling. Scrolling is the one thing a wall cannot do,
 * because nobody is there to do it.
 */
.fleet-grid {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(clamp(210px, 20vw, 330px), 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: clamp(8px, 0.8vw, 16px);
}

.fleet-quiet {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: 12px;
  border: 1px dashed var(--border-subtle);
}

.fleet-quiet-icon {
  width: clamp(24px, 2.4vw, 42px);
  height: clamp(24px, 2.4vw, 42px);
  color: var(--text-disabled);
}

.fleet-quiet-line {
  font-family: var(--font-sans);
  font-size: clamp(18px, 1.8vw, 34px);
  font-weight: 500;
  color: var(--text-secondary);
}

.fleet-quiet-next {
  font-family: var(--font-sans);
  font-size: clamp(12px, 1vw, 18px);
  color: var(--text-tertiary);
}

.fleet-quiet-when {
  font-family: var(--font-mono);
  color: var(--accent);
  margin-left: 6px;
}

.fleet-more {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: clamp(10px, 0.75vw, 13px);
  color: var(--text-disabled);
  text-align: right;
}
</style>
