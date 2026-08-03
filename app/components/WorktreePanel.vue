<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

/**
 * Worktrees as git reports them, not as we recorded them.
 *
 * Parallel sessions each leave a directory and a branch behind, and those are
 * easy to forget about. This shows the real state — including worktrees with no
 * session behind them, which is what a crash or a damaged session index leaves.
 *
 * Those are offered restore first and cleanup second. A worktree that outlived
 * its record still holds the work and the conversation, so deleting it is
 * rarely what someone means, and it is the one action that cannot be undone.
 */
const { data, orphans, restorable, fetchAll, prune, recover } = useWorktrees()
const { workingDir } = useWorkingDir()
const router = useRouter()
const toast = useToast()

/** Mirrors the server's WORKTREE_DIR, for the note about test runners. */
const WORKTREE_DIR = '.worktrees'

const open = ref(false)
const pruning = ref(false)
const restoring = ref<string | null>(null)

onMounted(fetchAll)

// Worktrees are per-repository, so this has to follow the selected folder —
// otherwise picking a project leaves the panel showing nothing.
watch(workingDir, () => fetchAll())

// Something recoverable is a problem the user should see, not one hidden
// behind a collapsed panel.
watch(restorable, (list) => { if (list.length) open.value = true }, { immediate: true })

async function onRestore(path?: string) {
  restoring.value = path ?? 'all'
  try {
    const result = await recover(path ? { paths: [path] } : {})

    if (result.recovered.length === 1 && path) {
      toast.add({ title: `Restored “${result.recovered[0]!.title}”`, color: 'success' })
      router.push(`/sessions/${result.recovered[0]!.id}`)
    } else if (result.recovered.length) {
      toast.add({
        title: `Restored ${result.recovered.length} sessions`,
        description: 'Their conversations and changes are intact.',
        color: 'success',
      })
    }

    for (const skip of result.skipped) {
      toast.add({ title: 'Could not restore one', description: skip.reason, color: 'error' })
    }
  } catch (e) {
    toast.add({ title: 'Restore failed', description: errorMessage(e), color: 'error' })
  } finally {
    restoring.value = null
  }
}

async function onPrune() {
  pruning.value = true
  try {
    const result = await prune()
    if (result.removed.length) {
      toast.add({ title: `Removed ${result.removed.length} leftover workspace${result.removed.length === 1 ? '' : 's'}`, color: 'success' })
    }
    for (const failure of result.failed) {
      toast.add({ title: 'Kept one workspace', description: failure.reason, color: 'warning' })
    }
    if (!result.removed.length && !result.failed.length) {
      toast.add({ title: 'Nothing to clean up', color: 'success' })
    }
  } catch (e) {
    toast.add({ title: 'Cleanup failed', description: errorMessage(e), color: 'error' })
  } finally {
    pruning.value = false
  }
}

function shortPath(path: string): string {
  const home = data.value.home
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}
</script>

<template>
  <div v-if="data.isRepo" class="rounded-md overflow-hidden" style="border: 1px solid var(--border-subtle);">
    <button
      class="w-full flex items-center gap-2 px-4 py-2.5 text-left hover-bg transition-all"
      @click="open = !open"
    >
      <UIcon
        :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        class="size-3"
        style="color: var(--text-disabled);"
      />
      <UIcon name="i-lucide-git-branch" class="size-3.5" style="color: var(--text-tertiary);" />
      <span class="type-detail" style="color: var(--text-secondary);">Workspaces on disk</span>
      <span class="type-mono-meta">{{ data.worktrees.length }}</span>
      <span
        v-if="restorable.length"
        class="type-mono-meta px-1.5 py-px rounded-full"
        style="background: var(--accent-muted); color: var(--accent);"
      >
        {{ restorable.length }} to restore
      </span>
      <span
        v-else-if="orphans.length"
        class="type-mono-meta px-1.5 py-px rounded-full"
        style="background: var(--badge-subtle-bg);"
      >
        {{ orphans.length }} leftover
      </span>
    </button>

    <div v-if="open" class="px-4 pb-4 space-y-3" style="border-top: 1px solid var(--border-subtle);">
      <p class="type-meta pt-3 leading-relaxed">
        Each session gets its own checkout of this repository so several can run at once.
        They sit in <span class="font-mono">{{ shortPath(data.root || '') }}</span>, hidden from
        git so they never show up in <span class="font-mono">git status</span> or a commit.
        Test runners can still find them — exclude
        <span class="font-mono">{{ WORKTREE_DIR }}</span> in your config if a suite starts
        running more than once.
      </p>

      <div class="space-y-1">
        <div
          v-for="worktree in data.worktrees"
          :key="worktree.path"
          class="flex items-center gap-2.5 px-3 py-2 rounded-md"
          :style="`background: var(--surface-raised); border: 1px solid ${
            worktree.recovery?.exists ? 'var(--accent-glow)' : 'var(--border-subtle)'
          };`"
        >
          <UIcon
            :name="worktree.isMain ? 'i-lucide-folder-git-2' : worktree.orphaned ? 'i-lucide-circle-alert' : 'i-lucide-git-branch'"
            class="size-3.5 shrink-0"
            :style="{ color: worktree.orphaned ? 'var(--accent)' : 'var(--text-disabled)' }"
          />

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-mono type-detail truncate" style="color: var(--text-primary);">
                {{ worktree.branch || 'detached' }}
              </span>
              <span
                v-if="worktree.isMain"
                class="type-mono-meta px-1.5 py-px rounded-full shrink-0"
                style="background: var(--badge-subtle-bg);"
              >
                your repo
              </span>
              <span
                v-else-if="worktree.orphaned"
                class="type-mono-meta px-1.5 py-px rounded-full shrink-0"
                style="background: var(--accent-muted); color: var(--accent);"
              >
                no session
              </span>
              <span v-else-if="worktree.prunable" class="type-mono-meta shrink-0" style="color: var(--error);">
                directory missing
              </span>
            </div>

            <!-- For an orphan, what is actually in there decides what to do with it -->
            <div v-if="worktree.recovery?.exists" class="type-meta truncate mt-0.5">
              <span style="color: var(--text-secondary);">{{ worktree.recovery.title }}</span>
              <span v-if="worktree.recovery.turnCount">
                · {{ worktree.recovery.turnCount }} message{{ worktree.recovery.turnCount === 1 ? '' : 's' }}
              </span>
              <span v-if="worktree.recovery.unmergedCommits" style="color: var(--accent);">
                · {{ worktree.recovery.unmergedCommits }} commit{{ worktree.recovery.unmergedCommits === 1 ? '' : 's' }} only here
              </span>
            </div>

            <div class="type-mono-meta truncate">{{ shortPath(worktree.path) }}</div>
          </div>

          <NuxtLink
            v-if="worktree.sessionId"
            :to="`/sessions/${worktree.sessionId}`"
            class="type-meta px-2 py-1 rounded hover-bg shrink-0"
          >
            Open
          </NuxtLink>

          <UButton
            v-else-if="worktree.recovery?.exists"
            label="Restore"
            icon="i-lucide-rotate-ccw"
            size="xs"
            variant="soft"
            class="shrink-0"
            :loading="restoring === worktree.path"
            @click="onRestore(worktree.path)"
          />
        </div>
      </div>

      <!-- Restore first: it is reversible, and cleanup is not -->
      <div v-if="restorable.length" class="space-y-2 pt-1">
        <div class="flex items-center gap-2">
          <UButton
            :label="restorable.length === 1 ? 'Restore session' : `Restore ${restorable.length} sessions`"
            icon="i-lucide-rotate-ccw"
            size="xs"
            :loading="restoring === 'all'"
            @click="onRestore()"
          />
          <span class="type-meta">
            Brings back the conversation and changes. Nothing is re-run.
          </span>
        </div>
      </div>

      <div v-if="orphans.length" class="flex items-center gap-2" :class="restorable.length ? '' : 'pt-1'">
        <UButton
          label="Clean up leftovers"
          icon="i-lucide-trash-2"
          size="xs"
          variant="ghost"
          color="neutral"
          :loading="pruning"
          @click="onPrune"
        />
        <span class="type-meta">
          Deletes the workspace and its branch. Anything with uncommitted changes,
          or commits that exist nowhere else, is kept.
        </span>
      </div>
    </div>
  </div>
</template>
