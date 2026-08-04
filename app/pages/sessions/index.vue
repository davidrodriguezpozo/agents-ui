<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { isSendKey } from '~/utils/keys'
import type { Session } from '~/composables/useSessions'

const {
  sessions, here, elsewhere, workingCount, needsYouCount, loading,
  fetchAll, create, createMany, startFrom,
} = useSessions()
const { fetchAll: fetchWorktrees } = useWorktrees()
const { transcripts, fetchAll: fetchTranscripts, adopt } = useTranscripts()
const { workingDir, displayPath } = useWorkingDir()
const router = useRouter()
const toast = useToast()

const prompt = ref('')
const creating = ref(false)
const existingRef = ref('')
const startingFrom = ref(false)

/**
 * Starting several at once is its own mode rather than a clever reading of the
 * main box. One instruction per line is only obvious once you have been told;
 * inferred from a multi-line paste it would turn one carefully written prompt
 * into eight sessions and eight checkouts, which is not a mistake anyone wants
 * to discover afterwards.
 */
const batchMode = ref(false)
const batchText = ref('')
const startingBatch = ref(false)

const batchPrompts = computed(() =>
  batchText.value.split('\n').map(line => line.trim()).filter(Boolean)
)

const MAX_AT_ONCE = 20
const tooMany = computed(() => batchPrompts.value.length > MAX_AT_ONCE)

async function onCreateMany() {
  if (!batchPrompts.value.length || startingBatch.value || tooMany.value) return

  startingBatch.value = true
  try {
    const result = await createMany(batchPrompts.value)
    await fetchWorktrees()

    if (result.started.length) {
      const stalled = result.started.filter(s => s.startError).length
      toast.add({
        title: `${result.started.length} session${result.started.length === 1 ? '' : 's'} started`,
        description: stalled
          ? `${stalled} got a workspace but did not start working — open them to see why.`
          : 'They are working now. Nothing touches your files until you merge.',
        color: stalled ? 'warning' : 'success',
      })
    }

    // Named individually: "3 failed" tells you nothing you can act on.
    for (const failure of result.failed) {
      toast.add({
        title: `Could not start "${failure.prompt.slice(0, 40)}"`,
        description: failure.reason,
        color: 'error',
      })
    }

    if (result.started.length) {
      batchText.value = ''
      batchMode.value = false
    }
  } catch (e) {
    toast.add({ title: 'Could not start those', description: errorMessage(e), color: 'error' })
  } finally {
    startingBatch.value = false
  }
}

/**
 * Not all work starts from nothing. Continuing a colleague's branch, picking
 * up a pull request or fixing a failing check all begin from something that
 * already exists, and until now that meant doing it by hand first.
 */
async function onStartFrom() {
  const value = existingRef.value.trim()
  if (!value || startingFrom.value) return

  startingFrom.value = true
  try {
    const session = await startFrom(value)
    existingRef.value = ''
    await fetchWorktrees()
    router.push(`/sessions/${session.id}`)
  } catch (e) {
    toast.add({ title: 'Could not start there', description: errorMessage(e), color: 'error' })
  } finally {
    startingFrom.value = false
  }
}
let poll: ReturnType<typeof setInterval> | null = null

const adopting = ref<string | null>(null)

/**
 * Continue a terminal conversation here. It resumes exactly where it left off,
 * but in a worktree — which is the part the terminal cannot give you.
 */
async function onAdopt(sdkSessionId: string) {
  adopting.value = sdkSessionId
  try {
    const session = await adopt(sdkSessionId)
    await fetchWorktrees()
    router.push(`/sessions/${session.id}`)
  } catch (e) {
    toast.add({ title: 'Could not continue that', description: errorMessage(e), color: 'error' })
  } finally {
    adopting.value = null
  }
}

onMounted(async () => {
  await Promise.all([fetchAll(), fetchWorktrees(), fetchTranscripts()])
  // Only poll while something could change on its own.
  poll = setInterval(() => {
    if (sessions.value.some(s => s.activity === 'working')) fetchAll()
  }, 4000)
})

onUnmounted(() => { if (poll) clearInterval(poll) })

async function onCreate() {
  const value = prompt.value.trim()
  if (!value || creating.value) return

  creating.value = true
  try {
    const session = await create(value)
    prompt.value = ''
    await fetchWorktrees()

    // The session exists either way, so go to it — a workspace that could not
    // take its first turn is still somewhere you can see why and try again.
    if (session.startError) {
      toast.add({
        title: 'Started, but it is not working yet',
        description: session.startError,
        color: 'warning',
      })
    }

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

/**
 * Two things earn a card an outline: it is waiting on you, or it has produced
 * something that does not work. Both are cases where scrolling past would be a
 * mistake, which is the only thing an outline is for.
 */
function cardAccent(session: Session) {
  if (session.activity === 'awaiting-permission') return 'border-color: var(--accent-glow);'
  if (session.activity === 'idle' && session.check?.status === 'failing') {
    return 'border-color: var(--error);'
  }
  return undefined
}

/** Sessions needing an answer come first — they are the ones blocking. */
const ordered = computed(() => {
  const rank = { 'awaiting-permission': 0, working: 2, failed: 3, idle: 4, missing: 5 }

  // A session that finished and does not work needs you almost as much as one
  // that is asking — it just has not said so. Without this it sorts as plain
  // idle and sits below whatever ran most recently.
  const rankOf = (s: Session) =>
    s.activity === 'idle' && s.check?.status === 'failing' ? 1 : rank[s.activity]

  return [...here.value].sort(
    (a, b) => rankOf(a) - rankOf(b) || b.updatedAt - a.updatedAt,
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
        <!-- One session, told what to do in the same breath -->
        <template v-if="!batchMode">
          <div class="flex gap-2 items-start">
            <textarea
              v-model="prompt"
              rows="2"
              class="field-input flex-1 resize-y"
              placeholder="What should this session do? Enter to start, Shift+Enter for a new line."
              :disabled="creating"
              @keydown="e => { if (isSendKey(e)) { e.preventDefault(); onCreate() } }"
            />
            <UButton
              label="Start session"
              icon="i-lucide-plus"
              size="sm"
              :loading="creating"
              :disabled="!prompt.trim()"
              @click="onCreate"
            />
          </div>
          <p class="type-meta">
            Branches from <span class="font-mono">{{ displayPath }}</span> — its own workspace, its own
            branch — and starts work straight away.
            <button class="underline underline-offset-2 hover:text-label" @click="batchMode = true">
              Start several at once
            </button>
          </p>
        </template>

        <!-- Several sessions, one per line, counted before anything happens -->
        <template v-else>
          <textarea
            v-model="batchText"
            rows="5"
            class="field-input w-full resize-y font-mono text-[12px]"
            placeholder="One instruction per line — each becomes its own session:&#10;&#10;Fix the flaky upload test&#10;Update the README for the new install flow&#10;Bump the linter and fix what it finds"
            :disabled="startingBatch"
          />
          <div class="flex items-center gap-2 flex-wrap">
            <UButton
              :label="batchPrompts.length
                ? `Start ${batchPrompts.length} session${batchPrompts.length === 1 ? '' : 's'}`
                : 'Start sessions'"
              icon="i-lucide-layers"
              size="sm"
              :loading="startingBatch"
              :disabled="!batchPrompts.length || tooMany"
              @click="onCreateMany"
            />
            <UButton
              label="Cancel"
              size="sm"
              variant="ghost"
              color="neutral"
              :disabled="startingBatch"
              @click="() => { batchMode = false; batchText = '' }"
            />
            <span v-if="tooMany" class="type-meta" style="color: var(--error);">
              {{ batchPrompts.length }} is too many — {{ MAX_AT_ONCE }} at once is the limit.
              Each one is a full checkout.
            </span>
            <span v-else-if="startingBatch" class="type-meta">
              Cutting a workspace each. They start working as they are made.
            </span>
          </div>
        </template>

        <!-- Or start on something that already exists -->
        <div v-if="!batchMode" class="flex gap-2 pt-1">
          <input
            v-model="existingRef"
            class="field-input flex-1"
            placeholder="…or paste a pull request URL, or a branch name"
            :disabled="startingFrom"
            @keydown.enter="onStartFrom"
          />
          <UButton
            label="Work on it"
            icon="i-lucide-git-pull-request-arrow"
            size="sm"
            variant="soft"
            color="neutral"
            :loading="startingFrom"
            :disabled="!existingRef.trim()"
            @click="onStartFrom"
          />
        </div>
        <p v-if="!batchMode" class="type-meta">
          Checks the branch out in its own workspace. What you change from there is
          this session's, shown separately from what the branch already had.
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

      <!-- Work already started in the terminal, which this can pick up -->
      <div v-if="workingDir && transcripts.length" class="space-y-2">
        <h2 class="text-section-label">Continue from your terminal</h2>
        <p class="type-meta">
          Conversations you had with Claude Code here. Continuing one resumes it in a
          workspace of its own, so what it does next is reviewable before it lands.
          The workspace is a clean copy of the branch — uncommitted work from the terminal
          stays where it is.
        </p>
        <div
          v-for="transcript in transcripts.slice(0, 5)"
          :key="transcript.sdkSessionId"
          class="flex items-center gap-3 px-3 py-2.5 rounded-md"
          style="border: 1px dashed var(--border-subtle);"
        >
          <UIcon name="i-lucide-terminal" class="size-4 shrink-0" style="color: var(--text-disabled);" />
          <div class="flex-1 min-w-0">
            <div class="type-strong truncate text-body">{{ transcript.title }}</div>
            <div class="type-mono-meta">
              {{ transcript.turnCount }} turn{{ transcript.turnCount === 1 ? '' : 's' }}
              · {{ relative(transcript.updatedAt) }}
            </div>
          </div>
          <UButton
            label="Continue here"
            size="xs"
            variant="soft"
            :loading="adopting === transcript.sdkSessionId"
            :disabled="Boolean(adopting)"
            @click="onAdopt(transcript.sdkSessionId)"
          />
        </div>
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
          :style="cardAccent(session)"
        >
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0 space-y-1.5">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="type-strong truncate">{{ session.title }}</span>
                <SessionStatus
                  :activity="session.activity"
                  :changed-files="session.worktree.changedFiles"
                  :dirty="session.worktree.dirty"
                  :check="session.check"
                />
              </div>

              <!--
                What it did, in words. The counts below say how much changed;
                this is the only thing on the row that says what the change
                was, which is what you actually decide on.
              -->
              <p v-if="session.summary" class="type-detail leading-snug" style="color: var(--text-secondary);">
                {{ session.summary.text }}
              </p>

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
