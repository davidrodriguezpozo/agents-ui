<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import type { Session } from '~/composables/useSessions'

const { sessions, here, elsewhere, workingCount, needsYouCount, loading, fetchAll, create } = useSessions()
const { fetchAll: fetchWorktrees } = useWorktrees()
const { workingDir, displayPath } = useWorkingDir()
const router = useRouter()
const toast = useToast()

const title = ref('')
const creating = ref(false)
let poll: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await Promise.all([fetchAll(), fetchWorktrees()])
  // Only poll while something could change on its own.
  poll = setInterval(() => {
    if (sessions.value.some(s => s.activity === 'working')) fetchAll()
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

function repoName(session: Session) {
  return session.repoDir.split('/').filter(Boolean).pop() ?? session.repoDir
}

/** Sessions needing an answer come first — they are the ones blocking. */
const ordered = computed(() => {
  const rank = { 'awaiting-permission': 0, working: 1, failed: 2, idle: 3, missing: 4 }
  return [...here.value].sort(
    (a, b) => rank[a.activity] - rank[b.activity] || b.updatedAt - a.updatedAt,
  )
})
</script>

<template>
  <div>
    <PageHeader width="narrow" title="Sessions">
      <template #trailing>
        <span v-if="sessions.length" class="type-mono-meta">{{ sessions.length }}</span>
        <SessionStatus
          v-if="needsYouCount"
          activity="awaiting-permission"
          compact
        />
      </template>
    </PageHeader>

    <div class="page-container page-container--narrow py-4 space-y-5">
      <p class="type-body">
        Each session works on its own copy of your project, so several can run at the same time
        without overwriting each other. Nothing touches your files until you merge it.
      </p>

      <!-- Start a session -->
      <div v-if="workingDir" class="space-y-1.5">
        <div class="flex gap-2">
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
        <p class="type-meta">
          Branches from <span class="font-mono">{{ displayPath }}</span> — its own workspace, its own branch.
        </p>
      </div>

      <div
        v-else
        class="rounded-md px-4 py-3 flex items-start gap-3"
        style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
      >
        <UIcon name="i-lucide-folder" class="size-4 shrink-0 mt-0.5" style="color: var(--accent);" />
        <span class="type-detail" style="color: var(--text-secondary);">
          Pick a project folder in the sidebar to start a session. Sessions branch from a git repository.
        </span>
      </div>

      <div v-if="loading && !sessions.length" class="space-y-1">
        <SkeletonRow v-for="i in 3" :key="i" />
      </div>

      <!-- Sessions in the current project -->
      <div v-else-if="ordered.length" class="space-y-2">
        <NuxtLink
          v-for="session in ordered"
          :key="session.id"
          :to="`/sessions/${session.id}`"
          class="block rounded-md p-4 focus-ring hover-card bg-card"
          :style="session.activity === 'awaiting-permission'
            ? 'border-color: var(--accent-glow);'
            : undefined"
        >
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0 space-y-1.5">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="type-strong truncate">{{ session.title }}</span>
                <SessionStatus
                  :activity="session.activity"
                  :changed-files="session.worktree.changedFiles"
                  :dirty="session.worktree.dirty"
                />
              </div>

              <!-- What it has produced, which is what you decide on -->
              <div class="flex items-center gap-3 type-meta">
                <span v-if="session.worktree.changedFiles" class="flex items-center gap-1">
                  <UIcon name="i-lucide-file-diff" class="size-3 shrink-0" />
                  {{ session.worktree.changedFiles }} file{{ session.worktree.changedFiles === 1 ? '' : 's' }}
                </span>
                <span v-if="session.worktree.ahead" class="flex items-center gap-1">
                  <UIcon name="i-lucide-git-commit-horizontal" class="size-3 shrink-0" />
                  {{ session.worktree.ahead }} commit{{ session.worktree.ahead === 1 ? '' : 's' }}
                </span>
                <span v-if="session.worktree.dirty" style="color: var(--accent);">uncommitted</span>
                <span v-if="session.turnCount" class="flex items-center gap-1">
                  <UIcon name="i-lucide-message-square" class="size-3 shrink-0" />
                  {{ session.turnCount }}
                </span>
                <span v-if="!session.worktree.changedFiles && !session.turnCount">
                  Nothing yet
                </span>
              </div>
            </div>

            <span class="type-mono-meta shrink-0">{{ relative(session.updatedAt) }}</span>
          </div>

          <!-- Branch detail last: useful, but not what you scan for -->
          <div class="flex items-center gap-1.5 mt-2.5 pt-2.5 type-mono-meta" style="border-top: 1px solid var(--border-subtle);">
            <UIcon name="i-lucide-git-branch" class="size-2.5 shrink-0" />
            <span class="truncate">{{ session.branch }}</span>
            <span class="shrink-0">from {{ session.baseBranch }}</span>
          </div>
        </NuxtLink>
      </div>

      <EmptyState
        v-else-if="workingDir"
        icon="i-lucide-git-branch"
        title="No sessions in this project"
        description="Start one to give Claude its own copy of this project to work in. You can run several at once and review each one's changes before keeping them."
      />

      <!-- Sessions elsewhere, so they never vanish just because the folder changed -->
      <div v-if="elsewhere.length" class="space-y-2">
        <h2 class="text-section-label">In other projects</h2>
        <NuxtLink
          v-for="session in elsewhere"
          :key="session.id"
          :to="`/sessions/${session.id}`"
          class="flex items-center gap-3 px-3 py-2.5 rounded-md group focus-ring hover-row"
        >
          <UIcon name="i-lucide-folder-git-2" class="size-3.5 shrink-0 text-meta" />
          <span class="type-detail truncate flex-1">{{ session.title }}</span>
          <span class="type-mono-meta shrink-0">{{ repoName(session) }}</span>
          <SessionStatus
            :activity="session.activity"
            :changed-files="session.worktree.changedFiles"
            compact
          />
        </NuxtLink>
      </div>

      <!-- Always visible, so worktrees never accumulate unnoticed -->
      <WorktreePanel />
    </div>
  </div>
</template>
