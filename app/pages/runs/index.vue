<script setup lang="ts">
const { runs, loading, fetchRuns } = useRuns()

let poll: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await fetchRuns()
  // Cheap refresh so in-flight runs tick over without a socket.
  poll = setInterval(() => {
    if (runs.value.some(r => r.status === 'running' || r.status === 'queued')) fetchRuns()
  }, 4000)
})

onUnmounted(() => { if (poll) clearInterval(poll) })

const active = computed(() => runs.value.filter(r => r.status === 'running' || r.status === 'queued'))
const finished = computed(() => runs.value.filter(r => r.status !== 'running' && r.status !== 'queued'))

function statusStyle(status: string) {
  switch (status) {
    case 'running':
    case 'queued':
      return { background: 'var(--accent-muted)', color: 'var(--accent)' }
    case 'completed':
      return { background: 'rgba(34,197,94,0.12)', color: 'rgb(34,197,94)' }
    case 'failed':
      return { background: 'rgba(248,113,113,0.12)', color: 'var(--error)' }
    default:
      return { background: 'var(--badge-subtle-bg)', color: 'var(--text-tertiary)' }
  }
}

function relative(ts: number) {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function duration(ms?: number) {
  if (!ms) return null
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}
</script>

<template>
  <div>
    <PageHeader width="narrow" title="Activity">
      <template #trailing>
        <span v-if="active.length" class="text-[11px] font-mono" style="color: var(--accent);">
          {{ active.length }} running
        </span>
      </template>
    </PageHeader>

    <div class="page-container page-container--narrow py-4 space-y-6">
      <p class="type-body leading-relaxed">
        Everything Claude has run for you. Runs keep going if you close the tab — come back any time.
      </p>

      <div v-if="loading && !runs.length" class="space-y-1">
        <SkeletonRow v-for="i in 4" :key="i" />
      </div>

      <template v-else-if="runs.length">
        <div v-if="active.length" class="space-y-2">
          <h2 class="text-section-label">In progress</h2>
          <NuxtLink
            v-for="run in active"
            :key="run.id"
            :to="`/runs/${run.id}`"
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg group focus-ring hover-row"
            style="border: 1px solid var(--accent-glow); background: var(--accent-muted);"
          >
            <UIcon name="i-lucide-loader-2" class="size-3.5 shrink-0 animate-spin" style="color: var(--accent);" />
            <span class="type-strong truncate flex-1 text-body">{{ run.title }}</span>
            <span class="font-mono text-[10px] shrink-0 text-meta">{{ relative(run.createdAt) }}</span>
          </NuxtLink>
        </div>

        <div v-if="finished.length" class="space-y-2">
          <h2 class="text-section-label">Earlier</h2>
          <NuxtLink
            v-for="run in finished"
            :key="run.id"
            :to="`/runs/${run.id}`"
            class="flex items-start gap-3 px-3 py-2.5 rounded-md group focus-ring hover-row"
          >
            <span
              class="text-[9px] font-mono px-1.5 py-px rounded-full shrink-0 mt-0.5"
              :style="statusStyle(run.status)"
            >
              {{ run.status }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="type-strong truncate text-body">{{ run.title }}</span>
                <span v-if="run.invocation" class="font-mono text-[10px] shrink-0" style="color: var(--accent);">
                  {{ run.invocation }}
                </span>
              </div>
              <p v-if="run.needsAttention" class="text-[11px] mt-0.5 flex items-center gap-1" style="color: var(--accent);">
                <UIcon name="i-lucide-shield-alert" class="size-3 shrink-0" />
                Incomplete — {{ (run.deniedTools || []).join(', ') || 'a tool' }} needed your approval
              </p>
              <p v-else-if="run.preview" class="text-[11px] truncate text-label mt-0.5">{{ run.preview }}</p>
              <p v-else-if="run.error" class="text-[11px] truncate mt-0.5" style="color: var(--error);">{{ run.error }}</p>
            </div>
            <div class="flex items-center gap-2.5 shrink-0 type-mono-meta">
              <span v-if="duration(run.durationMs)">{{ duration(run.durationMs) }}</span>
              <span>{{ relative(run.createdAt) }}</span>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </div>
          </NuxtLink>
        </div>
      </template>

      <EmptyState
        v-else
        icon="i-lucide-activity"
        title="Nothing has run yet"
        description="When Claude does something for you — a command you run, or a daily ritual firing on its own — it shows up here with the result."
        action-label="See what you can do"
        action-to="/"
      />
    </div>
  </div>
</template>
