<script setup lang="ts">
import { landedLabel, type WallLanded } from '~/utils/wall'

/**
 * What shipped, which is the first thing anybody asks and the last thing this
 * app used to be able to answer.
 *
 * The sentence on each row is the session's own summary where it has one — a
 * line written from its diff, in user-facing terms — falling back to the
 * instruction it was given. That is the difference between a wall a
 * non-programmer can read and a list of branch names.
 *
 * How it got in is always stated, because "merged on github.com" is somebody
 * else's doing and a wall of what this machine did must not claim it.
 */
const props = defineProps<{
  entries: WallLanded[]
  now: number
}>()

const SHOWN = 6

const shown = computed(() => props.entries.slice(0, SHOWN))
const rest = computed(() => Math.max(0, props.entries.length - shown.value.length))

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <section class="act-landed" aria-label="What landed today">
    <header class="act-landed-head">
      <span class="act-landed-count">{{ entries.length }}</span>
      <h2 class="act-landed-title">
        {{ entries.length === 1 ? 'change landed today' : 'changes landed today' }}
      </h2>
    </header>

    <ul class="act-landed-list">
      <li v-for="entry in shown" :key="entry.sessionId" class="act-landed-row">
        <span class="act-landed-time">{{ clock(entry.at) }}</span>
        <span class="min-w-0">
          <span class="act-landed-what">{{ entry.title }}</span>
          <span class="act-landed-how">{{ entry.repo }} · {{ landedLabel(entry.how) }}</span>
        </span>
      </li>
    </ul>

    <p v-if="rest" class="act-landed-rest">and {{ rest }} more</p>
  </section>
</template>

<style scoped>
.act-landed {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(14px, 2.5vh, 34px);
  padding: 0 clamp(12px, 3vw, 70px);
}

.act-landed-head {
  display: flex;
  align-items: baseline;
  gap: clamp(10px, 1.4vw, 22px);
}

.act-landed-count {
  font-family: var(--font-mono);
  font-size: clamp(40px, 6vw, 110px);
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
  color: var(--success);
}

.act-landed-title {
  font-family: var(--font-sans);
  font-size: clamp(17px, 1.9vw, 38px);
  font-weight: 500;
  color: var(--text-primary);
}

.act-landed-list {
  display: flex;
  flex-direction: column;
  gap: clamp(6px, 1.2vh, 16px);
  min-width: 0;
}

.act-landed-row {
  display: flex;
  align-items: baseline;
  gap: clamp(10px, 1.2vw, 22px);
  min-width: 0;
}

.act-landed-time {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: clamp(12px, 1vw, 20px);
  font-variant-numeric: tabular-nums;
  color: var(--text-disabled);
}

.act-landed-what {
  display: block;
  font-family: var(--font-sans);
  font-size: clamp(14px, 1.4vw, 28px);
  font-weight: 500;
  line-height: 1.25;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.act-landed-how {
  display: block;
  font-family: var(--font-mono);
  font-size: clamp(11px, 0.85vw, 17px);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.act-landed-rest {
  font-family: var(--font-mono);
  font-size: clamp(11px, 0.85vw, 16px);
  color: var(--text-disabled);
}
</style>
