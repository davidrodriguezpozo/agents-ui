<script setup lang="ts">
import { PULL_TONES, sinceLabel, type WallPull, type WallTone } from '~/utils/wall'

/**
 * One pull request, two lines.
 *
 * The same shape as `WallRow` and for the same reason: what makes nine of these
 * readable is that the same fact is in the same place on every one of them. The
 * first line is which and what; the second is where it has got to, in the words
 * the reviews page uses.
 *
 * **It links to GitHub and not into this app.** The reviews page can turn a pull
 * request into a session with the branch checked out, and that is the right home
 * for it — it knows which project it is in, it can name the agent, and it reports
 * a budget refusal properly. This row is up to a minute old and may belong to a
 * repository other than the one selected, so the honest destination is the pull
 * request itself.
 *
 * **The age is how long it has been sitting, not when it last moved.** A pull
 * request nobody has touched in a week is the one going bad, and `updatedAt` hides
 * exactly that: a stale review request that somebody pushed a rebase to five
 * minutes ago would read as fresh.
 */
const props = defineProps<{
  pull: WallPull
  now: number
}>()

const TONES: Record<WallTone, string> = {
  quiet: 'var(--text-disabled)',
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--error)',
}

const tone = computed(() => TONES[PULL_TONES[props.pull.state]])

/**
 * Who the other end of this is.
 *
 * For somebody else's pull request that is its author — the person whose work is
 * blocked on you reading it. For your own it is whoever has been asked and has not
 * answered, because that is the name the news is about. Yours with nobody asked
 * says so rather than repeating your own login back at you.
 */
const who = computed(() => {
  if (!props.pull.mine) return props.pull.author
  if (props.pull.awaiting.length) return `waiting on ${props.pull.awaiting.join(', ')}`
  return 'nobody asked yet'
})

const unresolved = computed(() => {
  const count = props.pull.unresolved
  return count ? `${count} unresolved` : ''
})
</script>

<template>
  <a
    class="pull"
    :href="pull.url"
    target="_blank"
    rel="noopener"
    :title="`${pull.repo} #${pull.number} — ${pull.title}\n${pull.label}: ${pull.detail}`"
  >
    <span class="pull-dot" :style="{ background: tone }" />

    <span class="pull-body">
      <span class="pull-line">
        <span class="pull-where">{{ pull.repo }} <span class="pull-num">#{{ pull.number }}</span></span>
        <span class="pull-title">{{ pull.title }}</span>
        <span class="pull-age" :class="{ 'is-loud': pull.onYou }">{{ sinceLabel(pull.createdAt, now) }}</span>
      </span>

      <span class="pull-line is-under">
        <span class="pull-state" :style="{ color: tone }">{{ pull.label }}</span>
        <span class="pull-sep">·</span>
        <span class="pull-who">{{ who }}</span>
        <template v-if="unresolved">
          <span class="pull-sep">·</span>
          <span class="pull-threads">{{ unresolved }}</span>
        </template>
        <span class="pull-files">{{ pull.changedFiles }}f</span>
      </span>
    </span>
  </a>
</template>

<style scoped>
.pull {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  min-width: 0;
  padding: 3px 4px;
  margin: 0 -4px;
  border-radius: 5px;
}

.pull:hover {
  background: var(--surface-hover);
}

.pull-dot {
  width: 6px;
  height: 6px;
  margin-top: 5px;
  border-radius: 999px;
  flex-shrink: 0;
}

.pull-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pull-line {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.pull-where {
  font-family: var(--font-mono);
  font-size: clamp(10px, 0.72vw, 12.5px);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.pull-num {
  color: var(--text-secondary);
}

.pull-title {
  flex: 1;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: clamp(11px, 0.82vw, 14px);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Right-aligned in its own column so nine rows read down as well as across. */
.pull-age {
  font-family: var(--font-mono);
  font-size: clamp(9.5px, 0.7vw, 12px);
  color: var(--text-disabled);
  white-space: nowrap;
  flex-shrink: 0;
}

/* The one on you is the one worth finding, so its age is the figure that carries. */
.pull-age.is-loud {
  color: var(--text-secondary);
}

.pull-line.is-under {
  font-family: var(--font-sans);
  font-size: clamp(9.5px, 0.72vw, 12.5px);
  color: var(--text-tertiary);
}

.pull-state {
  font-weight: 500;
  white-space: nowrap;
}

.pull-sep {
  color: var(--text-disabled);
}

.pull-who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pull-threads {
  color: var(--warning);
  white-space: nowrap;
}

.pull-files {
  margin-left: auto;
  font-family: var(--font-mono);
  color: var(--text-disabled);
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
