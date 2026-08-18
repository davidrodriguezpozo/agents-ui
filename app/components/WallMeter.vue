<script setup lang="ts">
import type { Meter } from '~/utils/wall'

/**
 * One number, as a bar, for reading across a room.
 *
 * The label is above the bar rather than beside it because the two lines are
 * read at different distances: the fill is legible from anywhere, the words only
 * from a few feet, and stacking them means the useful half is never squeezed by
 * the precise half.
 *
 * The bar is drawn even at zero, because an empty track still says "there is a
 * limit here and you are nowhere near it" — a different fact from the meter
 * being absent, which is what a wall shows when a reading is stale.
 *
 * The exception is a meter with no limit behind it at all: a full-width empty
 * track reads as a *full* bar from any distance, and drawing one for a cap
 * nobody set was the first thing to look wrong on a real screen. So a quiet
 * meter at zero is the number alone.
 */
const props = defineProps<{
  label: string
  meter: Meter
  /** Overrides the meter's own words, for a bar whose caption is the headline. */
  caption?: string
}>()

const TONES: Record<Meter['tone'], string> = {
  quiet: 'var(--text-tertiary)',
  accent: 'var(--accent)',
  warning: 'var(--warning)',
  error: 'var(--error)',
}

const colour = computed(() => TONES[props.meter.tone])

/** Nothing to fill and nothing that could fill it — see the note above. */
const trackless = computed(() => props.meter.tone === 'quiet' && props.meter.fraction === 0)
</script>

<template>
  <div class="wall-meter">
    <span class="wall-meter-name">{{ label }}</span>
    <span class="wall-meter-value" :style="{ color: colour }">{{ caption ?? meter.label }}</span>

    <div
      class="wall-meter-track"
      :class="{ 'is-empty': trackless }"
      role="meter"
      :aria-valuenow="Math.round(meter.fraction * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`${label}: ${caption ?? meter.label}`"
    >
      <div
        class="wall-meter-fill"
        :style="{ width: `${Math.max(meter.fraction * 100, meter.fraction > 0 ? 1.5 : 0)}%`, background: colour }"
      />
    </div>
  </div>
</template>

<style scoped>
/*
 * A block with one line of text in it, and the bar under that line.
 *
 * Not a flex container, and that is the whole point. The header aligns its
 * readouts by baseline, and a flex item's baseline is supposed to come from its
 * first line — but Chrome does not reliably propagate one out of a *nested* flex
 * container, so as a flex box this meter reported its bottom edge instead and its
 * caption sat eleven pixels above the clock's baseline whatever the row was told
 * to do. A block box's baseline is its first line box, which is unambiguous.
 *
 * The words are therefore laid out inline — the name, a gap, the value — and the
 * bar is the second thing in the block, hanging below the line the words share.
 */
.wall-meter {
  display: block;
  white-space: nowrap;
}

.wall-meter-name {
  font-family: var(--font-sans);
  font-size: clamp(11px, 0.85vw, 14px);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.wall-meter-value {
  margin-left: 8px;
  font-family: var(--font-mono);
  font-size: clamp(11px, 0.9vw, 15px);
  font-variant-numeric: tabular-nums;
  /*
   * Never wrapped and never clipped. Wrapping put the bar out of the header's
   * line; clipping produced "five-hour has ro…" on a screen meant to be read
   * from the back of a room. So the words size the meter instead, which the
   * header can afford now that it is one line rather than a column of blocks.
   */
  white-space: nowrap;
}

.wall-meter-track {
  /* The second thing in the block, so it sits under the line the words share. */
  margin-top: 5px;
  height: 6px;
  border-radius: 999px;
  background: var(--border-subtle);
  overflow: hidden;
}

/*
 * Kept in the layout, taken out of the picture.
 *
 * Removing the element entirely made a meter with no limit behind it a line
 * shorter than the one beside it, which left the header's two meters on different
 * baselines and the shorter one floating against the clock. Transparent keeps the
 * row aligned without drawing a track that, at full width, reads as a full bar.
 */
.wall-meter-track.is-empty {
  background: transparent;
}

.wall-meter-fill {
  height: 100%;
  border-radius: 999px;
  /* Slow, because a bar that snaps looks like a redraw rather than a change. */
  transition: width 0.6s ease, background 0.3s ease;
}
</style>
