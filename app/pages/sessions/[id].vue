<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { driftNote } from '~/utils/checkout'
import { isSendKey } from '~/utils/keys'
import { renderMarkdown } from '~/utils/markdown'
import { describeToolCall, filesTouched, type ToolCallLike } from '~/utils/toolCalls'
import { composeNotes, parsePatch, type DiffNote, type PatchLine } from '~/utils/patch'
import { DEFAULT_TRUST, TRUST_CHOICES, type TrustLevel } from '~/composables/useSessions'
import type {
  BranchPullRequest, DiffFile, MergePreview, PullRequestPreview, QueuedMessage, Session,
  SessionTurn, TranscriptMessage,
} from '~/composables/useSessions'

/**
 * The rail beside it, so leaving this session for the next one is a click rather
 * than a trip out to a list and back. See `layouts/work.vue`.
 */
definePageMeta({ layout: 'work' })

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const {
  fetchOne, send, steer, sendQueued, dropQueued, fetchTranscript, setTrust, fetchDiff,
  fetchNotes, addNote, dropNotes,
  previewPullRequest, openPullRequest, watchPullRequest, previewMerge, merge, runCheck, repair,
  updateFromBase, close, setAside,
} = useSessions()
const { live, attach, cancelRun, promptsFor, isAnsweringPermission, answerPermission } = useRuns()
const {
  rules: projectRules, deadReason, deadReasons,
  load: loadProjectRules, allowRule, revokeRule,
} = useProjectRules(() => session.value?.repoDir)
const { describeRule } = usePermissionRuleLabels()
const { commands, fetchAll: fetchCommands } = useCommands()
const toast = useToast()

const session = ref<(Session & {
  turns: SessionTurn[]
  checkStale: boolean
  checkCommand: string | null
  pr: BranchPullRequest | null
}) | null>(null)
const checking = ref(false)
const repairing = ref(false)
const showCheckOutput = ref(false)
const loadError = ref<string | null>(null)
const input = ref('')
const sending = ref(false)
const steering = ref(false)
const stopping = ref(false)
const activeRunId = ref<string | null>(null)
const diff = ref<{ files: DiffFile[]; patch: string } | null>(null)
/**
 * Which workspace tool is on screen.
 *
 * Four independent toggles meant four panels stacking down the page, each about
 * five hundred pixels tall — so opening two put one of them below the fold and
 * turned "look at the diff while the preview runs" into scrolling past the
 * thing you were trying to compare it with.
 *
 * One at a time instead, chosen from a strip. `null` is all of them closed,
 * which is what a session opens as.
 */
type Pane = 'changes' | 'files' | 'preview' | 'terminal' | 'review'

const pane = ref<Pane | null>(null)

/**
 * Panes that have been opened at least once stay mounted and are merely
 * hidden. Unmounting would drop the terminal's connection and reload the
 * preview's iframe every time somebody glanced at the diff — the shell would
 * survive on the server, but a dev server reloading on every tab change would
 * not be worth the memory it saved.
 */
const opened = ref<Set<Pane>>(new Set())

function showPane(next: Pane) {
  // Clicking the one already showing closes it, so the strip doubles as the
  // way back to just the conversation.
  pane.value = pane.value === next ? null : next
  if (pane.value) opened.value.add(pane.value)
}

/**
 * How wide the conversation is when a pane is open, as a percentage.
 *
 * The pane used to open *inside* the conversation's scroll column, above the
 * transcript — so clicking "Files" from the bottom of a long session moved the
 * page by nothing visible and put the editor about nine hundred pixels above
 * where you were looking. It reads as a dead button.
 *
 * Side by side instead, each half with its own scroll, which is also what makes
 * "watch the preview while you read the diff" possible at all.
 */
const conversationWidth = ref(52)
const MIN_WIDTH = 28
const MAX_WIDTH = 72

const dragging = ref(false)

function startDrag() {
  dragging.value = true
}

function onDrag(e: MouseEvent) {
  if (!dragging.value) return
  // Measured against the split's own box, not the window, so the sidebar and
  // any future left-hand chrome do not offset every drag.
  const host = document.getElementById('session-split')
  if (!host) return
  const { left, width } = host.getBoundingClientRect()
  if (!width) return
  const pct = ((e.clientX - left) / width) * 100
  conversationWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, pct))
}

function endDrag() {
  dragging.value = false
}

/** Keyboard equivalent, so the divider is not mouse-only. */
function nudgeDivider(delta: number) {
  conversationWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, conversationWidth.value + delta))
}

if (import.meta.client) {
  onMounted(() => {
    window.addEventListener('mousemove', onDrag)
    window.addEventListener('mouseup', endDrag)
  })
  onUnmounted(() => {
    window.removeEventListener('mousemove', onDrag)
    window.removeEventListener('mouseup', endDrag)
  })
}
/** The terminal conversation this session continues, if it adopted one. */
const inherited = ref<TranscriptMessage[]>([])
const showPatch = ref(false)
const showClose = ref(false)
const closing = ref(false)
const filing = ref(false)
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

/**
 * What you typed while it was working, still waiting.
 *
 * Read off the session rather than kept here: the queue belongs to the session
 * on the server, because the turn it is waiting for outlasts this tab. So it
 * survives a reload, and it is the same list whichever window you look from.
 */
const queued = computed<QueuedMessage[]>(() => session.value?.queued ?? [])
const dropping = ref<string | null>(null)

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
      // Only a turn that finished releases what was queued behind it — one you
      // stopped, or one that failed, leaves it standing on purpose. So there is
      // nothing to wait for, and the page says so instead.
      if (live.value[runId]?.status === 'completed') await awaitQueuedTurn()
      await refreshDiff()
    })
}

/**
 * Wait for the message queued behind the turn that just ended to become a turn.
 *
 * The server drains the queue in the same breath as ending the turn, and this
 * page learns the turn ended by its stream closing — the two happen at once, so
 * a single reload lands on either side of the coin. Half the time that left a
 * queued message looking ignored until somebody reloaded the page by hand.
 *
 * Bounded, and over the moment the session is running again: `load` attaches to
 * the new run on its own.
 */
async function awaitQueuedTurn() {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (gone || !session.value?.queued?.length) return
    if (session.value.status === 'running') return

    await new Promise(resolve => setTimeout(resolve, 400))
    if (gone) return
    await load()
  }
}

async function refreshDiff() {
  try {
    diff.value = await fetchDiff(id)
    // If there is work to review and nothing to read, the diff is the point.
    // Work to review and nothing to read: the diff is the point, so open on it.
    if (diff.value.files.length && !session.value?.turns.length) showPane('changes')
  } catch {
    diff.value = null
  }
}

/**
 * A hand edit changes the same things a turn does: what the diff shows, how far
 * the branch is ahead, and whether the recorded check verdict still describes
 * the code — the fingerprint has moved, so it does not.
 *
 * Refreshed together rather than leaving the page reporting a passing check
 * over a file that has just been changed underneath it.
 */
async function onWorkspaceEdited() {
  await refreshDiff()
  try {
    session.value = await fetchOne(id)
  } catch {
    // The diff is the part that mattered; a stale header is not worth an error.
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

  // Notes written before the tab was closed. Failing to read them is not worth
  // an error on the way in — the diff is still there to write new ones on.
  notes.value = await fetchNotes(id).catch(() => [])

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

/**
 * Say the thing, whether or not it is listening yet.
 *
 * The composer used to be disabled for the whole of a turn, which is exactly
 * when you have something to add — and a turn can run for ten minutes. Now it
 * is always live, and a session that is busy keeps the message and sends it
 * when the turn ends. Which of the two happened is the server's answer, not a
 * guess made here: see `sendOrQueue`.
 */
async function onSend() {
  const value = input.value.trim()
  if (!value || sending.value) return

  sending.value = true
  try {
    const result = await send(id, value)
    input.value = ''
    await load()
    if (result.runId) watchRun(result.runId)
  } catch (e) {
    toast.add({ title: 'Could not send', description: errorMessage(e), color: 'error' })
  } finally {
    sending.value = false
  }
}

/**
 * Say it into the turn that is running, rather than after it.
 *
 * The deliberate one, which is why it is a button of its own and not what Enter
 * does: queueing is right for the next instruction, and this is for a turn going
 * the wrong way, where waiting means paying for the rest of a wrong answer.
 *
 * Afterwards the page says which of the three things happened, because the turn
 * can end between the press and the delivery and "steered" would then be a lie.
 */
async function onSteer() {
  const value = input.value.trim()
  if (!value || steering.value || sending.value) return

  steering.value = true
  try {
    const result = await steer(id, value)
    input.value = ''
    await load()

    if (result.steered) {
      toast.add({
        title: 'Steered',
        description: 'It goes to the running turn at its next tool call.',
      })
    } else if (result.queued) {
      toast.add({
        title: 'Queued instead',
        description: 'The turn would not take it, so it goes when this one ends.',
      })
    } else {
      toast.add({
        title: 'Sent as a new turn',
        description: 'Nothing was running by the time it arrived.',
      })
    }

    // A steered turn is the one already on screen, and re-attaching to it would
    // drop the stream and replay it for nothing.
    if (result.runId && result.runId !== activeRunId.value) watchRun(result.runId)
  } catch (e) {
    toast.add({ title: 'Could not steer', description: errorMessage(e), color: 'error' })
  } finally {
    steering.value = false
  }
}

/**
 * Send what is waiting now.
 *
 * Reachable only when the session is idle with something still queued, which
 * means the turn it was waiting for was stopped or failed rather than finished.
 * Both hold the queue back deliberately; this is the "yes, I still meant it".
 */
async function onSendQueued() {
  if (sending.value || isBusy.value) return

  sending.value = true
  try {
    const runId = await sendQueued(id)
    await load()
    if (runId) watchRun(runId)
  } catch (e) {
    toast.add({ title: 'Could not send', description: errorMessage(e), color: 'error' })
  } finally {
    sending.value = false
  }
}

/** Changed your mind about one of them. The text goes back into the box. */
async function onUnqueue(message: QueuedMessage) {
  if (dropping.value) return

  dropping.value = message.id
  try {
    await dropQueued(id, message.id)
    if (session.value) session.value.queued = queued.value.filter(m => m.id !== message.id)
    // Handed back rather than thrown away: you wrote it, and removing a queued
    // message is usually the first half of rewording it.
    input.value = input.value.trim() ? `${message.text}\n\n${input.value}` : message.text
  } catch (e) {
    toast.add({ title: 'Could not remove that', description: errorMessage(e), color: 'error' })
  } finally {
    dropping.value = null
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

// --- Following the pull request afterwards ----------------------------------

const showWatch = ref(false)
const watchLand = ref(false)
const savingWatch = ref(false)

/**
 * Landing starts off every time this opens, and is never restored from the
 * last answer. It is the only control on this page whose effect other people
 * see, and a checkbox that remembers "yes" is how somebody merges something
 * they did not mean to.
 */
function openWatchDialog() {
  watchLand.value = false
  showWatch.value = true
}

async function onWatch() {
  savingWatch.value = true
  try {
    await watchPullRequest(id, { watch: true, land: watchLand.value })
    toast.add({
      title: watchLand.value ? 'Watching, and landing it when green' : 'Watching its checks',
      description: watchLand.value
        ? 'It will fix failing CI and merge once the checks pass.'
        : 'It will fix failing CI and tell you when it is green.',
      color: 'success',
    })
    showWatch.value = false
    await load()
  } catch (e) {
    toast.add({ title: 'Could not watch it', description: errorMessage(e), color: 'error' })
  } finally {
    savingWatch.value = false
  }
}

async function onStopWatch() {
  savingWatch.value = true
  try {
    await watchPullRequest(id, { watch: false })
    await load()
  } catch (e) {
    toast.add({ title: 'Could not stop', description: errorMessage(e), color: 'error' })
  } finally {
    savingWatch.value = false
  }
}

/** What the watch is doing, in the words the header has room for. */
const watchLabel = computed(() => {
  const watch = session.value?.prWatch
  if (!watch) return null

  if (watch.state === 'fixing') return `Fixing CI — attempt ${watch.attempts} of ${watch.max}`
  if (watch.state === 'watching') return watch.land ? 'Watching, lands when green' : 'Watching its checks'
  if (watch.state === 'landed') return 'Merged'
  return 'Stopped watching'
})

const watchActive = computed(() =>
  session.value?.prWatch?.state === 'watching' || session.value?.prWatch?.state === 'fixing'
)

/**
 * The pull request this branch has, from whichever half of the app knows about
 * one.
 *
 * `prUrl` is what this app opened; `pr` is what GitHub says about the branch,
 * which also covers one the agent opened itself with `gh` and one that was
 * already there when the session picked the branch up. GitHub wins where both
 * exist, because it is the half that knows the state and the number.
 */
const pullRequest = computed(() => {
  const known = session.value?.pr
  if (known) return known

  const url = session.value?.prUrl
  if (!url) return null

  return {
    number: Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0),
    url,
    title: '',
    baseBranch: '',
    state: 'OPEN' as const,
    isDraft: false,
  }
})

/**
 * Where this branch is really going.
 *
 * The session records what it was cut from; an open pull request can target
 * something else entirely, and it is the one that decides where the work lands.
 * Neither is usually `main`, which is the whole reason this is shown at all.
 */
const baseBranch = computed(() => {
  const pr = pullRequest.value
  if (pr && pr.state === 'OPEN' && pr.baseBranch) return pr.baseBranch
  return session.value?.baseBranch ?? ''
})

/** Set when the pull request retargeted, so the header does not quietly lie. */
const retargeted = computed(() =>
  Boolean(session.value && baseBranch.value && baseBranch.value !== session.value.baseBranch)
)

/**
 * Which of three things this workspace is, in one glyph.
 *
 * A branch it holds, a commit it is only reading, or a branch it wandered onto —
 * and the last is the one worth an icon that does not look like the first.
 */
const branchIcon = computed(() => {
  if (session.value?.detached) return 'i-lucide-git-commit-horizontal'
  if (session.value?.driftedTo) return 'i-lucide-git-compare-arrows'
  return 'i-lucide-git-branch'
})

/**
 * The header's overflow. Everything here is real but occasional — opening the
 * request on github.com, starting a CI watch, closing the session down. Left on
 * the bar they made Merge look like one option among six.
 */
const overflowActions = computed(() => {
  const groups: { label: string; icon: string; to?: string; target?: string; onSelect?: () => void }[][] = []

  if (session.value?.prUrl) {
    groups.push([
      {
        label: 'View pull request',
        icon: 'i-lucide-external-link',
        to: session.value.prUrl,
        target: '_blank',
      },
      ...(watchActive.value ? [] : [{
        label: session.value.prWatch ? 'Watch CI again' : 'Watch CI',
        icon: 'i-lucide-radar',
        onSelect: openWatchDialog,
      }]),
    ])
  } else if (session.value?.worktree.changedFiles || session.value?.worktree.ahead) {
    // The button is already on the bar in this case; the menu repeats nothing.
    groups.push([])
  }

  groups.push([
    session.value?.filedAt
      ? {
          label: 'Put back in flight',
          icon: 'i-lucide-undo-2',
          onSelect: () => { void onSetAside(false) },
        }
      : {
          // Named for what it does to the row, not for the tab it lands on:
          // "Move to History" reads like an archive, and this deletes nothing.
          label: 'Set aside',
          icon: 'i-lucide-archive',
          onSelect: () => { void onSetAside(true) },
        },
    { label: 'Close session', icon: 'i-lucide-x-circle', onSelect: () => { showClose.value = true } },
  ])

  return groups.filter(group => group.length)
})

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
      // The comment is a second thing that happened to somebody else's issue, so
      // it is said here rather than left to be discovered on GitHub. A refusal —
      // the setting being off, a Notion ticket, an issue already told — is not
      // worth a toast: nothing happened and nothing was expected to.
      description: result.issue?.posted
        ? `${result.url} · #${result.issue.issue} was told`
        : result.url,
      color: 'success',
    })

    // A failure is worth saying, because it is the half that did not happen and
    // opening the request again is the only way to try once more.
    if (result.issue && !result.issue.posted && result.issue.reason === 'failed') {
      toast.add({ title: 'The issue was not told', description: result.issue.because, color: 'warning' })
    }
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
      frame: 'background: var(--error-wash); border: 1px solid var(--error);',
    }
  }

  if (check.status === 'errored') {
    return {
      title: 'The checks could not run',
      detail: `${ran} — so there is no verdict either way.`,
      icon: 'i-lucide-circle-help',
      color: 'var(--warning)',
      frame: 'background: var(--warning-wash); border: 1px solid var(--warning);',
    }
  }

  // A pass against a base that has since moved is the more dangerous of the
  // two stale states, and the one nothing used to mention: git will refuse a
  // textual conflict, but it has nothing to say about the other branch having
  // renamed something this one calls.
  if (behind.value) {
    return {
      title: `Passed, before ${session.value?.baseBranch} moved on`,
      detail: `${ran} — ${behindWord.value} since then.`,
      icon: 'i-lucide-git-pull-request-arrow',
      color: 'var(--warning)',
      frame: 'background: var(--warning-wash); border: 1px solid var(--warning);',
    }
  }

  return {
    title: session.value?.checkStale ? 'Passed, before the latest change' : 'This works',
    detail: ran,
    icon: 'i-lucide-check-check',
    color: session.value?.checkStale ? 'var(--warning)' : 'var(--success)',
    frame: session.value?.checkStale
      ? 'background: var(--warning-wash); border: 1px solid var(--warning);'
      : 'background: var(--success-wash); border: 1px solid var(--success);',
  }
})

/** How far this session's base has moved without it. */
const behind = computed(() => session.value?.worktree.behind ?? 0)
const behindWord = computed(() =>
  `${behind.value} commit${behind.value === 1 ? '' : 's'} on ${session.value?.baseBranch}`,
)

const updatingBase = ref(false)

async function onUpdateBase() {
  updatingBase.value = true
  try {
    const result = await updateFromBase(id)
    await load()
    if (showMerge.value) mergePreview.value = await previewMerge(id)

    toast.add({
      title: result.message,
      description: result.check
        ? result.check.status === 'passing'
          ? 'Checks still pass against the new base.'
          : 'The checks do not pass any more — worth a look before merging.'
        : undefined,
      color: result.status === 'conflicted' ? 'warning' : result.check?.status === 'failing' ? 'error' : 'success',
    })
  } catch (e) {
    toast.add({ title: 'Could not bring it in', description: errorMessage(e), color: 'error' })
  } finally {
    updatingBase.value = false
  }
}

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
    router.push('/work')
  } catch (e) {
    toast.add({ title: 'Could not close', description: errorMessage(e), color: 'error' })
  } finally {
    closing.value = false
    showClose.value = false
  }
}

/**
 * Move this session between In flight and History.
 *
 * The one thing on this page that says "I am done with this" without destroying
 * anything, and the reason the In flight tab can be trusted. Everything the tab
 * could work out for itself — the turn has ended, nothing is committed, there is
 * no pull request — is equally true of a session that has just answered you and
 * is waiting for the next thing, so it stopped guessing and started asking.
 *
 * No confirmation, because there is nothing to lose: the worktree, the branch
 * and the whole conversation stay exactly where they are, and the next turn
 * brings it back on its own.
 */
async function onSetAside(aside: boolean) {
  if (filing.value) return
  filing.value = true
  try {
    const updated = await setAside(id, aside)
    if (session.value) session.value = { ...session.value, filedAt: updated.filedAt }
    toast.add({
      title: aside ? 'Set aside — moved to History' : 'Back in flight',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: 'Could not move it', description: errorMessage(e), color: 'error' })
  } finally {
    filing.value = false
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

/**
 * What was said into a turn while it ran, placed where it landed.
 *
 * Live from the stream, from the record afterwards — the same split as the steps
 * above, and for the same reason. `afterSteps` is what makes this different from
 * another turn in the list: a correction that arrived after the fourth file is
 * the explanation for why the fifth one is not what the opening sentence asked
 * for, and read back tomorrow that position is the whole fact.
 */
function steersFor(turn: SessionTurn): { text: string; afterSteps: number }[] {
  if (turn.id === activeRunId.value && liveRun.value) return liveRun.value.steers ?? []
  return turn.steers ?? []
}

/**
 * Where a steered message landed, in words.
 *
 * Said out loud rather than drawn by position, because the steps it counts are
 * folded away for a finished turn and a row that only makes sense with them open
 * is a row that usually makes no sense.
 */
function steerPlace(afterSteps: number): string {
  if (!afterSteps) return 'before its first step'
  return afterSteps === 1 ? 'after its first step' : `after ${afterSteps} steps`
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
 * Notes are gathered rather than sent one at a time: each turn is a whole agent
 * run, and three remarks about one change are a single piece of feedback.
 * Sending them separately invites three uncoordinated rewrites.
 *
 * They live on the server rather than here, because reading a long diff is
 * exactly the activity that gets interrupted — see `server/utils/diffNotes.ts`.
 * So every add and every removal is a request, and what comes back is the list.
 */
const patchLines = computed<PatchLine[]>(() => parsePatch(diff.value?.patch ?? ''))
const notes = ref<DiffNote[]>([])
const commentingOn = ref<number | null>(null)
const commentDraft = ref('')
const notesBusy = ref(false)

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

async function addComment(line: PatchLine) {
  const body = commentDraft.value.trim()
  if (!body || !line.file || notesBusy.value) return

  notesBusy.value = true
  try {
    notes.value = await addNote(id, {
      file: line.file,
      line: line.line ?? 0,
      // The line travels with the note, so the pending list can show what it
      // was written against without going back to the patch.
      snippet: line.text,
      body,
    })
    cancelComment()
  } catch (e) {
    toast.add({ title: 'Could not keep that note', description: errorMessage(e), color: 'error' })
  } finally {
    notesBusy.value = false
  }
}

async function dropComment(note: DiffNote) {
  if (notesBusy.value) return

  notesBusy.value = true
  try {
    notes.value = await dropNotes(id, note.id)
  } catch (e) {
    toast.add({ title: 'Could not remove that note', description: errorMessage(e), color: 'error' })
  } finally {
    notesBusy.value = false
  }
}

async function discardNotes() {
  if (notesBusy.value) return

  notesBusy.value = true
  try {
    notes.value = await dropNotes(id)
  } catch (e) {
    toast.add({ title: 'Could not discard them', description: errorMessage(e), color: 'error' })
  } finally {
    notesBusy.value = false
  }
}

/**
 * Hand every note over as one turn.
 *
 * Never refused for a session that is busy: `sendOrQueue` keeps the message and
 * releases it when the turn ends, and which of the two happened is its answer
 * rather than a guess made here — same as the composer below.
 *
 * The notes are checked against the diff on screen first, and one pointing at a
 * line that is no longer there is dropped and named. It is still cleared either
 * way: what it was about is gone, and leaving it in the list to be sent against
 * the next diff would point the agent at whatever now sits at that number.
 */
async function sendReview() {
  if (!notes.value.length || sending.value) return

  const composed = composeNotes(notes.value, patchLines.value)
  const count = composed.sent.length

  if (!composed.instruction) {
    toast.add({
      title: 'Nothing left to send',
      description: composed.droppedNote ?? 'Those lines are no longer in this diff.',
      color: 'warning',
    })
    await discardNotes()
    return
  }

  sending.value = true
  try {
    const result = await send(id, composed.instruction)
    notes.value = await dropNotes(id)
    showPatch.value = false
    await load()
    if (result.runId) watchRun(result.runId)

    toast.add({
      title: result.runId ? 'Sent' : 'Queued',
      description: [
        result.runId
          ? `${count} note${count === 1 ? '' : 's'} went as this turn.`
          : `${count} note${count === 1 ? '' : 's'} will go when this turn ends.`,
        composed.droppedNote,
      ].filter(Boolean).join(' '),
    })
  } catch (e) {
    toast.add({ title: 'Could not send the notes', description: errorMessage(e), color: 'error' })
  } finally {
    sending.value = false
  }
}

/**
 * A turn that came from pointing at the preview.
 *
 * `PreviewPane` sends it itself — the notes and the selectors never leave that
 * component — and says so afterwards, because the turn list above it and the run
 * being watched are this page's, not its.
 */
async function onPointNotesSent(result: { runId: string | null, count: number }) {
  await load()
  if (result.runId) watchRun(result.runId)
}

/**
 * How much this session may do without asking.
 *
 * Choosing Auto applies at once, including to a turn already running — an
 * unanswered prompt is answered by the level you just picked. Anything else
 * applies from the next turn, because a run that was told to stop asking has
 * nothing left to intercept.
 */
const trust = computed<TrustLevel>(() => session.value?.trust ?? DEFAULT_TRUST)

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
  <div class="h-screen flex flex-col">
    <PageHeader bleed :title="session?.title || 'Session'">
      <template #leading>
        <NuxtLink to="/work" class="focus-ring rounded p-1.5 -m-1.5" aria-label="Back to work">
          <UIcon name="i-lucide-arrow-left" class="size-4 text-label" />
        </NuxtLink>
      </template>
      <template #trailing>
        <!--
          Branch, what it merges into, and the pull request it has. The base was
          only readable three panels down, which is fine while every session is
          cut from `main` and useless the moment they are not — stacked work is
          based on another session's branch, and a retargeted pull request lands
          somewhere the session record never heard of.
        -->
        <span v-if="session" class="flex items-center gap-1.5 min-w-0">
          <span class="font-mono type-detail ink-accent truncate">{{ session.branch }}</span>
          <!--
            A review workspace names the branch it is reading without holding
            it, which is the whole reason two reviews of one pull request are
            possible. Marked, because "on this branch" and "reading this branch"
            are different situations and the second one cannot commit.
          -->
          <span
            v-if="session.detached"
            class="fs-micro px-1 rounded shrink-0"
            style="background: var(--badge-subtle-bg); color: var(--text-tertiary);"
            title="Detached: the commit is checked out, the branch is not. Reviewing does not take the branch from anything working on it."
          >reading</span>
          <template v-if="baseBranch">
            <UIcon name="i-lucide-arrow-right" class="size-3 shrink-0 ink-4" />
            <span
              class="font-mono type-detail ink-3 truncate"
              :title="retargeted
                ? `The pull request targets ${baseBranch}. This session was cut from ${session.baseBranch}.`
                : `Branched from ${baseBranch}`"
            >{{ baseBranch }}</span>
          </template>
          <a
            v-if="pullRequest"
            :href="pullRequest.url"
            target="_blank"
            rel="noopener"
            class="focus-ring inline-flex items-center gap-1 px-1.5 py-px rounded-md type-detail shrink-0"
            :style="pullRequest.state === 'MERGED'
              ? 'background: var(--success-wash); color: var(--text-secondary);'
              : pullRequest.state === 'CLOSED'
                ? 'background: var(--badge-subtle-bg); color: var(--text-disabled);'
                : 'background: var(--accent-muted); color: var(--text-secondary);'"
            :title="pullRequest.title || 'Open the pull request on GitHub'"
          >
            <UIcon
              :name="pullRequest.state === 'MERGED' ? 'i-lucide-git-merge' : 'i-lucide-git-pull-request'"
              class="size-3.5 shrink-0"
            />
            <span v-if="pullRequest.number">#{{ pullRequest.number }}</span>
            <span v-if="pullRequest.isDraft" class="fs-micro">draft</span>
          </a>
        </span>
      </template>
      <template #right>
        <!--
          One strip rather than four toggles. Each opens its pane and closes
          whatever was showing; pressing the active one closes it entirely.
        -->
        <div v-if="session" class="flex items-center gap-0.5 p-0.5 rounded-md" style="background: var(--input-bg);">
          <button
            v-for="tab in [
              { id: 'changes' as const, label: diff?.files.length ? `${diff.files.length} changed` : 'Changes', icon: 'i-lucide-file-diff' },
              { id: 'files' as const, label: 'Files', icon: 'i-lucide-folder-open' },
              { id: 'preview' as const, label: 'Preview', icon: 'i-lucide-monitor-play' },
              { id: 'terminal' as const, label: 'Terminal', icon: 'i-lucide-square-terminal' },
              // Only on a session that was opened to read somebody's pull
              // request. Everywhere else there is no review to compose, and a
              // tab that opens onto an explanation of why it is empty is worse
              // than no tab.
              ...(session?.reviewOf
                ? [{ id: 'review' as const, label: 'Review', icon: 'i-lucide-message-square-code' }]
                : []),
            ]"
            :key="tab.id"
            class="flex items-center gap-1.5 px-2 py-1 rounded fs-sm transition-all"
            :style="{
              background: pane === tab.id ? 'var(--surface-raised)' : 'transparent',
              color: pane === tab.id ? 'var(--accent)' : 'var(--text-disabled)',
            }"
            :title="pane === tab.id ? `Close ${tab.label}` : tab.label"
            :aria-label="tab.label"
            @click="showPane(tab.id)"
          >
            <UIcon :name="tab.icon" class="size-3.5 shrink-0" />
            <!--
              Dropped for the icon on a header too narrow to hold the strip and
              the actions beside it — see `.pane-tab__label`. The name is what
              the title says, so nothing is lost but the width.
            -->
            <span class="pane-tab__label">{{ tab.label }}</span>
          </button>
        </div>

        <!--
          A watch in flight is status, not an action, so it stays on the bar
          where you can see it. Everything that is merely *available* moved into
          the overflow: this header was carrying up to six controls at once
          beside the pane strip, and none of them looked more important than
          any other.
        -->
        <div
          v-if="session?.prUrl && watchActive"
          class="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-md type-detail"
          style="background: var(--accent-muted); color: var(--text-secondary);"
        >
          <UIcon
            :name="session?.prWatch?.state === 'fixing' ? 'i-lucide-wrench' : 'i-lucide-radar'"
            class="size-3.5 shrink-0"
            :class="session?.prWatch?.state === 'fixing' ? 'animate-pulse' : ''"
          />
          <span>{{ watchLabel }}</span>
          <UButton
            icon="i-lucide-x"
            size="xs"
            variant="ghost"
            color="neutral"
            :loading="savingWatch"
            title="Stop watching"
            @click="onStopWatch"
          />
        </div>

        <!-- Both ways to land it stay visible; only Merge is accented. -->
        <UButton
          v-if="!session?.prUrl && (session?.worktree.changedFiles || session?.worktree.ahead)"
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

        <!--
          The way out. These panes are for finishing rather than living in, so
          the trip to a real editor should be one press and not a hunt for the
          path — which is the only place it was written down.
        -->
        <OpenInEditor
          v-if="session?.worktreePath"
          :path="session.worktreePath"
          :missing="!session.worktree.exists"
        />

        <UDropdownMenu :items="overflowActions" :popper="{ placement: 'bottom-end' }">
          <UButton
            icon="i-lucide-more-horizontal"
            size="sm"
            variant="ghost"
            color="neutral"
            aria-label="More actions"
          />
        </UDropdownMenu>
      </template>
    </PageHeader>

    <div id="session-split" class="flex-1 flex min-h-0" :class="{ 'select-none': dragging }">
      <!-- The conversation, with its own scroll so the composer stays put -->
      <section
        class="flex flex-col min-h-0"
        :class="pane ? 'shrink-0' : 'flex-1'"
        :style="pane ? { width: `${conversationWidth}%` } : undefined"
      >
        <div class="flex-1 overflow-y-auto">
          <div class="py-5 space-y-5" :class="pane ? 'px-8' : 'page-container'">
            <div v-if="loadError" class="rounded-md px-4 py-3 type-detail" style="background: var(--error-wash); color: var(--error);">
              {{ loadError }}
            </div>

            <template v-else-if="session">
            <!--
              How following the pull request ended. The notification fires at the
              moment it happens, which is precisely the moment nobody is here — so
              the reason has to survive on the page as well.
            -->
            <div
              v-if="session.prWatch && !watchActive && session.prWatch.reason"
              class="flex items-start gap-2.5 rounded-md px-4 py-3 type-detail"
              :style="session.prWatch.state === 'landed'
                ? 'background: var(--success-wash); color: var(--text-secondary);'
                : 'background: var(--accent-muted); color: var(--text-secondary);'"
            >
              <UIcon
                :name="session.prWatch.state === 'landed' ? 'i-lucide-git-merge' : 'i-lucide-radar'"
                class="size-4 shrink-0 mt-0.5"
              />
              <span>{{ session.prWatch.reason }}</span>
            </div>

            <!-- Where this session is working, stated plainly -->
            <div class="rounded-md px-4 py-3 space-y-1" style="background: var(--surface-raised); border: 1px solid var(--border-subtle);">
              <div class="flex items-start gap-2">
                <UIcon
                  :name="branchIcon"
                  class="size-3.5 shrink-0 mt-0.5"
                  :class="session.driftedTo ? '' : 'ink-4'"
                  :style="session.driftedTo ? 'color: var(--warning);' : undefined"
                />
                <span v-if="session.detached" class="type-detail ink-2">
                  Reading <span class="font-mono ink-accent">{{ session.branch }}</span>
                  at <span class="font-mono">{{ session.baseSha.slice(0, 7) }}</span> —
                  detached, so no branch is checked out here
                </span>
                <!--
                  Replacing the line rather than correcting it underneath. "Working
                  on X" is simply false once the worktree is on something else, and
                  a page that states it and then contradicts it two lines down has
                  made the reader decide which half to believe. The sentence comes
                  from `driftNote` so this and the card cannot word it differently.
                -->
                <span
                  v-else-if="session.driftedTo"
                  class="type-detail leading-snug"
                  style="color: var(--warning);"
                >{{ driftNote(session.branch, session.driftedTo) }}</span>
                <span v-else class="type-detail ink-2">
                  Working on <span class="font-mono ink-accent">{{ session.branch }}</span>,
                  branched from <span class="font-mono">{{ session.baseBranch }}</span>
                </span>
              </div>

              <div class="type-mono-meta pl-6 truncate">{{ session.worktreePath }}</div>

              <!--
                The pull request and, when it disagrees with the record, where it
                is actually going. A session whose request was retargeted after
                it started is measured against one branch and merged into
                another, and nothing else on the page would say so.
              -->
              <div v-if="pullRequest" class="flex items-center gap-2">
                <UIcon name="i-lucide-git-pull-request" class="size-3.5 shrink-0 ink-4" />
                <span class="type-detail ink-2">
                  <a
                    :href="pullRequest.url"
                    target="_blank"
                    rel="noopener"
                    class="focus-ring font-mono ink-accent underline-offset-2 hover:underline"
                  >{{ pullRequest.number ? `#${pullRequest.number}` : 'Pull request' }}</a>
                  <template v-if="retargeted">
                    targets <span class="font-mono">{{ baseBranch }}</span>, not what this branched from
                  </template>
                  <template v-else-if="pullRequest.title">— {{ pullRequest.title }}</template>
                </span>
              </div>
              <div v-if="!session.worktree.exists" class="type-meta pl-6 ink-error">
                This workspace is missing from disk — it was removed outside the app.
              </div>

              <!-- What it will not stop to ask about, and how to take that back -->
              <div v-if="projectRules.length" class="flex items-center gap-1.5 flex-wrap pl-6 pt-0.5">
                <span class="type-meta">Always allowed here</span>
                <!--
                  A grant for a tool no run here can reach is drawn as what it
                  is. It looked identical to a working one, which is how a
                  ritual elsewhere in this app collected four of them.
                -->
                <span
                  v-for="rule in projectRules"
                  :key="rule"
                  class="inline-flex items-center gap-1 fs-micro px-1.5 py-px rounded-md group/rule"
                  :style="deadReason(rule)
                    ? 'background: var(--warning-wash); color: var(--warning);'
                    : 'background: var(--badge-subtle-bg); color: var(--text-secondary);'"
                  :title="deadReason(rule) || rule"
                >
                  <UIcon
                    :name="deadReason(rule) ? 'i-lucide-unplug' : 'i-lucide-shield-check'"
                    class="size-2.5 shrink-0"
                    :class="deadReason(rule) ? 'ink-warn' : 'ink-ok'"
                  />
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

              <!-- Once per reason, not once per rule: five tools behind one
                   missing server is one thing to fix. -->
              <div
                v-for="reason in deadReasons"
                :key="reason"
                class="flex items-start gap-1.5 pl-6 pt-0.5 type-meta"
              >
                <UIcon name="i-lucide-unplug" class="size-3 shrink-0 mt-0.5 ink-warn" />
                <span>{{ reason }}</span>
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
                <!--
                  The fix for a verdict taken against a base that has moved. Offered
                  whether or not the checks passed: behind is behind.
                -->
                <UButton
                  v-if="behind"
                  :label="`Bring in ${session.baseBranch}`"
                  icon="i-lucide-git-merge"
                  size="xs"
                  variant="soft"
                  :loading="updatingBase"
                  :disabled="isBusy || checking"
                  @click="onUpdateBase"
                />
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

              <!--
                Being behind matters whatever the verdict is, and it was only said
                in the passing case — so a session 17 commits adrift with no checks
                read as "Not checked yet" and nothing else, with the only clue
                buried in a button label.
              -->
              <div v-if="behind && session.check?.status !== 'passing'" class="flex items-center gap-2 pt-0.5">
                <UIcon name="i-lucide-git-pull-request-arrow" class="size-3.5 shrink-0 ink-warn" />
                <span class="type-meta">
                  {{ behindWord }} since this workspace was cut — bring them in before trusting anything here.
                </span>
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
                class="font-mono fs-micro leading-relaxed overflow-x-auto max-h-64 p-2.5 rounded"
                style="background: var(--surface-inset); color: var(--text-secondary);"
              >{{ session.check.output }}</pre>
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
                <UIcon name="i-lucide-terminal" class="size-3.5 shrink-0 ink-4" />
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

                <!--
                  What was said into this turn while it was running. Drawn as its
                  own kind of thing rather than as another instruction bubble: it
                  did not start a turn, it changed one that had already begun,
                  and it says where in the turn it arrived — which is the fact
                  that explains why the rest of the turn is not what the sentence
                  above asked for.
                -->
                <div
                  v-for="(steered, index) in steersFor(turn)"
                  :key="`steer-${index}`"
                  class="flex justify-end"
                >
                  <div
                    class="rounded-md px-3.5 py-2 max-w-[80%] space-y-1"
                    style="background: var(--surface-raised); border: 1px dashed var(--accent-glow);"
                  >
                    <span class="type-meta flex items-center gap-1.5">
                      <UIcon name="i-lucide-navigation" class="size-3 shrink-0 ink-accent" />
                      Steered mid-turn, {{ steerPlace(steered.afterSteps) }}
                    </span>
                    <div class="type-body whitespace-pre-wrap">{{ steered.text }}</div>
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
                      <span class="shrink-0 ink-2">{{ describe(step).verb }}</span>
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
                  <UIcon name="i-lucide-loader-2" class="size-3 animate-spin ink-accent" />
                  Working — you can close this tab and come back.
                </div>
                <!-- A stopped turn is not a failure, and its half-finished work is still real -->
                <div v-if="turn.status === 'cancelled'" class="flex items-center gap-2 type-meta">
                  <UIcon name="i-lucide-square" class="size-3" />
                  {{ turn.output ? 'Stopped part-way through.' : 'Stopped before it said anything.' }}
                </div>
                <div v-if="turn.error" class="type-detail ink-error">{{ turn.error }}</div>
              </div>
            </div>

            <EmptyState
              v-else-if="!inherited.length"
              variant="inset"
              icon="i-lucide-message-square"
              title="Nothing yet"
              description="Tell Claude what to do in this workspace. It can change files freely — they're isolated from your project until you decide to keep them."
            />

            <!--
              What you have written so far, and the one action that uses it. The
              button says which of send and queue will happen, because a session
              mid-turn keeps the notes rather than refusing them.
            -->
            <div
              v-if="notes.length"
              class="rounded-md px-4 py-3 space-y-2"
              style="background: var(--surface-raised); border: 1px solid var(--accent-glow);"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="type-strong text-body">
                  {{ notes.length }} note{{ notes.length === 1 ? '' : 's' }} to send
                </span>
                <div class="flex items-center gap-2">
                  <UButton
                    label="Discard"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    :disabled="notesBusy || sending"
                    @click="discardNotes"
                  />
                  <UButton
                    :label="isBusy ? 'Queue for the next turn' : 'Send as the next turn'"
                    :icon="isBusy ? 'i-lucide-list-plus' : 'i-lucide-message-square-reply'"
                    size="xs"
                    :loading="sending"
                    @click="sendReview"
                  />
                </div>
              </div>
              <div
                v-for="note in notes"
                :key="note.id"
                class="flex items-start gap-2 group/comment"
              >
                <span class="type-mono-meta shrink-0 ink-accent">
                  {{ note.file }}:{{ note.line }}
                </span>
                <span class="type-detail flex-1 min-w-0">{{ note.body }}</span>
                <button
                  class="opacity-0 group-hover/comment:opacity-100 transition-opacity focus-ring rounded shrink-0"
                  style="color: var(--text-disabled);"
                  aria-label="Remove this note"
                  :disabled="notesBusy"
                  @click="dropComment(note)"
                >
                  <UIcon name="i-lucide-x" class="size-3" />
                </button>
              </div>
            </div>

            </template>

            <div v-else class="flex justify-center py-16">
              <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
            </div>
          </div>
        </div>

        <!--
          Pinned, rather than the last thing in a long scroll. The box you type
          into is the one control you reach for at any point in a conversation,
          and it used to be reachable only from the bottom of it.
        -->
        <div
          v-if="session"
          class="shrink-0"
          style="border-top: 1px solid var(--border-subtle); background: var(--surface-base);"
        >
          <div class="py-3 space-y-2" :class="pane ? 'px-8' : 'page-container'">
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

            <!--
              What you typed while it was working, in the order it will be said.
              Drawn above the box so a queue of three does not look like nothing
              having happened three times.
            -->
            <div v-if="queued.length" class="space-y-1.5">
              <div class="flex items-center justify-between gap-3">
                <span class="type-meta flex items-center gap-1.5">
                  <UIcon name="i-lucide-clock" class="size-3 shrink-0" />
                  {{ queued.length === 1 ? 'Queued' : `${queued.length} queued` }} ·
                  {{ isBusy ? 'goes when this turn ends' : 'nothing is running to release it' }}
                </span>
                <UButton
                  v-if="!isBusy"
                  label="Send now"
                  icon="i-lucide-arrow-up"
                  size="xs"
                  variant="soft"
                  :loading="sending"
                  @click="onSendQueued"
                />
              </div>
              <div
                v-for="(message, index) in queued"
                :key="message.id"
                class="flex items-start gap-2 rounded-md px-3 py-2 group/queued"
                style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
              >
                <span class="type-mono-meta shrink-0 pt-px" style="color: var(--text-disabled);">
                  {{ index + 1 }}
                </span>
                <span class="type-detail flex-1 min-w-0 line-clamp-2 whitespace-pre-wrap">{{ message.text }}</span>
                <button
                  class="opacity-0 group-hover/queued:opacity-100 transition-opacity focus-ring rounded shrink-0"
                  style="color: var(--text-disabled);"
                  :disabled="dropping === message.id"
                  aria-label="Take this back out of the queue"
                  title="Take it back out — the text returns to the box"
                  @click="onUnqueue(message)"
                >
                  <UIcon name="i-lucide-x" class="size-3" />
                </button>
              </div>
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

              <!--
                Live throughout a turn. It was disabled for the whole of one,
                which is the moment you most want it: the correction you thought
                of watching it go the wrong way had to be held in your head for
                ten minutes. Only a workspace that is gone takes the box away.
              -->
              <textarea
                v-model="input"
                rows="2"
                class="field-textarea flex-1"
                :placeholder="isBusy
                  ? 'Working — type anyway: queue it for after, or steer this turn now'
                  : 'What should it do next? Type / for commands'"
                :disabled="!session.worktree.exists"
                @keydown="onComposerKey"
              />
              <!-- Queueing is the same key and the same button, saying what it does -->
              <UButton
                :label="isBusy ? 'Queue for after' : 'Send'"
                :icon="isBusy ? 'i-lucide-list-plus' : 'i-lucide-arrow-up'"
                size="sm"
                :variant="isBusy ? 'soft' : 'solid'"
                :loading="sending"
                :disabled="!input.trim() || !session.worktree.exists || steering"
                @click="onSend"
              />
              <!--
                The other thing you might mean while it is working, and the
                deliberate one: this reaches the turn that is running instead of
                waiting for it. Not what Enter does — a correction is worth a
                second's thought, and queueing is right far more often.
              -->
              <UButton
                v-if="isBusy"
                label="Steer now"
                icon="i-lucide-navigation"
                size="sm"
                variant="soft"
                :loading="steering"
                :disabled="!input.trim() || !session.worktree.exists || sending"
                title="Say it to the turn that is running — it lands at the next tool call"
                @click="onSteer"
              />
              <!-- While it is working, the other useful button is the one that stops it -->
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
                icon="i-lucide-slash"
                size="sm"
                variant="ghost"
                color="neutral"
                :title="`${commands.length} commands available`"
                aria-label="Show commands"
                @click="() => { paletteOpen = !paletteOpen }"
              />
            </div>

            <!-- Said out loud, because the shortcut changed and muscle memory has not -->
            <p class="type-meta pt-1.5">
              {{ isBusy ? '↵ Queue for the next turn' : '↵ Send' }} · ⇧↵ New line
              <template v-if="isBusy"> · Steer now has no key, on purpose</template>
            </p>
          </div>
        </div>
      </section>

      <!-- Drag to rebalance; arrow keys do the same once it has focus. -->
      <div
        v-if="pane"
        class="session-divider shrink-0"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the conversation"
        tabindex="0"
        :class="{ 'session-divider--active': dragging }"
        @mousedown.prevent="startDrag"
        @keydown.left.prevent="nudgeDivider(-4)"
        @keydown.right.prevent="nudgeDivider(4)"
      />

      <!-- The workspace: one pane at a time, its own scroll, full height. -->
      <aside v-if="pane" class="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <!--
            The workspace. Saving here writes into the session's branch, so the
            diff above it and the check verdict beside it both go stale — which is
            why refreshing them is what a save asks for.
          -->
          <!--
            Mounted once opened and hidden thereafter, never destroyed: a tab
            change must not drop the terminal's connection or reload the
            preview's iframe.
          -->
          <div v-if="opened.has('files') && session" v-show="pane === 'files'" class="space-y-4">
            <WorkspaceEditor :session-id="session.id" @saved="onWorkspaceEdited" />

            <!-- Beside the editor, because they are the same kind of thing:
                 acting on the workspace directly rather than asking the agent to. -->
            <RewindPanel :session-id="session.id" @changed="onWorkspaceEdited" />
          </div>

          <div v-if="opened.has('preview') && session" v-show="pane === 'preview'">
            <!--
              Notes written by pointing at the preview become a turn like any
              other, so the conversation has to catch up and the run has to be
              followed — the same two things `sendReview` does.
            -->
            <PreviewPane :session-id="session.id" :session-busy="isBusy" @sent="onPointNotesSent" />
          </div>

          <div v-if="opened.has('review') && session" v-show="pane === 'review'">
            <ReviewPane :session-id="session.id" />
          </div>

          <div v-if="opened.has('terminal') && session" v-show="pane === 'terminal'">
            <TerminalPane
              :post-url="`/api/sessions/${encodeURIComponent(session.id)}/terminal`"
              :stream-url="`/api/sessions/${encodeURIComponent(session.id)}/terminal/stream`"
            />
          </div>

          <!-- Changes -->
          <div
            v-if="pane === 'changes' && diff"
            class="rounded-md overflow-hidden"
            style="border: 1px solid var(--border-subtle);"
          >
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
                <span class="type-mono-meta ink-ok">+{{ file.added }}</span>
                <span class="type-mono-meta ink-error">−{{ file.removed }}</span>
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
                class="px-4 py-3 overflow-x-auto font-mono fs-mono leading-[1.6] diff-patch"
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
                      <UButton
                        label="Add note"
                        size="xs"
                        :loading="notesBusy"
                        :disabled="!commentDraft.trim()"
                        @click="addComment(line)"
                      />
                      <UButton label="Cancel" size="xs" variant="ghost" color="neutral" @click="cancelComment" />
                      <span class="type-meta">↵ to add · ⇧↵ for a new line</span>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- Pushing is the moment this leaves your machine, so spell it out -->
    <UModal v-model:open="showPr">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay modal-panel">
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
              <a :href="prPreview.existingUrl" target="_blank" class="font-mono ink-accent">
                {{ prPreview.existingUrl }}
              </a>
            </div>

            <div
              v-if="prPreview.blockedReason"
              class="rounded-md px-3 py-2.5 type-detail"
              style="background: var(--error-wash); color: var(--error);"
            >
              {{ prPreview.blockedReason }}
            </div>

            <template v-else>
              <p class="type-body">
                Pushes <span class="font-mono type-detail ink-accent">{{ prPreview.branch }}</span>
                to <span class="font-mono type-detail">{{ prPreview.remote }}</span> and opens a request into
                <span class="font-mono type-detail">{{ prPreview.baseBranch }}</span> —
                {{ prPreview.commits.length }} commit{{ prPreview.commits.length === 1 ? '' : 's' }}.
                This is the point at which other people can see it.
              </p>

              <!--
                The other write. Said before the button rather than after it,
                because a comment on somebody else's issue is the part of this
                that cannot be taken back quietly.
              -->
              <p v-if="prPreview.tellsIssue" class="type-detail">
                It also comments once on
                <a :href="prPreview.tellsIssue.url" target="_blank" rel="noopener" class="font-mono ink-accent">
                  #{{ prPreview.tellsIssue.number }}
                </a>
                — what this session did, this pull request, and that nobody has reviewed it. Mention
                the issue in the description yourself and it says nothing, because GitHub will have.
              </p>

              <div class="space-y-1.5">
                <label class="field-label">Title</label>
                <input v-model="prTitle" class="field-input w-full" placeholder="What this changes" />
              </div>

              <div class="space-y-1.5">
                <label class="field-label">Description</label>
                <textarea v-model="prBody" rows="7" class="field-textarea w-full font-mono fs-mono" />
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
        <div class="p-6 space-y-4 bg-overlay modal-panel">
          <h3 class="text-page-title">Merge this session</h3>

          <div v-if="!mergePreview" class="flex items-center gap-2 type-detail">
            <UIcon name="i-lucide-loader-2" class="size-3.5 animate-spin" />
            Checking whether it merges cleanly…
          </div>

          <template v-else>
            <p class="type-body">
              Brings <strong>{{ mergePreview.commits }}</strong>
              commit{{ mergePreview.commits === 1 ? '' : 's' }} from
              <span class="font-mono type-detail ink-accent">{{ session?.branch }}</span>
              into <span class="font-mono type-detail">{{ mergePreview.targetBranch }}</span>.
            </p>

            <div
              v-if="mergePreview.blockedReason"
              class="rounded-md px-3 py-2.5 type-detail"
              style="background: var(--error-wash); color: var(--error);"
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

              <!--
                Beside the failure, never instead of it. The gate is unchanged —
                this failure still blocks the merge — and the only thing that has
                changed is that the person deciding can see the check has gone
                both ways on this exact code before.
              -->
              <div
                v-if="mergePreview.flakeNote && mergePreview.flakes?.length"
                class="rounded px-2.5 py-2 space-y-1.5"
                style="background: var(--warning-wash); border: 1px solid var(--warning-edge);"
              >
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-dices" class="size-3.5 shrink-0" style="color: var(--warning);" />
                  <span class="type-detail">{{ mergePreview.flakeNote }}</span>
                </div>
                <p v-for="flake in mergePreview.flakes" :key="flake.name" class="type-meta">
                  <span class="font-mono">{{ flake.name }}</span> — {{ flake.note }}
                </p>
                <p class="type-meta">
                  Nothing about the merge changes. The check still has to pass, or you still have
                  to say so yourself.
                </p>
              </div>

              <pre
                v-if="mergePreview.check.status === 'failing' && mergePreview.check.output"
                class="font-mono fs-micro leading-relaxed overflow-x-auto max-h-40 p-2 rounded"
                style="background: var(--surface-inset); color: var(--text-secondary);"
              >{{ mergePreview.check.output }}</pre>
            </div>

            <!--
              Beside the checks verdict, never in place of it, and outside that
              panel because a project with no checks still wants to be told this.
              Nothing here blocks the merge: git will take it without a murmur,
              which is the whole reason it is worth a sentence.
            -->
            <div
              v-if="mergePreview.collisionNote && mergePreview.collisions?.length"
              class="rounded-md px-3 py-2.5 space-y-1.5"
              style="background: var(--warning-wash); border: 1px solid var(--warning-edge);"
            >
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" style="color: var(--warning);" />
                <span class="type-detail">{{ mergePreview.collisionNote }}</span>
              </div>
              <p v-for="collision in mergePreview.collisions" :key="collision.name" class="type-meta">
                <span class="font-mono">{{ collision.name }}</span> — {{ collision.note }}
              </p>
              <p class="type-meta">
                Merging is still allowed and nothing about it changes. Git has no objection to
                any of this — whatever still calls these names finds out when it next builds.
              </p>
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
    <UModal v-model:open="showWatch">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay modal-panel">
          <h3 class="text-page-title">Keep watching this pull request?</h3>
          <p class="type-body">
            Your checks passed in this workspace. CI runs somewhere else, against a merge
            with <span class="font-mono type-detail">{{ session?.baseBranch }}</span> that
            never happened here — so it can still go red for reasons this workspace could
            not have known.
          </p>
          <p class="type-body">
            While it is watched, a red result comes back to this session with the failing
            checks attached, and it gets up to
            {{ session?.prWatch?.max ?? 3 }} goes at fixing them before it stops and tells you.
          </p>

          <label
            class="flex items-start gap-2.5 rounded-md px-3 py-2.5 cursor-pointer"
            style="background: var(--input-bg);"
          >
            <UCheckbox v-model="watchLand" class="mt-0.5" />
            <span class="type-detail ink-2">
              <span style="color: var(--text-primary);">Merge it once the checks pass.</span>
              This is the one thing here everybody else can see, and nothing in this app can
              undo it. It never merges on a pull request that reported no checks at all.
            </span>
          </label>

          <div class="flex justify-end gap-2 pt-1">
            <UButton label="Cancel" size="sm" variant="ghost" color="neutral" @click="() => { showWatch = false }" />
            <UButton
              :label="watchLand ? 'Watch and land it' : 'Watch it'"
              icon="i-lucide-radar"
              size="sm"
              :loading="savingWatch"
              @click="onWatch"
            />
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showClose">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay modal-panel">
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

