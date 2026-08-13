<script setup lang="ts">
import { relativeTime } from '~/utils/time'

/**
 * What went right, quietly.
 *
 * The third band, and deliberately the terse one: work that went well needs
 * acknowledging, not reading. Nothing here has an action, because everything
 * with an action is in the queue above.
 *
 * This is the band that makes the product's claim checkable — "leave it running
 * and come back" is only true if you can see, in a glance, that the night went
 * through without you.
 */
const { digest } = useDigest()
const { sessions } = useSessions()

/** Merged already. Nothing to do, but worth knowing it happened. */
const landed = computed(() =>
  sessions.value
    .filter(s => s.landed)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5),
)

/** Scheduled runs that came to something, counted rather than listed. */
const untroubled = computed(() => digest.value?.rituals.filter(r => !r.problem).length ?? 0)

const money = computed(() => {
  const total = digest.value?.costUsd ?? 0
  if (!total) return null
  return total < 0.01 ? '<$0.01' : `$${total.toFixed(2)}`
})

const worthShowing = computed(() => landed.value.length > 0 || untroubled.value > 0)
</script>

<template>
  <section v-if="worthShowing" aria-labelledby="now-settled-title">
    <div class="flex items-baseline gap-2.5 mb-3">
      <h2 id="now-settled-title" class="text-section-label">Settled</h2>
      <span v-if="digest" class="type-mono-meta">
        since {{ relativeTime(digest.since) }}<template v-if="money"> · {{ money }}</template>
      </span>
    </div>

    <div class="rounded-lg bg-card overflow-hidden">
      <ul v-if="landed.length" class="divide-y" style="border-color: var(--border-subtle);">
        <li v-for="session in landed" :key="session.id">
          <NuxtLink
            :to="`/sessions/${session.id}`"
            class="flex items-center gap-3 px-4 py-2.5 hover-row focus-ring group"
          >
            <UIcon name="i-lucide-git-merge" class="size-3.5 shrink-0" style="color: var(--success);" />
            <span class="type-strong flex-1 min-w-0 truncate">{{ session.title }}</span>
            <span class="type-detail shrink-0 truncate max-w-[40%] hidden sm:block">
              {{ session.summary?.text }}
            </span>
            <span class="type-mono-meta shrink-0">merged</span>
          </NuxtLink>
        </li>
      </ul>

      <p
        v-if="untroubled"
        class="type-detail px-4 py-2.5"
        :style="landed.length ? 'border-top: 1px solid var(--border-subtle);' : undefined"
      >
        {{ untroubled }} scheduled {{ untroubled === 1 ? 'run' : 'runs' }} went through without trouble.
      </p>
    </div>
  </section>
</template>
