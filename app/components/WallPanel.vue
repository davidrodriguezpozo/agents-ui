<script setup lang="ts">
/**
 * One block in the wall's rail.
 *
 * There are six of these now where there were two, and they were two copies of
 * the same fifteen lines of markup before they were six. What the shared version
 * buys is not the markup — it is that the parts a reader relies on cannot drift:
 * the heading is always in the same place, the count always means "how many are
 * waiting", and the two things a panel has to admit to are always there.
 *
 * **Those two are the point.** `stamp` says how old the panel's figures are, and
 * `hidden` says how many it could not fit. Every panel on this screen reads a
 * different source at a different rate — the fleet is two seconds old, GitHub is
 * up to a minute, the inbox is however long ago somebody last asked — and a
 * screen that draws all three identically is claiming they are all now. The same
 * argument as `WallSnapshot.tiles`, applied to a panel: four of eleven reviews
 * looks exactly like all four unless it says so.
 *
 * The list inside is the caller's, and its styles come from the caller's
 * stylesheet — slotted content keeps the parent's scope, which is deliberate.
 * This owns the frame and nothing else.
 */
const props = defineProps<{
  title: string
  /** How many are waiting. Absent or zero draws no badge at all. */
  count?: number
  /** Whether that count is bad news, which is the only thing that goes red. */
  loud?: boolean
  /** How old this panel's figures are, for anything not read from local disk. */
  stamp?: string
  /**
   * A second figure about the list, where one is worth having — "2 CI red · 1
   * ready" over a list of pull requests. Separate from `stamp` because they are
   * different claims and only one of them is about time.
   */
  note?: string
  /** Rows that did not fit, reported rather than dropped. */
  hidden?: number
}>()

const badge = computed(() => (props.count ? String(props.count) : ''))
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <h2 class="panel-title">{{ title }}</h2>
      <span v-if="badge" class="panel-count" :class="{ 'is-loud': loud }">{{ badge }}</span>
      <span class="panel-gap" />
      <span v-if="note" class="panel-note">{{ note }}</span>
      <span v-if="stamp" class="panel-stamp">{{ stamp }}</span>
      <slot name="actions" />
    </header>

    <div class="panel-body">
      <slot />
    </div>

    <p v-if="hidden" class="panel-more">and {{ hidden }} more</p>
  </section>
</template>

<style scoped>
.panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: clamp(8px, 0.7vw, 13px) clamp(9px, 0.8vw, 14px);
  border-radius: 9px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.panel-title {
  font-family: var(--font-sans);
  font-size: clamp(9.5px, 0.72vw, 12px);
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.panel-count {
  padding: 0 6px;
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: clamp(9.5px, 0.7vw, 12px);
  background: var(--badge-subtle-bg);
  color: var(--text-secondary);
}

.panel-count.is-loud {
  background: var(--error-tint);
  color: var(--error);
}

/* Pushes the stamp and any action to the right edge without a second wrapper. */
.panel-gap {
  flex: 1;
  min-width: 0;
}

/*
 * How old the figures are, stated quietly.
 *
 * Deliberately the smallest and faintest thing in the heading: it has to be
 * available to somebody who wonders, and must not compete with the count beside
 * it, which is what the panel is actually for.
 */
.panel-stamp {
  font-family: var(--font-mono);
  font-size: clamp(9px, 0.65vw, 11px);
  color: var(--text-disabled);
  white-space: nowrap;
}

.panel-note {
  font-family: var(--font-sans);
  font-size: clamp(9.5px, 0.7vw, 12px);
  color: var(--text-tertiary);
  white-space: nowrap;
}

/*
 * No scrolling of its own, on purpose.
 *
 * A panel used to hold a scroll box, and it was the wrong answer twice over: the
 * lists are capped and report what they cut, so the box only ever hid a row the
 * panel had room for — and a scrollbar inside a panel inside a scrolling rail is
 * two ways to move the same content past the same edge. The rail scrolls; a panel
 * is as tall as what it has to say.
 */
.panel-body {
  min-height: 0;
}

.panel-more {
  font-family: var(--font-mono);
  font-size: clamp(9.5px, 0.7vw, 12px);
  color: var(--text-disabled);
}
</style>
