<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

/**
 * Worktrees as git reports them, not as we recorded them.
 *
 * Parallel sessions each leave a directory and a branch behind, and those are
 * easy to forget about. This shows the real state — including worktrees with no
 * session behind them, which is what a crash or a hand-made worktree leaves.
 */
const { data, orphans, fetchAll, prune } = useWorktrees()
const { workingDir } = useWorkingDir()
const toast = useToast()

const open = ref(false)
const pruning = ref(false)

onMounted(fetchAll)

// Worktrees are per-repository, so this has to follow the selected folder —
// otherwise picking a project leaves the panel showing nothing.
watch(workingDir, () => fetchAll())

async function onPrune() {
  pruning.value = true
  try {
    const result = await prune()
    if (result.removed.length) {
      toast.add({ title: `Removed ${result.removed.length} leftover workspace${result.removed.length === 1 ? '' : 's'}`, color: 'success' })
    }
    for (const failure of result.failed) {
      toast.add({ title: 'Could not remove one', description: failure.reason, color: 'error' })
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
  const home = data.value.root?.split('/.claude/')[0]
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
        v-if="orphans.length"
        class="type-mono-meta px-1.5 py-px rounded-full"
        style="background: var(--accent-muted); color: var(--accent);"
      >
        {{ orphans.length }} leftover
      </span>
    </button>

    <div v-if="open" class="px-4 pb-4 space-y-3" style="border-top: 1px solid var(--border-subtle);">
      <p class="type-meta pt-3 leading-relaxed">
        Each session gets its own checkout of this repository so several can run at once.
        They live outside the repo, at <span class="font-mono">{{ shortPath(data.root || '') }}</span>.
      </p>

      <div class="space-y-1">
        <div
          v-for="worktree in data.worktrees"
          :key="worktree.path"
          class="flex items-center gap-2.5 px-3 py-2 rounded-md"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
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
                class="type-mono-meta px-1.5 py-px rounded-full"
                style="background: var(--badge-subtle-bg);"
              >
                your repo
              </span>
              <span
                v-else-if="worktree.orphaned"
                class="type-mono-meta px-1.5 py-px rounded-full"
                style="background: var(--accent-muted); color: var(--accent);"
              >
                no session
              </span>
              <span v-else-if="worktree.prunable" class="type-mono-meta" style="color: var(--error);">
                directory missing
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
        </div>
      </div>

      <div v-if="orphans.length" class="flex items-center gap-2 pt-1">
        <UButton
          label="Clean up leftovers"
          icon="i-lucide-trash-2"
          size="xs"
          variant="soft"
          :loading="pruning"
          @click="onPrune"
        />
        <span class="type-meta">
          Removes the {{ orphans.length }} workspace{{ orphans.length === 1 ? '' : 's' }} with no session,
          and their branches. Anything with uncommitted work is kept.
        </span>
      </div>
    </div>
  </div>
</template>
