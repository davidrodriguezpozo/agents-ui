<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { renderMarkdown } from '~/utils/markdown'
import type { DiffFile, Session, SessionTurn } from '~/composables/useSessions'

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const { fetchOne, send, fetchDiff, close } = useSessions()
const { live, attach, promptsFor, isAnsweringPermission, answerPermission } = useRuns()
const toast = useToast()

const session = ref<(Session & { turns: SessionTurn[] }) | null>(null)
const loadError = ref<string | null>(null)
const input = ref('')
const sending = ref(false)
const activeRunId = ref<string | null>(null)
const diff = ref<{ files: DiffFile[]; patch: string } | null>(null)
const showDiff = ref(false)
const showPatch = ref(false)
const showClose = ref(false)
const closing = ref(false)
let controller: AbortController | null = null

const liveRun = computed(() => (activeRunId.value ? live.value[activeRunId.value] : null))
const prompts = computed(() => (activeRunId.value ? promptsFor(activeRunId.value).value : []))
const isBusy = computed(() => session.value?.status === 'running' || liveRun.value?.status === 'running')

async function load() {
  try {
    session.value = await fetchOne(id)
    // Reattach to a turn still in flight — it kept going without this tab.
    const last = session.value.runIds.at(-1)
    if (last && session.value.status === 'running') watchRun(last)
  } catch (e) {
    loadError.value = errorMessage(e, 'That session no longer exists.')
  }
}

function watchRun(runId: string) {
  activeRunId.value = runId
  controller?.abort()
  controller = new AbortController()
  attach(runId, controller.signal)
    .catch(() => {})
    .finally(async () => {
      await load()
      await refreshDiff()
    })
}

async function refreshDiff() {
  try {
    diff.value = await fetchDiff(id)
    // If there is work to review and nothing to read, the diff is the point.
    if (diff.value.files.length && !session.value?.turns.length) showDiff.value = true
  } catch {
    diff.value = null
  }
}

onMounted(async () => {
  await load()
  await refreshDiff()
})

onUnmounted(() => controller?.abort())

async function onSend() {
  const value = input.value.trim()
  if (!value || sending.value || isBusy.value) return

  sending.value = true
  try {
    const runId = await send(id, value)
    input.value = ''
    await load()
    watchRun(runId)
  } catch (e) {
    toast.add({ title: 'Could not send', description: errorMessage(e), color: 'error' })
  } finally {
    sending.value = false
  }
}

async function onClose(opts: { force?: boolean; keepBranch?: boolean }) {
  closing.value = true
  try {
    const result = await close(id, opts)
    toast.add({
      title: result.branchKept ? `Closed — branch ${result.branchKept} kept` : 'Session closed',
      color: 'success',
    })
    router.push('/sessions')
  } catch (e) {
    toast.add({ title: 'Could not close', description: errorMessage(e), color: 'error' })
  } finally {
    closing.value = false
    showClose.value = false
  }
}

const totalChanges = computed(() => {
  if (!diff.value) return { added: 0, removed: 0 }
  return diff.value.files.reduce(
    (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
    { added: 0, removed: 0 },
  )
})
</script>

<template>
  <div>
    <PageHeader width="wide" :title="session?.title || 'Session'">
      <template #leading>
        <NuxtLink to="/sessions" class="focus-ring rounded p-1.5 -m-1.5" aria-label="Back to sessions">
          <UIcon name="i-lucide-arrow-left" class="size-4 text-label" />
        </NuxtLink>
      </template>
      <template #trailing>
        <span v-if="session" class="font-mono type-detail" style="color: var(--accent);">
          {{ session.branch }}
        </span>
      </template>
      <template #right>
        <UButton
          v-if="diff?.files.length"
          :label="showDiff ? 'Hide changes' : `${diff.files.length} changed`"
          icon="i-lucide-file-diff"
          size="sm"
          variant="soft"
          color="neutral"
          @click="showDiff = !showDiff"
        />
        <UButton
          label="Close session"
          size="sm"
          variant="ghost"
          color="neutral"
          @click="showClose = true"
        />
      </template>
    </PageHeader>

    <div class="page-container page-container--wide py-5 space-y-5">
      <div v-if="loadError" class="rounded-md px-4 py-3 type-detail" style="background: rgba(248,113,113,0.06); color: var(--error);">
        {{ loadError }}
      </div>

      <template v-else-if="session">
        <!-- Where this session is working, stated plainly -->
        <div class="rounded-md px-4 py-3 space-y-1" style="background: var(--surface-raised); border: 1px solid var(--border-subtle);">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0" style="color: var(--text-disabled);" />
            <span class="type-detail" style="color: var(--text-secondary);">
              Working on <span class="font-mono" style="color: var(--accent);">{{ session.branch }}</span>,
              branched from <span class="font-mono">{{ session.baseBranch }}</span>
            </span>
          </div>
          <div class="type-mono-meta pl-6 truncate">{{ session.worktreePath }}</div>
          <div v-if="!session.worktree.exists" class="type-meta pl-6" style="color: var(--error);">
            This workspace is missing from disk — it was removed outside the app.
          </div>
        </div>

        <!-- Changes -->
        <div v-if="showDiff && diff" class="rounded-md overflow-hidden" style="border: 1px solid var(--border-subtle);">
          <div
            class="px-4 py-2.5 flex items-center justify-between"
            style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);"
          >
            <span class="text-section-label">Changes</span>
            <span class="type-mono-meta">
              <span style="color: var(--success);">+{{ totalChanges.added }}</span>
              <span style="color: var(--error);" class="ml-2">−{{ totalChanges.removed }}</span>
            </span>
          </div>
          <div class="divide-y" style="border-color: var(--border-subtle);">
            <div
              v-for="file in diff.files"
              :key="`${file.path}-${file.staged}`"
              class="flex items-center gap-3 px-4 py-2"
            >
              <span class="font-mono type-detail flex-1 truncate">{{ file.path }}</span>
              <span
                v-if="!file.staged"
                class="type-mono-meta px-1.5 py-px rounded-full"
                style="background: var(--accent-muted); color: var(--accent);"
              >
                uncommitted
              </span>
              <span class="type-mono-meta" style="color: var(--success);">+{{ file.added }}</span>
              <span class="type-mono-meta" style="color: var(--error);">−{{ file.removed }}</span>
            </div>
          </div>

          <div v-if="diff.patch" style="border-top: 1px solid var(--border-subtle);">
            <button
              class="w-full flex items-center gap-2 px-4 py-2 text-left hover-bg transition-all"
              @click="showPatch = !showPatch"
            >
              <UIcon
                :name="showPatch ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-3"
                style="color: var(--text-disabled);"
              />
              <span class="type-meta">{{ showPatch ? 'Hide' : 'Show' }} the actual changes</span>
            </button>
            <pre
              v-if="showPatch"
              class="px-4 py-3 overflow-x-auto font-mono text-[11px] leading-[1.6] diff-patch"
              style="background: var(--surface-inset); border-top: 1px solid var(--border-subtle);"
            ><span
              v-for="(line, i) in diff.patch.split('\n')"
              :key="i"
              class="block"
              :style="{
                color: line.startsWith('+') && !line.startsWith('+++') ? 'var(--success)'
                  : line.startsWith('-') && !line.startsWith('---') ? 'var(--error)'
                  : line.startsWith('@@') ? 'var(--accent)'
                  : 'var(--text-tertiary)',
              }"
            >{{ line || ' ' }}</span></pre>
          </div>
        </div>

        <!-- Blocked on you: the session cannot continue until these are answered -->
        <div v-if="prompts.length" class="space-y-2">
          <PermissionPrompt
            v-for="request in prompts"
            :key="request.id"
            :request="request"
            :busy="isAnsweringPermission(request.id)"
            @answer="answerPermission(request.id, $event)"
          />
        </div>

        <!-- Conversation -->
        <div v-if="session.turns.length" class="space-y-4">
          <div v-for="turn in session.turns" :key="turn.id" class="space-y-2">
            <div class="flex justify-end">
              <div
                class="rounded-md px-3.5 py-2 max-w-[80%] type-body"
                style="background: var(--accent-muted); color: var(--text-primary);"
              >
                {{ turn.input }}
              </div>
            </div>
            <div
              v-if="turn.output"
              class="session-prose type-body"
              v-html="renderMarkdown(turn.id === activeRunId && liveRun?.output ? liveRun.output : turn.output)"
            />
            <div v-else-if="turn.status === 'running'" class="flex items-center gap-2 type-meta">
              <UIcon name="i-lucide-loader-2" class="size-3 animate-spin" style="color: var(--accent);" />
              Working — you can close this tab and come back.
            </div>
            <div v-if="turn.error" class="type-detail" style="color: var(--error);">{{ turn.error }}</div>
          </div>
        </div>

        <EmptyState
          v-else
          variant="inset"
          icon="i-lucide-message-square"
          title="Nothing yet"
          description="Tell Claude what to do in this workspace. It can change files freely — they're isolated from your project until you decide to keep them."
        />

        <!-- Composer -->
        <div class="flex gap-2">
          <textarea
            v-model="input"
            rows="2"
            class="field-textarea flex-1"
            :placeholder="isBusy ? 'Working…' : 'What should it do next?'"
            :disabled="isBusy || !session.worktree.exists"
            @keydown.meta.enter="onSend"
          />
          <UButton
            label="Send"
            icon="i-lucide-arrow-up"
            size="sm"
            :loading="sending"
            :disabled="!input.trim() || isBusy || !session.worktree.exists"
            @click="onSend"
          />
        </div>
      </template>

      <div v-else class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
      </div>
    </div>

    <!-- Closing is where work gets lost, so spell out what happens -->
    <UModal v-model:open="showClose">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay">
          <h3 class="text-page-title">Close this session?</h3>
          <p class="type-body">
            This removes the workspace at
            <span class="font-mono type-detail">{{ session?.worktreePath }}</span>.
          </p>
          <div
            v-if="session?.worktree.dirty"
            class="rounded-md px-3 py-2.5 type-detail"
            style="background: var(--accent-muted); color: var(--text-secondary);"
          >
            It has uncommitted changes. Keeping the branch will not save them — only committed
            work survives.
          </div>
          <div class="flex flex-col gap-2 pt-1">
            <UButton
              label="Keep the branch, remove the workspace"
              icon="i-lucide-git-branch"
              size="sm"
              :loading="closing"
              @click="onClose({ force: true, keepBranch: true })"
            />
            <UButton
              label="Delete everything, including the branch"
              icon="i-lucide-trash-2"
              size="sm"
              variant="soft"
              color="error"
              :loading="closing"
              @click="onClose({ force: true })"
            />
            <UButton label="Cancel" size="sm" variant="ghost" color="neutral" @click="showClose = false" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.session-prose :deep(p) { margin: 0.5em 0; }
.session-prose :deep(p:first-child) { margin-top: 0; }
.session-prose :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--badge-subtle-bg);
  padding: 0.15em 0.4em;
  border-radius: 4px;
}
.session-prose :deep(pre) {
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 0.75em 1em;
  overflow-x: auto;
  margin: 0.6em 0;
}
.session-prose :deep(pre code) { background: none; padding: 0; font-size: 0.85em; }
.session-prose :deep(ul), .session-prose :deep(ol) { padding-left: 1.5em; margin: 0.4em 0; }
</style>
