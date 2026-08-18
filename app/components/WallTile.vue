<script setup lang="ts">
import { describeToolCall } from '~/utils/toolCalls'
import { sessionBadge } from '~/utils/sessionBadge'
import { elapsedLabel, landedLabel, urgencyOf, type WallTile } from '~/utils/wall'

/**
 * One session, as much of it as reads from four feet away.
 *
 * The hierarchy is the argument. Biggest is what it is *doing* — the live tool
 * call, or the verdict once it has stopped — because that is the only line worth
 * crossing a room for. The title is second and clamped to two lines. Everything
 * else (branch, turns, clock) is monospaced meta at the bottom, present for
 * whoever walks up close and ignorable from further back.
 *
 * The left edge carries the urgency as colour *and* as its own width, so the
 * four groups are distinguishable without relying on hue — the same reasoning
 * the night-shift chart sets out at length, and the same reason the badge below
 * keeps its glyph.
 */
const props = defineProps<{
  tile: WallTile
  /** Ticked by the page every second, so the clock counts up without a refetch. */
  now: number
}>()

const urgency = computed(() => urgencyOf(props.tile))

const TONES = {
  'needs-you': 'var(--accent)',
  broken: 'var(--error)',
  working: 'var(--accent)',
  settled: 'var(--text-disabled)',
} as const

const tone = computed(() => TONES[urgency.value])

/**
 * The verdict wording comes from `sessionBadge` rather than from here, so a
 * tile and the session row it stands for can never disagree about whether the
 * work is good. `changesUnknown` is the honest part: this tile was built without
 * asking git anything, so it must not claim there were no changes.
 */
const badge = computed(() => sessionBadge({
  activity: props.tile.activity,
  check: props.tile.check,
  checkStale: props.tile.checkStale,
  landed: Boolean(props.tile.landedAt),
  changesUnknown: true,
}))

/** What it is doing this second, in the words a person would have used. */
const doing = computed(() => {
  const call = props.tile.doing
  if (!call) return null
  return describeToolCall({ toolName: call.toolName, input: call.input })
})

const elapsed = computed(() => elapsedLabel(props.tile.startedAt, props.now))

const headline = computed(() => {
  if (props.tile.activity === 'awaiting-permission') return 'Waiting for you to answer'
  if (props.tile.landedAt && urgency.value === 'settled') return landedLabel(props.tile.landedHow ?? 'merged')
  if (doing.value) return `${doing.value.verb} ${doing.value.target}`.trim()
  return badge.value.label
})
</script>

<template>
  <NuxtLink
    :to="`/sessions/${tile.sessionId}`"
    class="wall-tile"
    :class="[`is-${urgency}`, { 'is-live': tile.activity === 'working' }]"
    :style="{ '--tile-tone': tone }"
  >
    <div class="wall-tile-edge" />

    <div class="wall-tile-body">
      <header class="flex items-center gap-2 min-w-0">
        <UIcon
          :name="badge.icon"
          class="wall-tile-glyph shrink-0"
          :class="{ 'animate-spin': badge.spin }"
        />
        <span class="wall-tile-repo truncate">{{ tile.repo }}</span>
        <span class="wall-tile-sep">/</span>
        <span class="wall-tile-branch truncate">{{ tile.branch }}</span>

        <span v-if="tile.pending" class="wall-tile-pill">
          {{ tile.pending }} to answer
        </span>
        <span v-else-if="tile.repairing" class="wall-tile-pill">fixing itself</span>
        <span v-else-if="tile.prUrl" class="wall-tile-pill">PR open</span>
      </header>

      <p class="wall-tile-title">{{ tile.title }}</p>

      <p class="wall-tile-doing" :title="doing ? `${doing.verb} ${doing.target}` : headline">
        <UIcon v-if="doing" :name="doing.icon" class="wall-tile-doing-icon shrink-0" />
        <span class="truncate">{{ headline }}</span>
      </p>

      <footer class="wall-tile-meta">
        <span v-if="elapsed" class="wall-tile-clock">{{ elapsed }}</span>
        <span v-else class="wall-tile-verdict" :style="{ color: badge.color }">{{ badge.label }}</span>
        <span class="wall-tile-turns">{{ tile.turns }} turn{{ tile.turns === 1 ? '' : 's' }}</span>
      </footer>
    </div>
  </NuxtLink>
</template>

<style scoped>
.wall-tile {
  position: relative;
  display: flex;
  min-width: 0;
  /*
   * Rows share the grid's height, which is right at ten tiles and absurd at one:
   * a single session became a card two thirds of a screen tall with a void in
   * the middle of it. Capped here rather than in the grid, because the cap only
   * ever binds in the sparse case — with a full wall the row is already smaller
   * than this.
   */
  max-height: clamp(150px, 24vh, 260px);
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  transition: border-color 0.3s ease, transform 0.15s ease;
}

.wall-tile:hover {
  border-color: var(--tile-tone);
}

.wall-tile-edge {
  width: 4px;
  flex-shrink: 0;
  background: var(--tile-tone);
}

/*
 * Wider for the two groups somebody has to do something about, so the grouping
 * survives being photographed, projected, or looked at by somebody who does not
 * separate red from amber.
 */
.wall-tile.is-needs-you .wall-tile-edge,
.wall-tile.is-broken .wall-tile-edge {
  width: 8px;
}

.wall-tile.is-needs-you {
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
}

.wall-tile.is-broken {
  border-color: color-mix(in srgb, var(--error) 40%, transparent);
}

.wall-tile-body {
  flex: 1;
  min-width: 0;
  padding: clamp(10px, 1vw, 18px);
  display: flex;
  flex-direction: column;
  gap: clamp(4px, 0.5vh, 10px);
}

.wall-tile-glyph {
  width: clamp(13px, 1vw, 17px);
  height: clamp(13px, 1vw, 17px);
  color: var(--tile-tone);
}

.wall-tile-repo,
.wall-tile-branch,
.wall-tile-sep {
  font-family: var(--font-mono);
  font-size: clamp(10px, 0.75vw, 13px);
  color: var(--text-tertiary);
}

.wall-tile-repo {
  color: var(--text-secondary);
}

.wall-tile-pill {
  margin-left: auto;
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 999px;
  font-family: var(--font-sans);
  font-size: clamp(9.5px, 0.7vw, 12px);
  background: color-mix(in srgb, var(--tile-tone) 14%, transparent);
  color: var(--tile-tone);
  white-space: nowrap;
}

.wall-tile-title {
  font-family: var(--font-sans);
  font-size: clamp(13px, 1.05vw, 19px);
  font-weight: 500;
  line-height: 1.3;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* The line the wall exists for: what is happening, in the largest quiet type. */
.wall-tile-doing {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: clamp(11px, 0.85vw, 15px);
  color: var(--text-secondary);
}

.wall-tile-doing-icon {
  width: clamp(11px, 0.8vw, 14px);
  height: clamp(11px, 0.8vw, 14px);
  color: var(--text-tertiary);
}

.wall-tile-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: clamp(10px, 0.75vw, 13px);
  color: var(--text-tertiary);
}

.wall-tile-clock {
  font-variant-numeric: tabular-nums;
  color: var(--tile-tone);
}

.wall-tile-verdict {
  font-family: var(--font-sans);
}

.wall-tile-turns {
  white-space: nowrap;
}

/*
 * A slow breath while a turn is in flight. Slow on purpose: at a second or two
 * it reads as urgency, and on a screen left on all day urgency that means
 * nothing is the fastest way to make somebody stop seeing the screen.
 */
.wall-tile.is-live {
  animation: wall-breathe 4.5s ease-in-out infinite;
}

@keyframes wall-breathe {
  0%, 100% { border-color: var(--border-subtle); }
  50% { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
}

@media (prefers-reduced-motion: reduce) {
  .wall-tile.is-live {
    animation: none;
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
}
</style>
