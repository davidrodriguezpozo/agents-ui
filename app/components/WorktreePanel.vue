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
const { data, orphans, restorable, strays, fetchAll, prune, recover } = useWorktrees()
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

/*
 * A lost conversation is a problem the user should see, not one hidden behind a
 * collapsed panel.
 *
 * Keyed on `restorable` and therefore on a transcript existing. It used to be
 * keyed on the directory existing, which meant every orphaned worktree forced
 * this open — twelve of them on a real machine, none of them a session of ours,
 * every single load. An alarm that is always on is one nobody reads, which costs
 * the actual case this exists for.
 */
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
      <UIcon name="i-lucide-git-branch" class="size-3.5 ink-3" />
      <span class="type-detail ink-2">Workspaces on disk</span>
      <span class="type-mono-meta">{{ data.worktrees.length }}</span>
      <!--
        Ordered by how much it wants you. A lost conversation is the only one of
        the three worth accent colour; a branch nobody owns is a fact, and a
        leftover is housekeeping.
      -->
      <span
        v-if="restorable.length"
        class="type-mono-meta px-1.5 py-px rounded-full"
        style="background: var(--accent-muted); color: var(--accent);"
      >
        {{ restorable.length }} to restore
      </span>
      <span
        v-else-if="strays.length"
        class="type-mono-meta px-1.5 py-px rounded-full"
        style="background: var(--badge-subtle-bg);"
      >
        {{ strays.length }} not from a session
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
            worktree.recovery?.hasConversation ? 'var(--accent-glow)' : 'var(--border-subtle)'
          };`"
        >
          <UIcon
            :name="worktree.isMain ? 'i-lucide-folder-git-2' : worktree.orphaned ? 'i-lucide-circle-alert' : 'i-lucide-git-branch'"
            class="size-3.5 shrink-0"
            :style="{ color: worktree.orphaned ? 'var(--accent)' : 'var(--text-disabled)' }"
          />

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-mono type-detail truncate ink">
                {{ worktree.branch || 'detached' }}
              </span>
              <span
                v-if="worktree.isMain"
                class="type-mono-meta px-1.5 py-px rounded-full shrink-0"
                style="background: var(--badge-subtle-bg);"
              >
                your repo
              </span>
              <!--
                True of both kinds, so only the colour separates them: accent
                where a conversation is waiting to be brought back, plain where
                the branch is all there ever was. Twelve accent badges taught
                the reader to stop seeing the colour.
              -->
              <span
                v-else-if="worktree.orphaned"
                class="type-mono-meta px-1.5 py-px rounded-full shrink-0"
                :style="worktree.recovery?.hasConversation
                  ? 'background: var(--accent-muted); color: var(--accent);'
                  : 'background: var(--badge-subtle-bg);'"
              >
                no session
              </span>
              <span v-else-if="worktree.prunable" class="type-mono-meta shrink-0 ink-error">
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

          <!--
            Offered on every row, including the ones with no session behind
            them: a stray branch with commits only here is exactly the case
            where you want to look at the files before deciding anything, and
            until now the path was something to select and paste by hand.
          -->
          <OpenInEditor compact :path="worktree.path" :missing="worktree.prunable" />

          <NuxtLink
            v-if="worktree.sessionId"
            :to="`/sessions/${worktree.sessionId}`"
            class="type-meta px-2 py-1 rounded hover-bg shrink-0"
          >
            Open
          </NuxtLink>

          <!--
            "Restore" only where there is a conversation to restore. The same
            call on a branch with no transcript still gives you a usable session
            — the branch, its commits, its checks — so it is offered, under a
            word that does not promise the part that is missing.
          -->
          <UButton
            v-else-if="worktree.recovery?.exists"
            :label="worktree.recovery.hasConversation ? 'Restore' : 'Adopt'"
            :icon="worktree.recovery.hasConversation ? 'i-lucide-rotate-ccw' : 'i-lucide-git-branch-plus'"
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

      <!--
        Branches in here that were never sessions of ours.

        Said rather than bulk-offered: this is where a dozen unmerged commits
        were sitting, and "adopt all twelve" is not a decision anybody can make
        from one line. Each row has its own button, which is the right grain.
      -->
      <div v-if="strays.length" class="flex items-start gap-2 pt-1">
        <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0 mt-0.5 ink-4" />
        <span class="type-meta">
          {{ strays.length === 1 ? 'One workspace here has' : `${strays.length} workspaces here have` }}
          no conversation behind {{ strays.length === 1 ? 'it' : 'them' }} — a branch and its
          commits, but nothing this app started. Adopting one gives you a session on that
          branch; there is no conversation to pick up.
        </span>
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
