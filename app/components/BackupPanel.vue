<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

/**
 * Backups of the state that cannot be rebuilt from anything else.
 *
 * The point of showing this rather than leaving it silent is that a damaged
 * store is discovered here, next to the button that fixes it — and that people
 * can see the app is protecting their rituals without being asked to trust it.
 */
interface SnapshotInfo {
  name: string
  createdAt: number
  reason: 'auto' | 'manual' | 'pre-restore' | 'startup'
  sessions: number
  schedules: number
  bytes: number
}

const data = ref<{
  directory: string
  snapshots: SnapshotInfo[]
  live: { sessions: number; schedules: number } | null
  problem: string | null
} | null>(null)

const loading = ref(true)
const busy = ref(false)
const confirming = ref<string | null>(null)
const expanded = ref(false)
const toast = useToast()

async function load() {
  try {
    data.value = await $fetch('/api/backups')
  } catch (e) {
    toast.add({ title: 'Could not read backups', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function onBackupNow() {
  busy.value = true
  try {
    const result = await $fetch<{ created: boolean; name?: string; reason?: string }>(
      '/api/backups',
      { method: 'POST' },
    )
    toast.add({
      title: result.created ? 'Backup taken' : 'Nothing to back up',
      description: result.reason,
      color: 'success',
    })
    await load()
  } catch (e) {
    toast.add({ title: 'Backup failed', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function onRestore(name: string) {
  busy.value = true
  try {
    const result = await $fetch<{
      restored: { sessions: number; schedules: number }
      safetySnapshot?: string
    }>('/api/backups/restore', { method: 'POST', body: { name } })

    toast.add({
      title: `Restored ${result.restored.schedules} ritual${result.restored.schedules === 1 ? '' : 's'} `
        + `and ${result.restored.sessions} session${result.restored.sessions === 1 ? '' : 's'}`,
      description: result.safetySnapshot
        ? 'The previous state was saved as a backup first, so this can be undone.'
        : undefined,
      color: 'success',
    })

    confirming.value = null
    await load()
    await refreshNuxtData()
  } catch (e) {
    toast.add({ title: 'Restore failed', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = false
  }
}

function relative(ts: number) {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 90) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function exactly(ts: number) {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const reasonLabel: Record<SnapshotInfo['reason'], string> = {
  auto: 'automatic',
  manual: 'you asked',
  startup: 'on startup',
  'pre-restore': 'before a restore',
}

const latest = computed(() => data.value?.snapshots[0] ?? null)
const visible = computed(() =>
  expanded.value ? data.value?.snapshots ?? [] : (data.value?.snapshots ?? []).slice(0, 5))
</script>

<template>
  <div class="rounded-lg p-5 space-y-4 bg-card">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-section-title">Backups</h3>
        <p class="fs-sm mt-1 text-label">
          Your daily rituals only exist here — nothing else on this machine remembers them.
          They are copied automatically, alongside your sessions, to a folder outside the app's
          own directory so a backup survives that directory being deleted.
        </p>
      </div>
      <UButton
        label="Back up now"
        icon="i-lucide-shield-check"
        size="sm"
        variant="soft"
        class="shrink-0"
        :loading="busy"
        @click="onBackupNow"
      />
    </div>

    <!-- A damaged store is found here, next to the thing that repairs it -->
    <div
      v-if="data?.problem"
      class="rounded-md px-4 py-3 flex items-start gap-3"
      style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
    >
      <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0 mt-0.5 ink-accent" />
      <div class="space-y-1">
        <div class="type-strong">Something is wrong with your saved data</div>
        <div class="type-detail ink-2">{{ data.problem }}</div>
      </div>
    </div>

    <div v-if="loading" class="space-y-1">
      <SkeletonRow v-for="i in 2" :key="i" />
    </div>

    <template v-else-if="data">
      <div v-if="data.live" class="type-meta">
        Protecting {{ data.live.schedules }} ritual{{ data.live.schedules === 1 ? '' : 's' }}
        and {{ data.live.sessions }} session{{ data.live.sessions === 1 ? '' : 's' }}.
        <template v-if="latest">Last backup {{ relative(latest.createdAt) }}.</template>
      </div>

      <EmptyState
        v-if="!data.snapshots.length"
        icon="i-lucide-shield"
        title="No backups yet"
        description="One is taken shortly after the app starts, then every half hour if anything changed."
      />

      <div v-else class="space-y-1">
        <div
          v-for="snapshot in visible"
          :key="snapshot.name"
          class="rounded-md px-3 py-2"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        >
          <div class="flex items-center gap-3">
            <UIcon name="i-lucide-shield-check" class="size-3.5 shrink-0 ink-4" />

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="type-detail ink">{{ exactly(snapshot.createdAt) }}</span>
                <span class="type-mono-meta px-1.5 py-px rounded-full" style="background: var(--badge-subtle-bg);">
                  {{ reasonLabel[snapshot.reason] }}
                </span>
              </div>
              <div class="type-meta">
                {{ snapshot.schedules }} ritual{{ snapshot.schedules === 1 ? '' : 's' }},
                {{ snapshot.sessions }} session{{ snapshot.sessions === 1 ? '' : 's' }}
              </div>
            </div>

            <UButton
              v-if="confirming !== snapshot.name"
              label="Restore"
              size="xs"
              variant="ghost"
              color="neutral"
              class="shrink-0"
              :disabled="busy"
              @click="() => { confirming = snapshot.name }"
            />
          </div>

          <!-- Say exactly what changes before it changes -->
          <div v-if="confirming === snapshot.name" class="mt-2 pt-2 space-y-2" style="border-top: 1px solid var(--border-subtle);">
            <p class="type-meta leading-relaxed">
              This replaces your current rituals and sessions with the {{ snapshot.schedules }} ritual{{ snapshot.schedules === 1 ? '' : 's' }}
              and {{ snapshot.sessions }} session{{ snapshot.sessions === 1 ? '' : 's' }} from {{ relative(snapshot.createdAt) }}.
              Your worktrees, branches and run history are not touched, and the current state is
              backed up first so you can undo this.
            </p>
            <div class="flex items-center gap-2">
              <UButton label="Restore this backup" size="xs" :loading="busy" @click="onRestore(snapshot.name)" />
              <UButton label="Cancel" size="xs" variant="ghost" color="neutral" @click="() => { confirming = null }" />
            </div>
          </div>
        </div>

        <button
          v-if="data.snapshots.length > 5"
          class="type-meta px-3 py-1 rounded hover-bg focus-ring"
          @click="expanded = !expanded"
        >
          {{ expanded ? 'Show fewer' : `Show all ${data.snapshots.length}` }}
        </button>
      </div>

      <p class="type-mono-meta">{{ data.directory }}</p>
    </template>
  </div>
</template>
