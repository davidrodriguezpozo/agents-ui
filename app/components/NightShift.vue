<script setup lang="ts">
import {
  LANE_ORDER,
  formatClock,
  formatDuration,
  formatStamp,
  formatWindowLabel,
  hourTicks,
  layoutNight,
  spendCurve,
  summarizeNight,
  type NightBlock,
  type NightOutcome,
} from '~/utils/nightShift'
import type { RunSource } from '~/composables/useRuns'

/**
 * What the machine did while you were not watching.
 *
 * The one picture of this product's actual claim. Runs already carried a start,
 * a duration, a cost and an outcome, and all of it was only ever a list sorted by
 * recency — which cannot answer the questions that are about *when*: was anything
 * happening at 03:00, did the 08:00 ritual wait behind a check, did the money
 * arrive in one lump or spread across the night.
 *
 * **On colour.** These are the app's own semantic tokens, not a palette invented
 * here, so a failed block is the same red as the failure badge on the row below
 * it. Running that trio through a CVD validator FAILs the red↔amber pair on
 * normal-vision separation, and the honest fix is not to repaint a system used
 * everywhere else for the benefit of one chart — it is to stop relying on hue.
 * So every outcome carries a glyph as well as a colour, `cancelled` is outlined
 * rather than filled, the legend names all five, and the table view below states
 * each one in words. Hue is the fast path, never the only one.
 *
 * **On width.** A four-second run is a rounding error on a 24-hour axis, so short
 * blocks are floored to something clickable. That makes width unreliable for
 * short runs by construction, which is why duration is never read off the bar:
 * it is in the tooltip and in the table.
 */

const props = withDefaults(defineProps<{
  /** Rendered smaller, without the spend strip, for a sidebar or a card. */
  compact?: boolean
}>(), { compact: false })

const { data, loading, error, hours, now, fetchWindow, watchWindow } = useNightShift()

watchWindow()

const WINDOWS = [
  { hours: 12, label: '12h' },
  { hours: 24, label: '24h' },
  { hours: 48, label: '48h' },
]

/** Colour and glyph per outcome. The glyph is what makes it not colour-alone. */
const OUTCOMES: Record<NightOutcome, { label: string; color: string; icon: string; hollow?: boolean }> = {
  running: { label: 'Running', color: 'var(--accent)', icon: 'i-lucide-loader-2' },
  succeeded: { label: 'Finished', color: 'var(--success)', icon: 'i-lucide-check' },
  attention: { label: 'Needed you', color: 'var(--warning)', icon: 'i-lucide-circle-alert' },
  failed: { label: 'Failed', color: 'var(--error)', icon: 'i-lucide-x' },
  cancelled: { label: 'Stopped by you', color: 'var(--text-disabled)', icon: 'i-lucide-minus', hollow: true },
}

const LANE_LABELS: Record<RunSource, string> = {
  ritual: 'Rituals',
  session: 'Sessions',
  agent: 'Agents',
  command: 'Commands',
}

const runs = computed(() => data.value?.runs ?? [])
const from = computed(() => data.value?.from ?? now.value - 86_400_000)
const to = computed(() => Math.max(data.value?.to ?? now.value, now.value))

const lanes = computed(() => layoutNight(runs.value, from.value, to.value, now.value))
const ticks = computed(() => hourTicks(from.value, to.value, hours.value > 24 ? 6 : 3))
const spend = computed(() => spendCurve(runs.value, from.value, to.value, now.value))
const summary = computed(() => summarizeNight(runs.value, now.value))

/** Lanes with nothing in them are dropped — an empty row is a row of noise. */
const activeLanes = computed(() => lanes.value.filter(lane => lane.blocks.length > 0))

const nowLeft = computed(() => {
  const span = Math.max(1, to.value - from.value)
  return Math.min(1, Math.max(0, (now.value - from.value) / span))
})

/** Only the outcomes actually present, so the legend describes this night. */
const legend = computed(() =>
  (Object.keys(OUTCOMES) as NightOutcome[])
    .filter(outcome => summary.value.byOutcome[outcome] > 0)
    .map(outcome => ({ outcome, ...OUTCOMES[outcome], count: summary.value.byOutcome[outcome] })),
)

const spendPath = computed(() => {
  const points = spend.value.points
  if (points.length < 2) return ''
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.left * 100).toFixed(3)},${(100 - p.value * 100).toFixed(3)}`)
    .join(' ')
})

const spendArea = computed(() => {
  if (!spendPath.value) return ''
  const last = spend.value.points.at(-1)!
  return `${spendPath.value} L${(last.left * 100).toFixed(3)},100 L0,100 Z`
})

/**
 * Where the line ends, marked.
 *
 * Cumulative spend rises and then holds, so the area saturates and the whole
 * strip reads as one flat wash with no obvious "you are here". The endpoint is
 * the only value on the series anybody wants — what it has cost so far — and
 * the total beside the label is what it says in words.
 */
const spendEnd = computed(() => {
  const last = spend.value.points.at(-1)
  if (!last || spend.value.points.length < 2) return null
  return { x: last.left * 100, y: 100 - last.value * 100 }
})

/**
 * Direct labels only where the block is wide enough to hold one.
 *
 * A number on every mark is chaos and goes unread; a label clipped by its own
 * bar is worse than no label. 7% of the axis is about six characters at the
 * widths this renders at.
 */
const LABEL_THRESHOLD = 0.07

function blockLabel(block: NightBlock): string | null {
  if (props.compact || block.width < LABEL_THRESHOLD) return null
  return block.run.title
}

const hovered = ref<NightBlock | null>(null)
const tooltipLeft = ref(0)

function show(block: NightBlock) {
  hovered.value = block
  // Anchored to the block's middle, then kept inside the plot so a run near
  // either edge does not push the tooltip off it.
  tooltipLeft.value = Math.min(0.92, Math.max(0.08, block.left + block.width / 2))
}

function hide() {
  hovered.value = null
}

function costLabel(usd: number): string {
  if (!usd) return '$0'
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

const showTable = ref(false)

/** Newest first, which is the order a table of runs is read in. */
const tableRows = computed(() =>
  activeLanes.value
    .flatMap(lane => lane.blocks.map(block => ({ lane: lane.source, block })))
    .sort((a, b) => b.block.startedAt - a.block.startedAt),
)
</script>

<template>
  <section
    class="rounded-lg overflow-hidden"
    style="border: 1px solid var(--border-subtle); background: var(--surface-raised);"
    aria-labelledby="night-shift-title"
  >
    <!-- One filter row, above everything it scopes -->
    <header
      class="flex items-center gap-3 flex-wrap px-4 py-2.5"
      style="background: var(--surface-base); border-bottom: 1px solid var(--border-subtle);"
    >
      <h2 id="night-shift-title" class="text-section-label">The night shift</h2>
      <!--
        Only once the window has been fetched. Before that `from` is derived from
        `Date.now()`, which is a different instant on the server than in the
        browser — so rendering it during SSR is a hydration mismatch waiting for
        a minute boundary to fall between the two.
      -->
      <span v-if="data" class="type-mono-meta">{{ formatWindowLabel(from, to) }}</span>

      <div class="flex items-center gap-1 ml-auto" role="group" aria-label="Window">
        <button
          v-for="w in WINDOWS"
          :key="w.hours"
          class="px-2 py-0.5 rounded fs-mono font-medium transition-colors focus-ring"
          :style="{
            background: hours === w.hours ? 'var(--accent-muted)' : 'transparent',
            color: hours === w.hours ? 'var(--accent)' : 'var(--text-tertiary)',
          }"
          :aria-pressed="hours === w.hours"
          @click="fetchWindow(w.hours)"
        >
          {{ w.label }}
        </button>
      </div>
    </header>

    <div v-if="error" class="px-4 py-3 fs-sm ink-error">{{ error }}</div>

    <!-- Held at reduced opacity on refetch rather than replaced by a skeleton:
         this redraws every thirty seconds and a flash would never settle. -->
    <div
      v-else
      class="night"
      :class="{ 'night--stale': loading && Boolean(data) }"
    >
      <p v-if="data && !runs.length" class="px-4 py-8 text-center type-body">
        Nothing ran in the last {{ hours }} hours. When something does — a ritual at 08:00, a
        session you left going — this is where the night shows up.
      </p>

      <template v-else-if="data">
        <!-- Headline figures. Proportional digits: these are read, not aligned. -->
        <dl class="stats">
          <div>
            <dt>Runs</dt>
            <dd>{{ summary.total }}</dd>
          </div>
          <div>
            <dt>Spent</dt>
            <dd>{{ costLabel(summary.costUsd) }}</dd>
          </div>
          <div>
            <dt>Needed you</dt>
            <dd :style="{ color: summary.byOutcome.attention + summary.byOutcome.failed > 0 ? 'var(--warning)' : undefined }">
              {{ summary.byOutcome.attention + summary.byOutcome.failed }}
            </dd>
          </div>
          <div v-if="summary.busiestHour">
            <dt>Busiest hour</dt>
            <dd>{{ String(summary.busiestHour.hour).padStart(2, '0') }}:00</dd>
          </div>
        </dl>

        <div class="plot">
          <!-- Grid: solid hairlines, one shade off the surface, behind everything.
               Inset by the same gutter as the tracks, or every hour mark would
               sit a label's width away from the blocks it dates. -->
          <div class="grid" aria-hidden="true">
            <span
              v-for="tick in ticks"
              :key="tick.at"
              class="gridline"
              :class="{ 'gridline--labelled': tick.label }"
              :style="{ left: `${tick.left * 100}%` }"
            />
            <span class="nowline" :style="{ left: `${nowLeft * 100}%` }" />
          </div>

          <!-- Cost as its own series on the shared x axis. Never a second y axis
               on the lanes: two scales in one plot invent a correlation. -->
          <div v-if="!compact && spendPath" class="lane">
            <span class="lane-label">
              Spend
              <b class="lane-label-value">{{ costLabel(spend.total) }}</b>
            </span>
            <div class="strip">
              <svg class="strip-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <path :d="spendArea" class="strip-area" />
                <path :d="spendPath" class="strip-line" vector-effect="non-scaling-stroke" />
              </svg>
              <!--
                Outside the stretched SVG: `preserveAspectRatio="none"` would
                squash a circle into an ellipse, differently at every window
                width.
              -->
              <span
                v-if="spendEnd"
                class="strip-end"
                :style="{ left: `${spendEnd.x}%`, top: `${spendEnd.y}%` }"
              />
            </div>
          </div>

          <!-- Lanes -->
          <div v-for="lane in activeLanes" :key="lane.source" class="lane">
            <span class="lane-label">{{ LANE_LABELS[lane.source] }}</span>
            <div class="lane-track" :style="{ height: `${lane.rows * 15 + 6}px` }">
              <button
                v-for="block in lane.blocks"
                :key="block.run.id"
                class="block focus-ring"
                :class="[`block--${block.outcome}`, { 'block--clipped': block.clippedStart }]"
                :style="{
                  left: `${block.left * 100}%`,
                  width: `${block.width * 100}%`,
                  top: `${block.row * 15 + 3}px`,
                  '--block-color': OUTCOMES[block.outcome].color,
                }"
                :aria-label="`${block.run.title} — ${OUTCOMES[block.outcome].label}, started ${formatClock(block.startedAt)}, ${formatDuration(block.endedAt - block.startedAt)}`"
                @mouseenter="show(block)"
                @focus="show(block)"
                @mouseleave="hide"
                @blur="hide"
              >
                <UIcon
                  v-if="block.width >= 0.02"
                  :name="OUTCOMES[block.outcome].icon"
                  class="block-icon"
                  :class="{ 'animate-spin': block.outcome === 'running' }"
                />
                <span v-if="blockLabel(block)" class="block-label">{{ blockLabel(block) }}</span>
              </button>
            </div>
          </div>

          <!-- Axis band, inside the container so it can never be cropped -->
          <div class="axis" aria-hidden="true">
            <span
              v-for="tick in ticks.filter(t => t.label)"
              :key="tick.at"
              class="axis-tick"
              :style="{ left: `${tick.left * 100}%` }"
            >{{ tick.label }}</span>
          </div>

          <!-- Tooltip enhances; every value here is also in the table below.
               In its own gutter-inset layer so its percentage is measured
               against the same width the blocks are. -->
          <div class="tip-layer" aria-hidden="true">
            <div
              v-if="hovered"
              class="tip"
              :style="{ left: `${tooltipLeft * 100}%` }"
            >
              <span class="tip-title">{{ hovered.run.title }}</span>
              <span class="tip-row">
                <UIcon :name="OUTCOMES[hovered.outcome].icon" class="size-3 shrink-0" :style="{ color: OUTCOMES[hovered.outcome].color }" />
                {{ OUTCOMES[hovered.outcome].label }}
              </span>
              <span class="tip-row">
                {{ formatStamp(hovered.startedAt, to) }} · {{ formatDuration(hovered.endedAt - hovered.startedAt) }}
                <template v-if="hovered.run.costUsd"> · {{ costLabel(hovered.run.costUsd) }}</template>
              </span>
              <span v-if="hovered.clippedStart" class="tip-note">Began before this window</span>
            </div>
          </div>
        </div>

        <!-- Legend: always present, names every outcome on screen -->
        <div class="legend">
          <span v-for="item in legend" :key="item.outcome" class="legend-item">
            <span
              class="legend-swatch"
              :class="{ 'legend-swatch--hollow': item.hollow }"
              :style="{ '--block-color': item.color }"
            />
            <UIcon :name="item.icon" class="size-3 shrink-0" :style="{ color: item.color }" />
            {{ item.label }}
            <b>{{ item.count }}</b>
          </span>

          <button class="legend-toggle focus-ring" :aria-expanded="showTable" @click="showTable = !showTable">
            {{ showTable ? 'Hide' : 'Show' }} as a table
          </button>
        </div>

        <p v-if="data.truncated" class="truncated">
          More ran than this window can hold — the earliest hours are not shown.
        </p>

        <!-- The table twin: the same data, readable with no colour at all -->
        <div v-if="showTable" class="table-wrap">
          <table class="table">
            <caption class="sr-only">Runs in the last {{ hours }} hours</caption>
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">What</th>
                <th scope="col">Kind</th>
                <th scope="col">Outcome</th>
                <th scope="col" class="num">Took</th>
                <th scope="col" class="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in tableRows" :key="row.block.run.id">
                <td class="num">{{ formatStamp(row.block.startedAt, to) }}</td>
                <td class="what">{{ row.block.run.title }}</td>
                <td>{{ LANE_LABELS[row.lane] }}</td>
                <td>{{ OUTCOMES[row.block.outcome].label }}</td>
                <td class="num">{{ formatDuration(row.block.endedAt - row.block.startedAt) }}</td>
                <td class="num">{{ row.block.run.costUsd ? costLabel(row.block.run.costUsd) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <div v-else class="px-4 py-10 flex justify-center">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-meta" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.night {
  padding: 14px 16px 12px;
  transition: opacity var(--duration) var(--ease-out);
}
/* No skeleton on refetch — the previous night stays up, just quieter. */
.night--stale { opacity: 0.55; }

/* ── Headline figures ─────────────────────────── */

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0 26px;
  margin: 0 0 14px;
}
.stats div { display: flex; flex-direction: column; gap: 1px; }
.stats dt {
  font-size: 10px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.stats dd {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--text-primary);
}

/* ── Plot ─────────────────────────────────────── */

/*
 * One gutter for the row labels, and everything that has to line up with a time
 * reads it: the grid, the axis, the tooltip layer. Hard-coding 68px in four
 * places is how a chart ends up with its 03:00 line a label's width away from
 * the run that happened at 03:00.
 */
.plot { position: relative; --gutter: 68px; }

.grid {
  position: absolute;
  top: 0;
  bottom: 18px;
  left: var(--gutter);
  right: 0;
  pointer-events: none;
}

.gridline {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--border-subtle);
}
/* A labelled hour reads slightly stronger, so the eye can find the text's line. */
.gridline--labelled { background: var(--border-default); }

.nowline {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--accent);
  opacity: 0.5;
}

/* ── Spend strip ──────────────────────────────── */

.strip { position: relative; flex: 1; min-width: 0; height: 32px; margin-bottom: 6px; }

.strip-svg { width: 100%; height: 100%; display: block; overflow: visible; }
.strip-area { fill: var(--accent); opacity: 0.09; }
.strip-line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; }

.strip-end {
  position: absolute;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--surface-base);
  pointer-events: none;
}

/* ── Lanes ────────────────────────────────────── */

.lane { display: flex; align-items: flex-start; gap: 10px; }

.lane-label {
  flex: 0 0 58px;
  padding-top: 4px;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  text-align: right;
}
/* The spend row's total sits under its label rather than beside it — a second
   thing on that line would push the 58px gutter out and drag every lane with it. */
.lane-label-value {
  display: block;
  font-size: 11px;
  letter-spacing: 0;
  text-transform: none;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.lane-track { position: relative; flex: 1; min-width: 0; }

/*
 * The block is 9px of colour inside a 15px row. The remaining 6px is the gap
 * that separates a stacked run from the one above it — a surface gap rather than
 * a border, which would add a line for every mark.
 */
.block {
  position: absolute;
  height: 9px;
  min-width: 3px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: var(--block-color);
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  transition: filter var(--duration-fast) var(--ease-out);
}
.block:hover, .block:focus-visible { filter: brightness(1.12); }

/*
 * The hit area, which is not the paint.
 *
 * A twenty-second run is four pixels wide on a day-long axis — truthfully so,
 * and impossible to point at. This gives every block a target that reaches past
 * its own width without changing where it is drawn or how wide it looks. The
 * block is `overflow: visible` for this to escape, so the label does its own
 * clipping rather than relying on the parent's.
 */
.block { overflow: visible; }

.block::before {
  content: "";
  position: absolute;
  top: -4px;
  bottom: -4px;
  left: -9px;
  right: -9px;
}

/* Above the expanded targets of neighbouring blocks, so the one under the
   cursor wins rather than whichever was painted last. */
.block:hover { z-index: 2; }

/* Stopped by hand is outlined, not filled — the one non-colour cue that also
   survives being printed. */
.block--cancelled {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--block-color);
}

/* A run that began before the window is square on the left, so the cut is
   visible rather than looking like it started exactly at the edge. */
.block--clipped { border-top-left-radius: 0; border-bottom-left-radius: 0; }

.block-icon {
  width: 7px;
  height: 7px;
  margin-left: 2px;
  flex-shrink: 0;
  color: var(--surface-raised);
}
.block--cancelled .block-icon { color: var(--block-color); }

.block-label {
  font-size: 8.5px;
  line-height: 1;
  white-space: nowrap;
  /* `min-width: 0` is what lets a flex item shrink below its content, which is
     what makes the ellipsis happen here rather than on the parent. */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--surface-raised);
  padding-right: 3px;
}
.block--cancelled .block-label { color: var(--text-secondary); }

/* ── Axis ─────────────────────────────────────── */

.axis { position: relative; height: 18px; margin-left: var(--gutter); }
.axis-tick {
  position: absolute;
  top: 4px;
  transform: translateX(-50%);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
  white-space: nowrap;
}

/* ── Tooltip ──────────────────────────────────── */

/* Zero-height layer at the axis, inset by the gutter: gives the tooltip the
   track's coordinate space without taking part in the vertical flow. */
.tip-layer {
  position: absolute;
  left: var(--gutter);
  right: 0;
  bottom: 18px;
  height: 0;
}

.tip {
  position: absolute;
  bottom: 4px;
  transform: translateX(-50%);
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 240px;
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  background: var(--surface-overlay);
  border: 1px solid var(--border-default);
  box-shadow: 0 4px 14px var(--pill-shadow);
  pointer-events: none;
}
.tip-title {
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.tip-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.tip-note { font-size: 10px; color: var(--text-tertiary); }

/* ── Legend ───────────────────────────────────── */

.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  color: var(--text-secondary);
}
.legend-item b {
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  font-weight: 600;
}
.legend-swatch {
  width: 10px;
  height: 9px;
  border-radius: 2px;
  background: var(--block-color);
}
.legend-swatch--hollow {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--block-color);
}
.legend-toggle {
  margin-left: auto;
  padding: 2px 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  font-size: 10.5px;
  color: var(--text-tertiary);
  cursor: pointer;
}
.legend-toggle:hover { color: var(--text-secondary); background: var(--surface-hover); }

.truncated {
  margin: 8px 0 0;
  font-size: 10.5px;
  color: var(--warning);
}

/* ── Table twin ───────────────────────────────── */

.table-wrap { margin-top: 12px; overflow-x: auto; }
.table { width: 100%; border-collapse: collapse; font-size: 11px; }
.table th {
  text-align: left;
  font-size: 9.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  font-weight: 500;
  padding: 0 10px 5px 0;
  border-bottom: 1px solid var(--border-default);
  white-space: nowrap;
}
.table td {
  padding: 5px 10px 5px 0;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  vertical-align: top;
}
.table .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.table .what { color: var(--text-primary); min-width: 14rem; }

.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .block, .night { transition: none; }
}

/*
 * Forced colours and print: hue is gone or unreliable, so the opt-in texture
 * case applies. 45°/135° only, and only here — never as decoration.
 */
@media (forced-colors: active), print {
  .block { forced-color-adjust: none; box-shadow: inset 0 0 0 1px currentColor; }
  .block--failed {
    background-image: repeating-linear-gradient(45deg, transparent 0 2px, var(--surface-raised) 2px 4px);
  }
  .block--attention {
    background-image: repeating-linear-gradient(135deg, transparent 0 2px, var(--surface-raised) 2px 4px);
  }
}

@media (max-width: 560px) {
  /* The gutter shrinks with the label, and the grid, axis and tooltip follow it
     because all three are defined against the variable. */
  .plot { --gutter: 54px; }
  .lane-label { flex-basis: 44px; font-size: 9px; }
  .stats { gap: 0 18px; }
  .stats dd { font-size: 16px; }
}
</style>
