<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { renderMarkdown } from '~/utils/markdown'
import { describeToolCall, filesTouched, type ToolCallLike } from '~/utils/toolCalls'
import type { DiffFile, MergePreview, Session, SessionTurn } from '~/composables/useSessions'

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const { fetchOne, send, fetchDiff, previewMerge, merge, close } = useSessions()
const { live, attach, cancelRun, promptsFor, isAnsweringPermission, answerPermission } = useRuns()
const { rules: projectRules, load: loadProjectRules, allowRule, revokeRule } = useProjectRules(() => session.value?.repoDir)
const { describeRule } = usePermissionRuleLabels()
const toast = useToast()

const session = ref<(Session & { turns: SessionTurn[] }) | null>(null)
const loadError = ref<string | null>(null)
const input = ref('')
const sending = ref(false)
const stopping = ref(false)
const activeRunId = ref<string | null>(null)
const diff = ref<{ files: DiffFile[]; patch: string } | null>(null)
const showDiff = ref(false)
const showPatch = ref(false)
const showClose = ref(false)
const closing = ref(false)
const showMerge = ref(false)
const mergePreview = ref<MergePreview | null>(null)
const merging = ref(false)
const commitFirst = ref(true)
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
  await loadProjectRules()
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

/**
 * Stop the turn that is running. Whatever it already wrote to the worktree
 * stays there — stopping ends the conversation turn, it does not undo work —
 * so the diff is refreshed by the stream's own teardown.
 */
async function onStop() {
  if (!activeRunId.value || stopping.value) return

  stopping.value = true
  try {
    await cancelRun(activeRunId.value)
    toast.add({ title: 'Stopped', description: 'Anything already changed is still in the workspace.' })
  } catch (e) {
    toast.add({ title: 'Could not stop', description: errorMessage(e), color: 'error' })
  } finally {
    stopping.value = false
  }
}

/**
 * Grant the rule, then answer the prompt it came from. In that order: if
 * saving fails, the prompt is still there to be answered by hand, whereas
 * answering first would leave the agent moving on while the grant silently
 * did not happen.
 */
async function onRemember(requestId: string, rule: string) {
  try {
    await allowRule(rule)
    toast.add({ title: 'Allowed from now on', description: describeRule(rule) })
  } catch (e) {
    toast.add({ title: 'Could not remember that', description: errorMessage(e), color: 'error' })
    return
  }

  await answerPermission(requestId, { behavior: 'allow', scope: 'session' })
}

async function openMerge() {
  showMerge.value = true
  mergePreview.value = null
  try {
    mergePreview.value = await previewMerge(id)
  } catch (e) {
    toast.add({ title: 'Could not check the merge', description: errorMessage(e), color: 'error' })
    showMerge.value = false
  }
}

async function onMerge() {
  merging.value = true
  try {
    const result = await merge(id, { commitFirst: commitFirst.value })
    toast.add({
      title: `Merged into ${mergePreview.value?.targetBranch}`,
      description: `${result.commitsBrought} commit${result.commitsBrought === 1 ? '' : 's'} brought across.`,
      color: 'success',
    })
    showMerge.value = false
    await load()
    await refreshDiff()
  } catch (e) {
    toast.add({ title: 'Could not merge', description: errorMessage(e), color: 'error' })
  } finally {
    merging.value = false
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

/**
 * The steps a turn took.
 *
 * A turn in flight has them streaming into the run store; one read back later
 * has them on its record. Same shape either way, so the template does not have
 * to care which it is looking at.
 */
function isLive(turn: SessionTurn) {
  return turn.id === activeRunId.value && Boolean(liveRun.value?.toolCalls.length)
}

function stepsFor(turn: SessionTurn): ToolCallLike[] {
  if (isLive(turn)) return liveRun.value?.toolCalls ?? []
  return turn.toolCalls ?? []
}

function describe(step: ToolCallLike) {
  return describeToolCall(step, session.value?.worktreePath)
}

function touched(turn: SessionTurn) {
  return filesTouched(stepsFor(turn), session.value?.worktreePath)
}

// A finished turn's steps are folded away — the prose is the point by then.
// A running turn's are the only thing worth watching, so they stay open.
const expandedTurns = ref<Set<string>>(new Set())

function showSteps(turn: SessionTurn) {
  return isLive(turn) || expandedTurns.value.has(turn.id)
}

function toggleSteps(id: string) {
  const next = new Set(expandedTurns.value)
  if (!next.delete(id)) next.add(id)
  expandedTurns.value = next
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
          @click="() => { showDiff = !showDiff }"
        />
        <UButton
          v-if="session?.worktree.changedFiles"
          label="Merge"
          icon="i-lucide-git-merge"
          size="sm"
          @click="openMerge"
        />
        <UButton
          label="Close session"
          size="sm"
          variant="ghost"
          color="neutral"
          @click="() => { showClose = true }"
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

          <!-- What it will not stop to ask about, and how to take that back -->
          <div v-if="projectRules.length" class="flex items-center gap-1.5 flex-wrap pl-6 pt-0.5">
            <span class="type-meta">Always allowed here</span>
            <span
              v-for="rule in projectRules"
              :key="rule"
              class="inline-flex items-center gap-1 text-[10px] px-1.5 py-px rounded-md group/rule"
              style="background: var(--badge-subtle-bg); color: var(--text-secondary);"
              :title="rule"
            >
              <UIcon name="i-lucide-shield-check" class="size-2.5 shrink-0" style="color: var(--success);" />
              {{ describeRule(rule) }}
              <button
                class="opacity-0 group-hover/rule:opacity-100 transition-opacity focus-ring rounded"
                style="color: var(--text-disabled);"
                :aria-label="`Stop allowing ${rule}`"
                @click="revokeRule(rule)"
              >
                <UIcon name="i-lucide-x" class="size-2.5" />
              </button>
            </span>
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
            @remember="onRemember(request.id, $event)"
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
            <!-- What it is doing, which is most of what there is to watch -->
            <div v-if="stepsFor(turn).length" class="space-y-1">
              <button
                v-if="!isLive(turn)"
                class="flex items-center gap-1.5 type-meta hover-bg rounded px-1.5 py-0.5 -ml-1.5 focus-ring"
                @click="toggleSteps(turn.id)"
              >
                <UIcon
                  :name="showSteps(turn) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  class="size-3"
                />
                {{ stepsFor(turn).length }} step{{ stepsFor(turn).length === 1 ? '' : 's' }}
              </button>

              <div v-if="showSteps(turn)" class="space-y-px">
                <div
                  v-for="(step, index) in stepsFor(turn)"
                  :key="step.id ?? index"
                  class="flex items-center gap-2 px-2 py-1 rounded type-mono-meta"
                  :style="{ background: index === stepsFor(turn).length - 1 && isLive(turn) ? 'var(--surface-raised)' : undefined }"
                >
                  <UIcon
                    v-if="isLive(turn) && index === stepsFor(turn).length - 1 && !step.result"
                    name="i-lucide-loader-2"
                    class="size-3 shrink-0 animate-spin"
                    style="color: var(--accent);"
                  />
                  <UIcon
                    v-else
                    :name="step.isError ? 'i-lucide-circle-alert' : describe(step).icon"
                    class="size-3 shrink-0"
                    :style="{ color: step.isError ? 'var(--error)' : 'var(--text-disabled)' }"
                  />
                  <span class="shrink-0" style="color: var(--text-secondary);">{{ describe(step).verb }}</span>
                  <!-- Falls back to what came back, for a tool whose arguments
                       we have no rule for — better than a bare verb -->
                  <span class="truncate" :style="{ color: describe(step).writes ? 'var(--accent)' : undefined }">
                    {{ describe(step).target || step.result }}
                  </span>
                </div>
              </div>

              <!-- The answer to "what is different now", without reading the diff -->
              <div v-if="touched(turn).length" class="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span class="type-meta">Changed</span>
                <span
                  v-for="file in touched(turn)"
                  :key="file"
                  class="type-mono-meta px-1.5 py-px rounded"
                  style="background: var(--accent-muted); color: var(--accent);"
                >
                  {{ file }}
                </span>
              </div>
            </div>

            <div
              v-if="turn.output"
              class="markdown type-body"
              v-html="renderMarkdown(turn.id === activeRunId && liveRun?.output ? liveRun.output : turn.output)"
            />
            <div v-else-if="turn.status === 'running'" class="flex items-center gap-2 type-meta">
              <UIcon name="i-lucide-loader-2" class="size-3 animate-spin" style="color: var(--accent);" />
              Working — you can close this tab and come back.
            </div>
            <!-- A stopped turn is not a failure, and its half-finished work is still real -->
            <div v-if="turn.status === 'cancelled'" class="flex items-center gap-2 type-meta">
              <UIcon name="i-lucide-square" class="size-3" />
              {{ turn.output ? 'Stopped part-way through.' : 'Stopped before it said anything.' }}
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
          <!-- While it is working, the useful button is the one that stops it -->
          <UButton
            v-if="isBusy"
            label="Stop"
            icon="i-lucide-square"
            size="sm"
            variant="soft"
            color="error"
            :loading="stopping"
            :disabled="!activeRunId"
            @click="onStop"
          />
          <UButton
            v-else
            label="Send"
            icon="i-lucide-arrow-up"
            size="sm"
            :loading="sending"
            :disabled="!input.trim() || !session.worktree.exists"
            @click="onSend"
          />
        </div>
      </template>

      <div v-else class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
      </div>
    </div>

    <!-- Merging writes to the real checkout, so show exactly what will happen -->
    <UModal v-model:open="showMerge">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay">
          <h3 class="text-page-title">Merge this session</h3>

          <div v-if="!mergePreview" class="flex items-center gap-2 type-detail">
            <UIcon name="i-lucide-loader-2" class="size-3.5 animate-spin" />
            Checking whether it merges cleanly…
          </div>

          <template v-else>
            <p class="type-body">
              Brings <strong>{{ mergePreview.commits }}</strong>
              commit{{ mergePreview.commits === 1 ? '' : 's' }} from
              <span class="font-mono type-detail" style="color: var(--accent);">{{ session?.branch }}</span>
              into <span class="font-mono type-detail">{{ mergePreview.targetBranch }}</span>.
            </p>

            <div
              v-if="mergePreview.blockedReason"
              class="rounded-md px-3 py-2.5 type-detail"
              style="background: rgba(248,113,113,0.06); color: var(--error);"
            >
              {{ mergePreview.blockedReason }}
            </div>

            <div v-if="mergePreview.conflicts.length" class="space-y-1">
              <div class="text-section-label">Conflicting files</div>
              <div
                v-for="path in mergePreview.conflicts"
                :key="path"
                class="font-mono type-detail px-2 py-1 rounded"
                style="background: var(--surface-raised);"
              >
                {{ path }}
              </div>
            </div>

            <!-- Uncommitted work is invisible to a merge unless swept up first -->
            <label
              v-if="mergePreview.uncommittedFiles.length"
              class="flex items-start gap-2.5 rounded-md px-3 py-2.5 cursor-pointer"
              style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
            >
              <input v-model="commitFirst" type="checkbox" class="size-3.5 mt-0.5 shrink-0" />
              <span class="type-detail">
                Commit the {{ mergePreview.uncommittedFiles.length }} uncommitted
                file{{ mergePreview.uncommittedFiles.length === 1 ? '' : 's' }} first
                <span class="block type-meta">
                  Without this they stay behind in the workspace and are not merged.
                </span>
              </span>
            </label>

            <div class="flex justify-end gap-2 pt-1">
              <UButton label="Cancel" size="sm" variant="ghost" color="neutral" @click="() => { showMerge = false }" />
              <UButton
                label="Merge"
                icon="i-lucide-git-merge"
                size="sm"
                :loading="merging"
                :disabled="!mergePreview.canMerge"
                @click="onMerge"
              />
            </div>
          </template>
        </div>
      </template>
    </UModal>

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
            <UButton label="Cancel" size="sm" variant="ghost" color="neutral" @click="() => { showClose = false }" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

