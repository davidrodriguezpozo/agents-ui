<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { isSendKey } from '~/utils/keys'
import { renderMarkdown } from '~/utils/markdown'
import { describeToolCall, filesTouched, type ToolCallLike } from '~/utils/toolCalls'
import { formatReview, parsePatch, type PatchLine, type ReviewComment } from '~/utils/patch'
import { TRUST_CHOICES, type TrustLevel } from '~/composables/useSessions'
import type {
  DiffFile, MergePreview, PullRequestPreview, Session, SessionTurn, TranscriptMessage,
} from '~/composables/useSessions'

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const {
  fetchOne, send, fetchTranscript, setTrust, fetchDiff,
  previewPullRequest, openPullRequest, previewMerge, merge, runCheck, repair, close,
} = useSessions()
const { live, attach, cancelRun, promptsFor, isAnsweringPermission, answerPermission } = useRuns()
const { rules: projectRules, load: loadProjectRules, allowRule, revokeRule } = useProjectRules(() => session.value?.repoDir)
const { describeRule } = usePermissionRuleLabels()
const { commands, fetchAll: fetchCommands } = useCommands()
const toast = useToast()

const session = ref<(Session & {
  turns: SessionTurn[]
  checkStale: boolean
  checkCommand: string | null
}) | null>(null)
const checking = ref(false)
const repairing = ref(false)
const showCheckOutput = ref(false)
const loadError = ref<string | null>(null)
const input = ref('')
const sending = ref(false)
const stopping = ref(false)
const activeRunId = ref<string | null>(null)
const diff = ref<{ files: DiffFile[]; patch: string } | null>(null)
const showDiff = ref(false)
/** The terminal conversation this session continues, if it adopted one. */
const inherited = ref<TranscriptMessage[]>([])
const showPatch = ref(false)
const showClose = ref(false)
const closing = ref(false)
const showMerge = ref(false)
const mergePreview = ref<MergePreview | null>(null)
const merging = ref(false)
const commitFirst = ref(true)
const showPr = ref(false)
const prPreview = ref<PullRequestPreview | null>(null)
const prTitle = ref('')
const prBody = ref('')
const prCommitFirst = ref(true)
const prDraft = ref(false)
const opening = ref(false)
let controller: AbortController | null = null

/**
 * Set the moment this page goes away.
 *
 * The stream's `finally` runs *after* the abort that unmounting causes, and
 * what it did there was reload the session — which re-attached to the run, on
 * a controller nothing would ever abort, because the thing that aborts them
 * had already run. One permanently open connection per visit.
 *
 * A browser allows six concurrent connections to an origin. So the seventh
 * session you opened took the app down: every request after it queued behind a
 * stream that never ends, the dashboard's counts came back as zeros, and it
 * looked for all the world like the browser had started blocking requests.
 */
let gone = false

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
  if (gone) return

  activeRunId.value = runId
  controller?.abort()

  // Held locally as well as on `controller`, so the stream that ends can tell
  // whether it is still the one this page is watching.
  const own = new AbortController()
  controller = own

  attach(runId, own.signal)
    .catch(() => {})
    .finally(async () => {
      // Gone, or superseded by a later attach. Either way this stream's ending
      // is not news, and reloading on the back of it is what leaked.
      if (gone || controller !== own) return
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

/**
 * An adopted conversation resumes believing it is still in the checkout it
 * started in, with its edits in place. It is not: this is a clean worktree cut
 * from the base branch. Nothing but the first message can correct that, so one
 * is written for you — editable, and deletable if you would rather not.
 */
function suggestedOpener(): string {
  const path = session.value?.worktreePath ?? 'a new workspace'
  return `Before anything else: we have moved. You are now in a fresh checkout of this repository at ${path}, `
    + `on a new branch cut from ${session.value?.baseBranch ?? 'the base branch'}. `
    + `Any edits you made earlier are not here — read the files again before changing them. `
    + `Then carry on from where we left off.`
}

onMounted(async () => {
  await load()
  await refreshDiff()
  await loadProjectRules()

  if (session.value?.adoptedAt && !session.value.turns.length && !input.value) {
    input.value = suggestedOpener()
  }

  // Adopted sessions have history but no runs — it lives in Claude Code's
  // transcript, and without this the page opens blank.
  if (session.value?.adoptedAt) {
    inherited.value = await fetchTranscript(id).catch(() => [])
  }

  await fetchCommands()
})

onUnmounted(() => {
  gone = true
  controller?.abort()
})

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

/**
 * Opening a pull request pushes the branch, which is the first moment this
 * work leaves your machine — so the preview is fetched and shown before
 * anything is sent, and the title and body are yours to change.
 */
async function openPrDialog() {
  showPr.value = true
  prPreview.value = null
  try {
    const preview = await previewPullRequest(id)
    prPreview.value = preview
    prTitle.value = preview.suggestedTitle
    prBody.value = preview.suggestedBody
    prCommitFirst.value = preview.uncommittedFiles.length > 0
  } catch (e) {
    toast.add({ title: 'Could not check', description: errorMessage(e), color: 'error' })
    showPr.value = false
  }
}

async function onOpenPr() {
  if (!prTitle.value.trim()) return

  opening.value = true
  try {
    const result = await openPullRequest(id, {
      title: prTitle.value.trim(),
      body: prBody.value,
      commitFirst: prCommitFirst.value,
      draft: prDraft.value,
    })
    toast.add({
      title: prDraft.value ? 'Draft pull request opened' : 'Pull request opened',
      description: result.url,
      color: 'success',
    })
    showPr.value = false
    await load()
  } catch (e) {
    toast.add({ title: 'Could not open it', description: errorMessage(e), color: 'error' })
  } finally {
    opening.value = false
  }
}

/**
 * Run the checks now.
 *
 * Slow by nature — a real suite is minutes, and the button stays in its
 * loading state throughout rather than pretending to be done. The merge
 * preview is refreshed too when it is open, since the verdict it was showing
 * is exactly what just changed.
 */
/**
 * The checks, said in a sentence.
 *
 * Every state here has to read to someone who will not open the output: what
 * the answer is, and what it is an answer about. "Errored" gets its own
 * wording rather than borrowing failure's, because a suite that could not run
 * says nothing at all about the code.
 */
interface CheckPanel {
  title: string
  detail: string
  icon: string
  color: string
  frame: string
  spin?: boolean
}

const checkPanel = computed<CheckPanel>(() => {
  const check = session.value?.check
  const command = check?.command ?? session.value?.checkCommand ?? ''
  const took = formatDuration(check?.durationMs)
  const ran = check
    ? [command, relativeTime(check.at), took ? `took ${took}` : null].filter(Boolean).join(' · ')
    : command

  if (!check) {
    return {
      title: 'Not checked yet',
      detail: `${command} has not run in this workspace.`,
      icon: 'i-lucide-circle-dashed',
      color: 'var(--text-secondary)',
      frame: 'background: var(--surface-raised); border: 1px solid var(--border-subtle);',
    }
  }

  if (check.status === 'running') {
    return {
      title: 'Checking…',
      detail: `Running ${command} in this workspace.`,
      icon: 'i-lucide-loader-2',
      color: 'var(--accent)',
      spin: true,
      frame: 'background: var(--accent-muted); border: 1px solid var(--accent-glow);',
    }
  }

  if (check.status === 'failing') {
    return {
      title: session.value?.checkStale ? 'Failed, before the latest change' : 'This does not work yet',
      detail: ran,
      icon: 'i-lucide-circle-x',
      color: 'var(--error)',
      frame: 'background: rgba(248,113,113,0.06); border: 1px solid var(--error);',
    }
  }

  if (check.status === 'errored') {
    return {
      title: 'The checks could not run',
      detail: `${ran} — so there is no verdict either way.`,
      icon: 'i-lucide-circle-help',
      color: 'var(--warning)',
      frame: 'background: rgba(212,153,34,0.06); border: 1px solid var(--warning);',
    }
  }

  return {
    title: session.value?.checkStale ? 'Passed, before the latest change' : 'This works',
    detail: ran,
    icon: 'i-lucide-check-check',
    color: session.value?.checkStale ? 'var(--warning)' : 'var(--success)',
    frame: session.value?.checkStale
      ? 'background: rgba(212,153,34,0.06); border: 1px solid var(--warning);'
      : 'background: rgba(34,197,94,0.06); border: 1px solid var(--success);',
  }
})

/**
 * What the session is doing about its own failing checks, if anything.
 *
 * Only shown while it means something: a streak that ended in success is
 * already said by the green panel above it, and repeating it there would be
 * two sentences competing to tell you the same thing.
 */
const repairNote = computed(() => {
  const state = session.value?.repair
  if (!state) return null

  if (state.state === 'running') {
    return {
      text: `Fixing it — attempt ${state.attempts} of ${state.max}.`,
      icon: 'i-lucide-wrench',
      spin: false,
      color: 'var(--accent)',
    }
  }

  if (state.state === 'gave-up') {
    return {
      text: state.reason || `Gave up after ${state.attempts} of ${state.max} attempts.`,
      icon: 'i-lucide-hand',
      spin: false,
      color: 'var(--warning)',
    }
  }

  return null
})

async function onRepair() {
  repairing.value = true
  try {
    const runId = await repair(id)
    await load()
    // Through `watchRun`, so it gets a controller and is closed with the page.
    // A bare `attach` here would leak the connection exactly as above.
    watchRun(runId)
  } catch (e) {
    toast.add({ title: 'Could not start fixing it', description: errorMessage(e), color: 'error' })
  } finally {
    repairing.value = false
  }
}

async function onRunCheck() {
  checking.value = true
  try {
    const check = await runCheck(id)
    await load()
    if (showMerge.value) mergePreview.value = await previewMerge(id)

    if (check?.status === 'errored') {
      toast.add({
        title: 'The checks could not run',
        description: 'Nothing is wrong with the code as far as this can tell — see the output.',
        color: 'warning',
      })
      showCheckOutput.value = true
    }
  } catch (e) {
    toast.add({ title: 'Could not run the checks', description: errorMessage(e), color: 'error' })
  } finally {
    checking.value = false
  }
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

/**
 * Merge, optionally over a failing check.
 *
 * The override is passed only when the dialog actually offered it, so a stale
 * preview can never quietly widen into permission to ignore something else.
 */
async function onMerge(override = false) {
  merging.value = true
  try {
    const result = await merge(id, { commitFirst: commitFirst.value, override })
    toast.add({
      title: `Merged into ${mergePreview.value?.targetBranch}`,
      description: result.overrodeChecks
        ? `${result.commitsBrought} commit${result.commitsBrought === 1 ? '' : 's'} brought across, with the checks failing. The merge commit says so.`
        : `${result.commitsBrought} commit${result.commitsBrought === 1 ? '' : 's'} brought across.`,
      color: result.overrodeChecks ? 'warning' : 'success',
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

/**
 * Reviewing.
 *
 * Comments are gathered rather than sent one at a time: each turn is a whole
 * agent run, and three remarks about one change are a single piece of
 * feedback. Sending them separately invites three uncoordinated rewrites.
 */
const patchLines = computed<PatchLine[]>(() => parsePatch(diff.value?.patch ?? ''))
const comments = ref<ReviewComment[]>([])
const commentingOn = ref<number | null>(null)
const commentDraft = ref('')

function lineColour(line: PatchLine) {
  if (line.kind === 'add') return 'var(--success)'
  if (line.kind === 'remove') return 'var(--error)'
  if (line.kind === 'hunk') return 'var(--accent)'
  return 'var(--text-tertiary)'
}

function startComment(line: PatchLine) {
  commentingOn.value = patchLines.value.indexOf(line)
  commentDraft.value = ''
}

function cancelComment() {
  commentingOn.value = null
  commentDraft.value = ''
}

function addComment(line: PatchLine) {
  const body = commentDraft.value.trim()
  if (!body || !line.file) return

  comments.value = [...comments.value, {
    file: line.file,
    line: line.line ?? 0,
    // The line travels with the note, so it survives the file moving under it.
    snippet: line.text,
    body,
  }]
  cancelComment()
}

function dropComment(index: number) {
  comments.value = comments.value.filter((_, i) => i !== index)
}

/** Hand the whole review over as one turn. */
async function sendReview() {
  if (!comments.value.length || isBusy.value) return

  const message = formatReview(comments.value)
  sending.value = true
  try {
    const runId = await send(id, message)
    comments.value = []
    showPatch.value = false
    await load()
    watchRun(runId)
  } catch (e) {
    toast.add({ title: 'Could not send the review', description: errorMessage(e), color: 'error' })
  } finally {
    sending.value = false
  }
}

/**
 * How much this session may do without asking.
 *
 * Applied to the next turn, not the one running: the SDK is told once when a
 * run starts, and changing the rules underneath a run in flight would be worse
 * than waiting for it to finish.
 */
const trust = computed<TrustLevel>(() => session.value?.trust ?? 'edits')

async function onTrust(level: TrustLevel) {
  if (level === trust.value) return

  const previous = session.value?.trust
  if (session.value) session.value.trust = level

  try {
    await setTrust(id, level)
  } catch (e) {
    if (session.value) session.value.trust = previous
    toast.add({ title: 'Could not change that', description: errorMessage(e), color: 'error' })
  }
}

/**
 * The command list.
 *
 * Opens when what you have typed is a bare slash-word, which is the moment you
 * are trying to remember a name, and on demand from the button beside the box
 * for when you do not know one exists.
 */
const paletteOpen = ref(false)
const palette = ref<{ move: (d: number) => void; choose: () => void; hasMatches: boolean } | null>(null)

const commandQuery = computed(() => {
  const match = input.value.match(/^\/(\S*)$/)
  return match ? match[1] ?? '' : ''
})

watch(input, () => {
  // Typing past the command itself means you are writing a message now.
  if (input.value.startsWith('/') && !input.value.includes(' ')) paletteOpen.value = true
  else if (!input.value.startsWith('/')) paletteOpen.value = false
})

function insertCommand(invocation: string) {
  input.value = `${invocation} `
  paletteOpen.value = false
}

/** The composer owns the keys while the list is open, so it can drive it. */
function onComposerKey(event: KeyboardEvent) {
  // While the command palette is open it owns the keys that drive it. Enter
  // there means "pick the highlighted command", which has to win over sending
  // — otherwise choosing a command would fire off a half-typed message.
  if (paletteOpen.value) {
    if (event.key === 'ArrowDown') { event.preventDefault(); palette.value?.move(1); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); palette.value?.move(-1); return }
    if (event.key === 'Escape') { event.preventDefault(); paletteOpen.value = false; return }
    if (event.key === 'Enter' && !event.metaKey && palette.value?.hasMatches) {
      event.preventDefault()
      palette.value.choose()
      return
    }
  }

  if (!isSendKey(event)) return

  event.preventDefault()
  onSend()
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
          v-if="session?.prUrl"
          label="View pull request"
          icon="i-lucide-git-pull-request"
          size="sm"
          variant="soft"
          color="neutral"
          :to="session.prUrl"
          target="_blank"
        />
        <UButton
          v-else-if="session?.worktree.changedFiles || session?.worktree.ahead"
          label="Pull request"
          icon="i-lucide-git-pull-request"
          size="sm"
          variant="soft"
          color="neutral"
          @click="openPrDialog"
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

        <!--
          Whether it works, above what changed. The diff answers "what did it
          do"; this answers the question most people were actually asking, and
          is the only one someone who cannot read a diff can act on.
        -->
        <div
          v-if="session.checkCommand && (session.worktree.changedFiles || session.check)"
          class="rounded-md px-4 py-3 space-y-2"
          :style="checkPanel.frame"
        >
          <div class="flex items-center gap-2">
            <UIcon
              :name="checkPanel.icon"
              class="size-4 shrink-0"
              :class="{ 'animate-spin': checkPanel.spin }"
              :style="{ color: checkPanel.color }"
            />
            <div class="flex-1 min-w-0">
              <div class="type-strong" :style="{ color: checkPanel.color }">{{ checkPanel.title }}</div>
              <div class="type-meta truncate">{{ checkPanel.detail }}</div>
            </div>

            <UButton
              v-if="session.check?.output"
              :label="showCheckOutput ? 'Hide output' : 'Output'"
              size="xs"
              variant="ghost"
              color="neutral"
              @click="() => { showCheckOutput = !showCheckOutput }"
            />
            <!--
              The whole point of knowing it is broken. The thing that wrote the
              code is still here and the failure is right there, so offer the
              obvious next move rather than leaving it as homework.
            -->
            <UButton
              v-if="session.check?.status === 'failing'"
              label="Fix it"
              icon="i-lucide-wrench"
              size="xs"
              variant="soft"
              :loading="repairing"
              :disabled="isBusy || checking"
              @click="onRepair"
            />
            <UButton
              :label="session.check ? 'Run again' : 'Run checks'"
              icon="i-lucide-play"
              size="xs"
              variant="soft"
              color="neutral"
              :loading="checking || session.check?.status === 'running'"
              :disabled="isBusy"
              @click="onRunCheck"
            />
          </div>

          <div v-if="repairNote" class="flex items-center gap-2 pt-0.5">
            <UIcon
              :name="repairNote.icon"
              class="size-3.5 shrink-0"
              :class="{ 'animate-spin': repairNote.spin }"
              :style="{ color: repairNote.color }"
            />
            <span class="type-meta">{{ repairNote.text }}</span>
          </div>

          <pre
            v-if="showCheckOutput && session.check?.output"
            class="font-mono text-[10px] leading-relaxed overflow-x-auto max-h-64 p-2.5 rounded"
            style="background: var(--surface-inset); color: var(--text-secondary);"
          >{{ session.check.output }}</pre>
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
            <div
              v-if="showPatch"
              class="px-4 py-3 overflow-x-auto font-mono text-[11px] leading-[1.6] diff-patch"
              style="background: var(--surface-inset); border-top: 1px solid var(--border-subtle);"
            >
              <template v-for="(line, i) in patchLines" :key="i">
                <!-- Any line that belongs to a file can be pointed at -->
                <div
                  class="group/line flex items-start gap-2 -mx-1 px-1 rounded"
                  :class="line.file ? 'hover-bg cursor-text' : ''"
                  :style="{ color: lineColour(line) }"
                  @click="line.file && startComment(line)"
                >
                  <UIcon
                    v-if="line.file"
                    name="i-lucide-message-square-plus"
                    class="size-3 shrink-0 mt-0.5 opacity-0 group-hover/line:opacity-100 transition-opacity"
                    style="color: var(--accent);"
                  />
                  <span v-else class="size-3 shrink-0" />
                  <span class="whitespace-pre flex-1">{{ line.text || ' ' }}</span>
                </div>

                <!-- Where the note is written, in place, next to what it is about -->
                <div v-if="commentingOn === i" class="my-1.5 ml-5 space-y-1.5">
                  <textarea
                    ref="commentBox"
                    v-model="commentDraft"
                    rows="2"
                    class="field-textarea w-full"
                    placeholder="What should change about this line?"
                    @keydown="e => { if (isSendKey(e)) { e.preventDefault(); addComment(line) } }"
                    @keydown.esc="cancelComment"
                  />
                  <div class="flex items-center gap-2">
                    <UButton label="Add comment" size="xs" :disabled="!commentDraft.trim()" @click="addComment(line)" />
                    <UButton label="Cancel" size="xs" variant="ghost" color="neutral" @click="cancelComment" />
                    <span class="type-meta">↵ to add · ⇧↵ for a new line</span>
                  </div>
                </div>
              </template>
            </div>
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

        <!-- What was said in the terminal, before this session existed -->
        <div v-if="inherited.length" class="space-y-3">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-terminal" class="size-3.5 shrink-0" style="color: var(--text-disabled);" />
            <span class="text-section-label">From your terminal</span>
            <span class="type-meta">
              {{ inherited.length }} message{{ inherited.length === 1 ? '' : 's' }} — history, already said
            </span>
          </div>

          <div class="space-y-3 pl-3" style="border-left: 2px solid var(--border-subtle);">
            <div v-for="(message, index) in inherited" :key="index">
              <div v-if="message.role === 'user'" class="flex justify-end">
                <div
                  class="rounded-md px-3.5 py-2 max-w-[80%] type-body"
                  style="background: var(--badge-subtle-bg); color: var(--text-secondary);"
                >
                  {{ message.text }}
                </div>
              </div>
              <div
                v-else
                class="markdown type-body"
                style="color: var(--text-secondary);"
                v-html="renderMarkdown(message.text)"
              />
            </div>
          </div>

          <div class="type-meta pl-3">
            Anything from here on happens in this workspace.
          </div>
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
          v-else-if="!inherited.length"
          variant="inset"
          icon="i-lucide-message-square"
          title="Nothing yet"
          description="Tell Claude what to do in this workspace. It can change files freely — they're isolated from your project until you decide to keep them."
        />

        <!-- What you have written so far, and the one action that uses it -->
        <div
          v-if="comments.length"
          class="rounded-md px-4 py-3 space-y-2"
          style="background: var(--surface-raised); border: 1px solid var(--accent-glow);"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="type-strong text-body">
              {{ comments.length }} comment{{ comments.length === 1 ? '' : 's' }} to send
            </span>
            <div class="flex items-center gap-2">
              <UButton
                label="Discard"
                size="xs"
                variant="ghost"
                color="neutral"
                @click="() => { comments = [] }"
              />
              <UButton
                label="Send as the next turn"
                icon="i-lucide-message-square-reply"
                size="xs"
                :loading="sending"
                :disabled="isBusy"
                @click="sendReview"
              />
            </div>
          </div>
          <div
            v-for="(comment, index) in comments"
            :key="index"
            class="flex items-start gap-2 group/comment"
          >
            <span class="type-mono-meta shrink-0" style="color: var(--accent);">
              {{ comment.file }}:{{ comment.line }}
            </span>
            <span class="type-detail flex-1 min-w-0">{{ comment.body }}</span>
            <button
              class="opacity-0 group-hover/comment:opacity-100 transition-opacity focus-ring rounded shrink-0"
              style="color: var(--text-disabled);"
              aria-label="Remove this comment"
              @click="dropComment(index)"
            >
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </div>
        </div>

        <!-- How much it may do on its own, next to the box that sets it going -->
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="pill-picker">
            <button
              v-for="choice in TRUST_CHOICES"
              :key="choice.value"
              type="button"
              class="pill-picker__option"
              :class="{ 'pill-picker__option--active': trust === choice.value }"
              :title="choice.hint"
              @click="onTrust(choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>
          <span
            v-if="trust === 'full'"
            class="type-detail flex items-center gap-1.5"
            style="color: var(--accent);"
          >
            <UIcon name="i-lucide-zap" class="size-3.5 shrink-0" />
            It will run commands without asking, in this workspace only.
          </span>
          <span v-else-if="trust === 'readonly'" class="type-meta">
            It will propose changes rather than make them.
          </span>
        </div>

        <!-- Composer -->
        <div class="flex gap-2 relative">
          <!-- Sits above the box, where what you are typing still shows -->
          <div v-if="paletteOpen" class="absolute bottom-full left-0 right-0 mb-2 z-10">
            <CommandPalette
              ref="palette"
              :commands="commands"
              :query="commandQuery"
              @select="insertCommand"
              @close="() => { paletteOpen = false }"
            />
          </div>

          <textarea
            v-model="input"
            rows="2"
            class="field-textarea flex-1"
            :placeholder="isBusy ? 'Working…' : 'What should it do next? Type / for commands'"
            :disabled="isBusy || !session.worktree.exists"
            @keydown="onComposerKey"
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
          <UButton
            icon="i-lucide-slash"
            size="sm"
            variant="ghost"
            color="neutral"
            :title="`${commands.length} commands available`"
            aria-label="Show commands"
            :disabled="isBusy"
            @click="() => { paletteOpen = !paletteOpen }"
          />
        </div>

        <!-- Said out loud, because the shortcut changed and muscle memory has not -->
        <p v-if="!isBusy" class="type-meta pt-1.5">↵ Send · ⇧↵ New line</p>
      </template>

      <div v-else class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
      </div>
    </div>

    <!-- Pushing is the moment this leaves your machine, so spell it out -->
    <UModal v-model:open="showPr">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay">
          <h3 class="text-page-title">Open a pull request</h3>

          <div v-if="!prPreview" class="flex items-center gap-2 type-detail">
            <UIcon name="i-lucide-loader-2" class="size-3.5 animate-spin" />
            Checking the branch…
          </div>

          <template v-else>
            <div
              v-if="prPreview.existingUrl"
              class="rounded-md px-3 py-2.5 type-detail space-y-1"
              style="background: var(--accent-muted); color: var(--text-secondary);"
            >
              <div>This branch already has one open.</div>
              <a :href="prPreview.existingUrl" target="_blank" class="font-mono" style="color: var(--accent);">
                {{ prPreview.existingUrl }}
              </a>
            </div>

            <div
              v-if="prPreview.blockedReason"
              class="rounded-md px-3 py-2.5 type-detail"
              style="background: rgba(248,113,113,0.06); color: var(--error);"
            >
              {{ prPreview.blockedReason }}
            </div>

            <template v-else>
              <p class="type-body">
                Pushes <span class="font-mono type-detail" style="color: var(--accent);">{{ prPreview.branch }}</span>
                to <span class="font-mono type-detail">{{ prPreview.remote }}</span> and opens a request into
                <span class="font-mono type-detail">{{ prPreview.baseBranch }}</span> —
                {{ prPreview.commits.length }} commit{{ prPreview.commits.length === 1 ? '' : 's' }}.
                This is the point at which other people can see it.
              </p>

              <div class="space-y-1.5">
                <label class="field-label">Title</label>
                <input v-model="prTitle" class="field-input w-full" placeholder="What this changes" />
              </div>

              <div class="space-y-1.5">
                <label class="field-label">Description</label>
                <textarea v-model="prBody" rows="7" class="field-textarea w-full font-mono text-[11px]" />
              </div>

              <label
                v-if="prPreview.uncommittedFiles.length"
                class="flex items-start gap-2.5 rounded-md px-3 py-2.5 cursor-pointer"
                style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
              >
                <input v-model="prCommitFirst" type="checkbox" class="size-3.5 mt-0.5 shrink-0" />
                <span class="type-detail">
                  Commit the {{ prPreview.uncommittedFiles.length }} uncommitted
                  file{{ prPreview.uncommittedFiles.length === 1 ? '' : 's' }} first
                  <span class="block type-meta">
                    Without this they stay on your machine and are not part of the request.
                  </span>
                </span>
              </label>

              <label class="flex items-center gap-2.5 cursor-pointer">
                <input v-model="prDraft" type="checkbox" class="size-3.5 shrink-0" />
                <span class="type-detail">Open it as a draft</span>
              </label>
            </template>

            <div class="flex justify-end gap-2 pt-1">
              <UButton label="Cancel" size="sm" variant="ghost" color="neutral" @click="() => { showPr = false }" />
              <UButton
                label="Push and open"
                icon="i-lucide-git-pull-request"
                size="sm"
                :loading="opening"
                :disabled="!prPreview.canOpen || !prTitle.trim()"
                @click="onOpenPr"
              />
            </div>
          </template>
        </div>
      </template>
    </UModal>

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

            <!-- What the checks said, next to the decision they inform -->
            <div
              v-if="mergePreview.check"
              class="rounded-md px-3 py-2.5 space-y-2"
              style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
            >
              <div class="flex items-center gap-2">
                <UIcon
                  :name="mergePreview.check.status === 'passing' ? 'i-lucide-check-check' : 'i-lucide-circle-x'"
                  class="size-3.5 shrink-0"
                  :style="{ color: mergePreview.check.status === 'passing' ? 'var(--success)' : 'var(--error)' }"
                />
                <span class="font-mono type-detail">{{ mergePreview.check.command }}</span>
                <UButton
                  label="Run again"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  class="ml-auto"
                  :loading="checking"
                  @click="onRunCheck"
                />
              </div>
              <p v-if="mergePreview.checkStale" class="type-meta">
                This was the answer before the workspace changed. Run it again to know where it stands.
              </p>
              <pre
                v-if="mergePreview.check.status === 'failing' && mergePreview.check.output"
                class="font-mono text-[10px] leading-relaxed overflow-x-auto max-h-40 p-2 rounded"
                style="background: var(--surface-inset); color: var(--text-secondary);"
              >{{ mergePreview.check.output }}</pre>
            </div>

            <div class="flex justify-end gap-2 pt-1">
              <UButton label="Cancel" size="sm" variant="ghost" color="neutral" @click="() => { showMerge = false }" />
              <!--
                Offered only when the checks are the sole objection. Labelled
                for what it is, so nobody clicks it thinking it is the merge
                button that was there a moment ago.
              -->
              <UButton
                v-if="mergePreview.blockedByChecks && mergePreview.check?.status === 'failing'"
                label="Merge anyway"
                icon="i-lucide-triangle-alert"
                size="sm"
                color="warning"
                variant="soft"
                :loading="merging"
                @click="onMerge(true)"
              />
              <UButton
                v-else
                label="Merge"
                icon="i-lucide-git-merge"
                size="sm"
                :loading="merging"
                :disabled="!mergePreview.canMerge"
                @click="onMerge(false)"
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

