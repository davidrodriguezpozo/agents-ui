<script setup lang="ts">
import type { AttentionItem } from '~/composables/useAttention'

/**
 * The act that holds the room.
 *
 * Everywhere else in this app "needs you" is a badge with a number on it, which
 * is the right shape for somebody already reading the screen. On a wall the same
 * fact has to work on somebody who is not: it gets the whole surface, the
 * sentence rather than the count, and the reason underneath it.
 *
 * Five at most. A list long enough to scroll has stopped being a wall, and the
 * remainder is stated rather than dropped.
 */
const props = defineProps<{
  items: AttentionItem[]
  count: number
}>()

const SHOWN = 5

const shown = computed(() => props.items.slice(0, SHOWN))
const rest = computed(() => Math.max(0, props.count - shown.value.length))

const ICONS: Record<AttentionItem['kind'], string> = {
  'blocked-session': 'i-lucide-hand',
  'failing-ritual': 'i-lucide-alarm-clock-off',
}
</script>

<template>
  <section class="act-attention" aria-label="What needs you">
    <header class="act-attention-head">
      <span class="act-attention-count">{{ count }}</span>
      <h2 class="act-attention-title">
        {{ count === 1 ? 'thing will not move' : 'things will not move' }}
        until you do something
      </h2>
    </header>

    <ul class="act-attention-list">
      <li v-for="item in shown" :key="`${item.kind}-${item.id}`" class="act-attention-row">
        <UIcon :name="ICONS[item.kind]" class="act-attention-icon shrink-0" />
        <span class="min-w-0">
          <span class="act-attention-name">{{ item.title }}</span>
          <span class="act-attention-why">{{ item.because }}</span>
        </span>
      </li>
    </ul>

    <p v-if="rest" class="act-attention-rest">and {{ rest }} more</p>
  </section>
</template>

<style scoped>
.act-attention {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(14px, 2.5vh, 34px);
  padding: 0 clamp(12px, 3vw, 70px);
}

.act-attention-head {
  display: flex;
  align-items: baseline;
  gap: clamp(10px, 1.4vw, 22px);
}

.act-attention-count {
  font-family: var(--font-mono);
  font-size: clamp(40px, 6vw, 110px);
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
  color: var(--error);
}

.act-attention-title {
  font-family: var(--font-sans);
  font-size: clamp(17px, 1.9vw, 38px);
  font-weight: 500;
  line-height: 1.15;
  color: var(--text-primary);
  max-width: 22ch;
}

.act-attention-list {
  display: flex;
  flex-direction: column;
  gap: clamp(8px, 1.4vh, 18px);
  min-width: 0;
}

.act-attention-row {
  display: flex;
  align-items: flex-start;
  gap: clamp(8px, 0.9vw, 16px);
  min-width: 0;
}

.act-attention-icon {
  width: clamp(16px, 1.3vw, 26px);
  height: clamp(16px, 1.3vw, 26px);
  margin-top: 0.35em;
  color: var(--error);
}

.act-attention-name {
  display: block;
  font-family: var(--font-sans);
  font-size: clamp(15px, 1.5vw, 30px);
  font-weight: 500;
  line-height: 1.25;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.act-attention-why {
  display: block;
  font-family: var(--font-sans);
  font-size: clamp(12px, 1vw, 20px);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.act-attention-rest {
  font-family: var(--font-mono);
  font-size: clamp(11px, 0.85vw, 16px);
  color: var(--text-disabled);
}
</style>
