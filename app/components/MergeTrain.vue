<script setup lang="ts">
import {
  buildTrain,
  spineFraction,
  summarizeTrain,
  widestAhead,
  type LandingPlan,
  type TrainCar,
  type TrainNeed,
  type TrainSession,
} from '~/utils/mergeTrain'
import { LANDING_OUTCOMES, type LandingRun } from '~/composables/useLanding'

/**
 * Parallel branches, and the order they can land in.
 *
 * The sequential landing design is the hardest thing here to explain in prose.
 * Every merge moves the base, so the next session is behind the moment the
 * previous one lands and its green verdict was earned against a branch that no
 * longer exists. Written out that is a paragraph read once and forgotten. Drawn,
 * it is a spine that advances and tracks that fall behind it one at a time.
 *
 * **Identity is never colour alone.** Every row states its need in words, beside
 * a glyph, which is a stronger guarantee than a legend — there is nothing to look
 * up. Colour is used sparingly and deliberately: green only for genuinely ready,
 * the accent for "needs a step you can take", and muted grey for what cannot go
 * at all. Nothing here is red, because a session that is merely behind is not a
 * failure and colouring it like one is how a page teaches people to ignore red.
 */

const props = defineProps<{
  /** From the server, which is the thing that decides. */
  plan: LandingPlan | null
  /** Only for drawing: branch names and how far ahead each one is. */
  sessions: TrainSession[]
  baseBranch: string
  /** The landing in flight, when there is one. Drives the animation. */
  landing?: LandingRun | null
  starting?: boolean
  /**
   * Fold the ordering away behind the header.
   *
   * This panel is nine rows tall and took the whole first screen of /sessions,
   * pushing the box you start work in and the sessions themselves below the
   * fold. Its header already carries the only fact you need most of the time —
   * "6 of 9 could land" — and the button to act on it. The ordering underneath
   * matters when something is blocked, which is when you open it.
   */
  collapsible?: boolean
}>()

const emit = defineEmits<{ land: []; recheck: [] }>()

const open = ref(false)

/**
 * A landing in flight opens it and keeps it open. The minutes are going into a
 * specific one of these, and which one is the entire point of the animation.
 */
const showBody = computed(() => !props.collapsible || open.value || inFlight.value)

/** Re-reading the plan is the whole recovery: fix the checkout, press this. */
const refreshing = ref(false)

async function onRecheck() {
  refreshing.value = true
  try {
    emit('recheck')
    // Long enough to read as an action having happened. The parent's refresh is
    // a single request and would otherwise finish before the spinner appeared.
    await new Promise(resolve => setTimeout(resolve, 350))
  } finally {
    refreshing.value = false
  }
}

const NEEDS: Record<TrainNeed, { label: string; icon: string; color: string }> = {
  ready: { label: 'Ready', icon: 'i-lucide-check', color: 'var(--success)' },
  check: { label: 'Needs checking', icon: 'i-lucide-flask-conical', color: 'var(--accent)' },
  update: { label: 'Needs the base', icon: 'i-lucide-arrow-down-to-line', color: 'var(--accent)' },
  // Success, not absence. Four finished sessions reported as "cannot land" is the
  // right fact wearing entirely the wrong word.
  landed: { label: 'Landed', icon: 'i-lucide-git-merge', color: 'var(--success)' },
  blocked: { label: 'Cannot land', icon: 'i-lucide-ban', color: 'var(--text-disabled)' },
}

const cars = computed(() => buildTrain(props.plan, props.sessions))
const summary = computed(() => summarizeTrain(cars.value))
const widest = computed(() => widestAhead(cars.value))

const landable = computed(() => cars.value.filter(c => c.landable))
const landed = computed(() => cars.value.filter(c => c.need === 'landed'))
const blocked = computed(() => cars.value.filter(c => !c.landable && c.need !== 'landed'))

/** Dots are one per commit up to a point; past it the count carries the number. */
const MAX_DOTS = 6

function dotsFor(car: TrainCar): number {
  return Math.min(car.ahead, MAX_DOTS)
}

function trackWidth(car: TrainCar): string {
  // A floor, so a one-commit session is still a visible run of track rather
  // than a dot sitting on the spine.
  return `${Math.max(14, spineFraction(car.ahead, widest.value) * 100)}%`
}

/**
 * Whether a landing is actually going.
 *
 * Not the same as having a `landing` record: the newest run is passed in whatever
 * its status, so testing the record's presence hid the button for as long as any
 * finished run was undismissed — which is the same trap as the panel replacing
 * the composer, one component along.
 */
const inFlight = computed(() => props.landing?.status === 'running')

/** What the landing in flight has to say about this session, if anything. */
function stepFor(car: TrainCar) {
  return props.landing?.steps.find(s => s.sessionId === car.candidate.id) ?? null
}

function stateOf(car: TrainCar): 'waiting' | 'inflight' | 'merged' | 'passed-over' | 'not-attempted' {
  const step = stepFor(car)
  // No step yet means the landing has not reached it — or there is no landing,
  // which looks the same on screen and is the resting state.
  if (!step) return 'waiting'
  if (step.outcome) return step.outcome === 'merged' ? 'merged' : 'passed-over'

  /**
   * A step with no outcome only means "in flight" while the run is actually
   * going. Once it has stopped, the ones it never reached also have no outcome —
   * and reading those as in-flight left a finished landing spinning "Landing…"
   * on three rows for as long as the page was open.
   */
  return inFlight.value ? 'inflight' : 'not-attempted'
}

function outcomeLabel(car: TrainCar): string | null {
  const step = stepFor(car)
  if (!step?.outcome) return null
  return LANDING_OUTCOMES[step.outcome]?.label ?? step.outcome
}

/**
 * The glyph describes the *outcome* once there is one.
 *
 * It used to keep showing the need's glyph regardless, so a refused row wore a
 * green tick and a merged one wore the download arrow of "needs the base". The
 * label was right and the icon beside it said something else.
 */
function glyphFor(car: TrainCar): string {
  const state = stateOf(car)
  if (state === 'inflight') return 'i-lucide-loader-2'
  if (state === 'merged') return 'i-lucide-git-merge'
  if (state === 'not-attempted') return 'i-lucide-circle-dashed'

  const outcome = stepFor(car)?.outcome
  if (outcome === 'already-landed') return 'i-lucide-check'
  if (outcome) return 'i-lucide-circle-alert'

  return NEEDS[car.need].icon
}

/** Merged and already-in are both good endings; the rest want noticing. */
function outcomeColor(car: TrainCar): string | null {
  const outcome = stepFor(car)?.outcome
  if (!outcome) return null
  return LANDING_OUTCOMES[outcome]?.good ? 'var(--success)' : 'var(--warning)'
}

const confirming = ref(false)

/** Reset the confirmation once a landing actually starts. */
watch(() => props.landing?.status, (status) => {
  if (status === 'running') confirming.value = false
})

/**
 * Why nothing can land, when the reason is the repository rather than a session.
 *
 * Held apart from the per-row needs because it overrides all of them: every row
 * can say "Ready" and still nothing will merge, which is exactly the state that
 * produced a wasted test-suite run and a landing recorded as failed.
 */
const baseBlocker = computed(() => props.plan?.base?.blockedReason ?? null)


const commitsLabel = computed(() =>
  `${summary.value.commits} commit${summary.value.commits === 1 ? '' : 's'}`)

/**
 * The plan names sessions by id, and the page may not hold every one it names —
 * a session in another project, or one closed since the plan was read. The
 * candidate always carries a title, so the row is still nameable; only the link
 * and the branch need the session itself.
 */
function titleOf(car: TrainCar): string {
  return car.session?.title ?? car.candidate.title
}
</script>

<template>
  <section
    class="rounded-lg overflow-hidden"
    style="border: 1px solid var(--border-subtle); background: var(--surface-raised);"
    aria-labelledby="merge-train-title"
  >
    <header
      class="flex items-center gap-3 flex-wrap px-4 py-2.5"
      :style="{
        background: 'var(--surface-base)',
        borderBottom: showBody ? '1px solid var(--border-subtle)' : 'none',
      }"
    >
      <button
        v-if="collapsible"
        class="flex items-center gap-3 focus-ring rounded -m-1 p-1"
        :aria-expanded="showBody"
        :disabled="inFlight"
        :title="showBody ? 'Hide the order' : 'Show the order'"
        @click="() => { open = !open }"
      >
        <UIcon
          :name="showBody ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-3.5 shrink-0 text-meta"
        />
        <UIcon name="i-lucide-git-merge" class="size-3.5 shrink-0 text-meta" />
        <h2 id="merge-train-title" class="text-section-label">Merge train</h2>
      </button>
      <template v-else>
        <UIcon name="i-lucide-git-merge" class="size-3.5 shrink-0 text-meta" />
        <h2 id="merge-train-title" class="text-section-label">Merge train</h2>
      </template>
      <span v-if="summary.landable" class="type-mono-meta">
        {{ summary.landable }} of {{ summary.total }} could land · {{ commitsLabel }}
      </span>
      <!--
        "0 of 4 could land" is technically true of four sessions that all landed
        successfully, and reads as four failures. When nothing is waiting, the
        news is what happened rather than what cannot.
      -->
      <span v-else-if="summary.landed" class="type-mono-meta ink-ok">
        all {{ summary.landed }} landed
      </span>
      <span v-else class="type-mono-meta">nothing waiting to land</span>

      <div v-if="!inFlight && summary.landable > 0 && !baseBlocker" class="flex items-center gap-2 ml-auto">
        <template v-if="confirming">
          <span class="fs-mono text-label">Merge what passes into {{ baseBranch }}?</span>
          <UButton label="Land them" size="xs" :loading="starting" @click="emit('land')" />
          <UButton label="Cancel" size="xs" variant="ghost" color="neutral" @click="() => { confirming = false }" />
        </template>
        <UButton
          v-else
          label="Land in this order"
          icon="i-lucide-git-merge"
          size="xs"
          variant="soft"
          @click="() => { confirming = true }"
        />
      </div>
    </header>

    <div v-if="showBody" class="train">
      <!--
        The repository-level refusal, before the button rather than after the
        bill. Every row below can read "Ready" and still nothing will merge, so
        this has to come first and the button has to be gone while it stands.

        Only when something is actually waiting: warning that a dirty checkout
        prevents landing, on a train where everything has already landed, is a
        problem reported about work nobody is asking to do.
      -->
      <div v-if="baseBlocker && summary.landable" class="blocker">
        <UIcon name="i-lucide-circle-alert" class="size-4 shrink-0 blocker-icon" />
        <div class="blocker-body">
          <p class="blocker-text">{{ baseBlocker }}</p>
          <p class="blocker-hint">
            Nothing is attempted until it is sorted — the train is waiting rather than failing.
          </p>
        </div>
        <UButton
          label="Check again"
          icon="i-lucide-refresh-cw"
          size="xs"
          variant="soft"
          :loading="refreshing"
          @click="onRecheck"
        />
      </div>

      <!--
        Why this order and not another.

        An unexplained reordering of somebody's work reads as a bug, and this one
        is worth explaining twice over: it is not alphabetical, not the order the
        sessions were started in, and on a good day it is not even cheapest-first.
        Said once, above the rows, rather than as a badge on each of them.
      -->
      <p v-if="plan?.why && summary.landable > 1" class="order-why">
        <UIcon
          :name="plan.cycle ? 'i-lucide-refresh-ccw-dot' : 'i-lucide-arrow-down-narrow-wide'"
          class="size-3.5 shrink-0"
        />
        <span>{{ plan.why }}</span>
      </p>

      <!-- The base branch. Everything below diverges from it and returns to it. -->
      <div class="spine-row">
        <span class="spine-label">{{ baseBranch }}</span>
        <div class="spine">
          <span class="spine-line" />
          <UIcon name="i-lucide-chevron-right" class="spine-arrow" />
        </div>
      </div>

      <ol class="cars">
        <li
          v-for="car in landable"
          :key="car.candidate.id"
          class="car"
          :class="`car--${stateOf(car)}`"
        >
          <span class="car-order" aria-hidden="true">{{ car.order + 1 }}</span>

          <!-- The branch: a run of track off the spine, one dot per commit -->
          <div class="car-branch" :style="{ width: trackWidth(car) }">
            <span class="car-track" :style="{ '--need-color': NEEDS[car.need].color }" />
            <span
              v-for="dot in dotsFor(car)"
              :key="dot"
              class="car-dot"
              :style="{
                left: `${dotsFor(car) === 1 ? 100 : (dot - 1) / (dotsFor(car) - 1) * 100}%`,
                '--need-color': NEEDS[car.need].color,
              }"
            />
            <span v-if="car.ahead > MAX_DOTS" class="car-more">+{{ car.ahead - MAX_DOTS }}</span>
          </div>

          <div class="car-body">
            <NuxtLink
              v-if="car.session"
              :to="`/sessions/${car.candidate.id}`"
              class="car-title focus-ring"
            >{{ titleOf(car) }}</NuxtLink>
            <span v-else class="car-title">{{ titleOf(car) }}</span>
            <span class="car-meta">
              <span v-if="car.session" class="font-mono">{{ car.session.branch }}</span>
              <template v-if="car.session"> · </template>{{ car.ahead }} ahead
              <template v-if="car.dirty"> · uncommitted</template>
            </span>
          </div>

          <!-- The need, in words next to a glyph. Never colour on its own. -->
          <span class="car-need" :style="{ '--need-color': outcomeColor(car) ?? NEEDS[car.need].color }">
            <UIcon
              :name="glyphFor(car)"
              class="size-3 shrink-0"
              :class="{ 'animate-spin': stateOf(car) === 'inflight' }"
            />
            <template v-if="outcomeLabel(car)">{{ outcomeLabel(car) }}</template>
            <template v-else-if="stateOf(car) === 'inflight'">Landing…</template>
            <template v-else-if="stateOf(car) === 'not-attempted'">Not reached</template>
            <template v-else>{{ NEEDS[car.need].label }}</template>
          </span>

          <span v-if="stepFor(car)?.detail || car.reason" class="car-reason">
            {{ stepFor(car)?.detail || car.reason }}
          </span>
        </li>
      </ol>

      <!--
        Finished, kept above what is stuck and coloured like the good news it is.
      -->
      <template v-if="landed.length">
        <p class="group-head group-head--good">
          Already in {{ baseBranch }}
          <span class="type-mono-meta">{{ landed.length }}</span>
        </p>
        <ol class="cars">
          <li v-for="car in landed" :key="car.candidate.id" class="car car--landed">
            <span class="car-order" aria-hidden="true">✓</span>
            <div class="car-branch" style="width: 14%">
              <span class="car-track" style="--need-color: var(--success)" />
            </div>
            <div class="car-body">
              <NuxtLink
                v-if="car.session"
                :to="`/sessions/${car.candidate.id}`"
                class="car-title focus-ring"
              >{{ titleOf(car) }}</NuxtLink>
              <span v-else class="car-title">{{ titleOf(car) }}</span>
              <span v-if="car.session" class="car-meta">
                <span class="font-mono">{{ car.session.branch }}</span>
              </span>
            </div>
            <span class="car-need" style="--need-color: var(--success)">
              <UIcon :name="NEEDS.landed.icon" class="size-3 shrink-0" />
              {{ NEEDS.landed.label }}
            </span>
          </li>
        </ol>
      </template>

      <!-- What cannot go, kept apart rather than mixed into the order -->
      <template v-if="blocked.length">
        <p class="group-head">
          Not in the train
          <span class="type-mono-meta">{{ blocked.length }}</span>
        </p>
        <ol class="cars cars--blocked">
          <li v-for="car in blocked" :key="car.candidate.id" class="car car--blocked">
            <span class="car-order" aria-hidden="true">—</span>
            <div class="car-branch" style="width: 14%">
              <span class="car-track" style="--need-color: var(--text-disabled)" />
            </div>
            <div class="car-body">
              <NuxtLink
                v-if="car.session"
                :to="`/sessions/${car.candidate.id}`"
                class="car-title focus-ring"
              >{{ titleOf(car) }}</NuxtLink>
              <span v-else class="car-title">{{ titleOf(car) }}</span>
              <span v-if="car.session" class="car-meta">
                <span class="font-mono">{{ car.session.branch }}</span>
              </span>
            </div>
            <span class="car-need" style="--need-color: var(--text-disabled)">
              <UIcon :name="NEEDS.blocked.icon" class="size-3 shrink-0" />
              {{ NEEDS.blocked.label }}
            </span>
            <span class="car-reason">{{ car.reason }}</span>
          </li>
        </ol>
      </template>

      <p v-if="summary.needUpdate" class="footnote">
        {{ summary.needUpdate }} of these
        {{ summary.needUpdate === 1 ? 'is' : 'are' }} behind {{ baseBranch }}. Landing brings the
        base in and re-runs the checks before each merge — every merge moves the base, so a
        verdict taken before it is a verdict about code that no longer exists.
      </p>
    </div>
  </section>
</template>

<style scoped>
.train { padding: 12px 16px 14px; }

/* ── The spine ────────────────────────────────── */

/* The sentence above the rows: quieter than a row, louder than a hint. */
.order-why {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0 0 10px;
  font-size: var(--fs-micro);
  line-height: 1.5;
  color: var(--text-tertiary);
}
.order-why :deep(svg) { margin-top: 1px; }

.spine-row { display: flex; align-items: center; gap: 10px; }

.spine-label {
  flex: 0 0 auto;
  min-width: 62px;
  font-family: var(--font-mono);
  font-size: var(--fs-micro);
  font-weight: 600;
  color: var(--text-secondary);
  text-align: right;
}

.spine { position: relative; flex: 1; height: 12px; display: flex; align-items: center; }

.spine-line {
  flex: 1;
  height: 2px;
  border-radius: 1px;
  background: var(--border-emphasis);
}
.spine-arrow {
  width: 11px;
  height: 11px;
  margin-left: -3px;
  color: var(--border-emphasis);
}

/* ── Cars ─────────────────────────────────────── */

.cars { list-style: none; margin: 0; padding: 0; }

.car {
  display: grid;
  grid-template-columns: 62px minmax(3rem, 22%) minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 10px;
  padding: 5px 0;
}

.car-order {
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
  color: var(--text-disabled);
  text-align: right;
  padding-right: 2px;
}

/*
 * The branch. Its width is how far ahead the session is, scaled to the widest on
 * screen — so the picture answers "who has done the most" without a number.
 */
.car-branch { position: relative; height: 12px; display: flex; align-items: center; }

.car-track {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 1px;
  background: var(--need-color);
  opacity: 0.35;
}

.car-dot {
  position: absolute;
  width: 6px;
  height: 6px;
  margin-left: -3px;
  border-radius: 50%;
  background: var(--need-color);
  /* A surface ring rather than a border, so overlapping dots stay countable. */
  box-shadow: 0 0 0 2px var(--surface-raised);
}

.car-more {
  position: absolute;
  right: -20px;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
}

.car-body { min-width: 0; display: flex; flex-direction: column; gap: 0; }

.car-title {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--text-primary);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 3px;
}
.car-title:hover { color: var(--accent); }

.car-meta {
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.car-need {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-micro);
  font-weight: 500;
  color: var(--need-color);
  white-space: nowrap;
}

/* The reason drops to its own line on narrow screens rather than being cut. */
.car-reason {
  grid-column: 3 / -1;
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Landing states ───────────────────────────── */

/* In flight: the one the minutes are going into. */
.car--inflight { background: var(--accent-muted); border-radius: var(--radius-sm); }
.car--inflight .car-track { opacity: 0.8; }

/* Merged: it is on the spine now, so it stops looking like a branch. */
.car--merged { opacity: 0.5; }
.car--merged .car-track,
.car--merged .car-dot { background: var(--success); }

/* Never reached, because the run stopped first. Not a result about this session,
   so it is stated and then left quiet. */
.car--not-attempted { opacity: 0.6; }
.car--not-attempted .car-need { color: var(--text-tertiary); }

.car--blocked .car-title { color: var(--text-secondary); }

/* ── Blocked group ────────────────────────────── */

.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 2px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
  font-size: var(--fs-micro);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.cars--blocked { opacity: 0.72; }

/* Good news reads in the ink colour rather than as a warning. */
.group-head--good { color: var(--success); }

.car--landed { opacity: 0.75; }
.car--landed .car-order { color: var(--success); }

.blocker {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--warning-wash);
  border: 1px solid var(--warning-edge);
}
.blocker-icon { color: var(--warning); margin-top: 1px; }
.blocker-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.blocker-text {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--text-primary);
}
.blocker-hint {
  margin: 0;
  font-size: var(--fs-micro);
  color: var(--text-tertiary);
}

.footnote {
  margin: 10px 0 0;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
  font-size: var(--fs-micro);
  line-height: 1.5;
  color: var(--text-tertiary);
  max-width: 68ch;
}

@media (max-width: 620px) {
  .car { grid-template-columns: 26px minmax(2.5rem, 26%) minmax(0, 1fr); }
  .car-need { grid-column: 2 / -1; }
  .car-reason { grid-column: 2 / -1; }
  .spine-label, .car-order { min-width: 0; flex-basis: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .car--inflight { transition: none; }
}
</style>
