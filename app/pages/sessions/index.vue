<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

const { sessions, loading, fetchAll, create } = useSessions()
const { fetchAll: fetchWorktrees } = useWorktrees()
const { workingDir, displayPath } = useWorkingDir()
const router = useRouter()
const toast = useToast()

const title = ref('')
const creating = ref(false)
let poll: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await Promise.all([fetchAll(), fetchWorktrees()])
  poll = setInterval(() => {
    if (sessions.value.some(s => s.status === 'running')) fetchAll()
  }, 4000)
})

onUnmounted(() => { if (poll) clearInterval(poll) })

async function onCreate() {
  const value = title.value.trim()
  if (!value || creating.value) return

  creating.value = true
  try {
    const session = await create(value)
    title.value = ''
    await fetchWorktrees()
    router.push(`/sessions/${session.id}`)
  } catch (e) {
    toast.add({ title: 'Could not start a session', description: errorMessage(e), color: 'error' })
  } finally {
    creating.value = false
  }
}

function relative(ts: number) {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div>
    <PageHeader title="Sessions">
      <template #trailing>
        <span v-if="sessions.length" class="type-mono-meta">{{ sessions.length }}</span>
      </template>
    </PageHeader>

    <div class="px-6 py-4 space-y-6 max-w-4xl">
      <p class="type-body">
        Each session works on its own copy of your project, so several can run at the same time
        without overwriting each other. Nothing touches your actual files until you merge it.
      </p>

      <!-- Needs a repo to branch from -->
      <div
        v-if="!workingDir"
        class="rounded-md px-4 py-3 flex items-start gap-3"
        style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
      >
        <UIcon name="i-lucide-folder" class="size-4 shrink-0 mt-0.5" style="color: var(--accent);" />
        <span class="type-detail" style="color: var(--text-secondary);">
          Pick a project folder in the sidebar first. Sessions branch from a git repository.
        </span>
      </div>

      <div v-else class="flex gap-2">
        <input
          v-model="title"
          class="field-input flex-1"
          placeholder="What should this session work on?"
          :disabled="creating"
          @keydown.enter="onCreate"
        />
        <UButton
          label="Start session"
          icon="i-lucide-plus"
          size="sm"
          :loading="creating"
          :disabled="!title.trim()"
          @click="onCreate"
        />
      </div>

      <div v-if="loading && !sessions.length" class="space-y-1">
        <SkeletonRow v-for="i in 3" :key="i" />
      </div>

      <div v-else-if="sessions.length" class="space-y-2">
        <NuxtLink
          v-for="session in sessions"
          :key="session.id"
          :to="`/sessions/${session.id}`"
          class="flex items-center gap-3 px-4 py-3 rounded-md group focus-ring hover-row"
          style="border: 1px solid var(--border-subtle);"
        >
          <UIcon
            :name="session.status === 'running' ? 'i-lucide-loader-2' : 'i-lucide-git-branch'"
            class="size-4 shrink-0"
            :class="{ 'animate-spin': session.status === 'running' }"
            :style="{ color: session.status === 'running' ? 'var(--accent)' : 'var(--text-disabled)' }"
          />

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="type-strong truncate">{{ session.title }}</span>
              <span
                v-if="session.status === 'archived'"
                class="type-mono-meta px-1.5 py-px rounded-full"
                style="background: var(--badge-subtle-bg);"
              >
                closed
              </span>
              <span
                v-else-if="!session.worktree.exists"
                class="type-mono-meta px-1.5 py-px rounded-full"
                style="background: rgba(248,113,113,0.12); color: var(--error);"
              >
                workspace missing
              </span>
            </div>
            <div class="flex items-center gap-2 mt-0.5 type-mono-meta">
              <span style="color: var(--accent);">{{ session.branch }}</span>
              <span>from {{ session.baseBranch }}</span>
              <span>·</span>
              <span>{{ relative(session.updatedAt) }}</span>
            </div>
          </div>

          <div class="flex items-center gap-3 shrink-0 type-mono-meta">
            <span v-if="session.worktree.changedFiles" :title="`${session.worktree.changedFiles} files changed`">
              {{ session.worktree.changedFiles }} changed
            </span>
            <span v-if="session.worktree.dirty" style="color: var(--accent);">uncommitted</span>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </div>
        </NuxtLink>
      </div>

      <EmptyState
        v-else-if="workingDir"
        icon="i-lucide-git-branch"
        title="No sessions yet"
        description="Start one to give Claude its own copy of this project to work in. You can run several at once and review each one's changes before keeping them."
      />

      <!-- Always visible, so worktrees never accumulate unnoticed -->
      <WorktreePanel />
    </div>
  </div>
</template>
