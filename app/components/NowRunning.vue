<script setup lang="ts">
import { relativeTime } from '~/utils/time'

/**
 * What is in flight, right now.
 *
 * The counterpart to the queue above it: that band is work that has stopped,
 * this is work that has not. Both were only ever visible by going to /sessions
 * and reading the status of each row.
 *
 * Polled by `useSessions`' own refresh from the pages that own it; here it just
 * reads the shared state, so opening this screen does not add a request.
 */
const { sessions } = useSessions()

const running = computed(() =>
  sessions.value
    .filter(s => s.activity === 'working')
    .sort((a, b) => a.updatedAt - b.updatedAt),
)
</script>

<template>
  <section v-if="running.length" aria-labelledby="now-running-title">
    <div class="flex items-baseline gap-2.5 mb-3">
      <h2 id="now-running-title" class="text-section-label">Running</h2>
      <span class="type-mono-meta">{{ running.length }}</span>
    </div>

    <ul class="rounded-lg overflow-hidden bg-card divide-y" style="border-color: var(--border-subtle);">
      <li v-for="session in running" :key="session.id">
        <NuxtLink
          :to="`/sessions/${session.id}`"
          class="flex items-center gap-3 px-4 py-3 hover-row focus-ring group"
        >
          <UIcon name="i-lucide-loader-2" class="size-4 shrink-0 animate-spin ink-accent" />

          <div class="flex-1 min-w-0">
            <span class="type-strong block truncate">{{ session.title }}</span>
            <span class="type-mono block truncate mt-0.5">{{ session.branch }}</span>
          </div>

          <div class="flex items-center gap-3 shrink-0">
            <span v-if="session.turnCount" class="type-mono-meta">
              {{ session.turnCount }} turn{{ session.turnCount === 1 ? '' : 's' }}
            </span>
            <span class="type-mono-meta hidden sm:inline">{{ relativeTime(session.updatedAt) }}</span>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-meta"
            />
          </div>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
