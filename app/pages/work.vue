<script setup lang="ts">
import { errorMessage, errorSessionId } from '~/utils/errors'
import { findSimilar } from '~/utils/similarSession'
import { isSendKey } from '~/utils/keys'
import { offersCommands, slashQuery } from '~/utils/slashCommands'
import { IMAGE_MEDIA_TYPES, imageMediaType } from '~/utils/imageAttachments'
import type { RunQuery } from '~/composables/useRuns'
import { RUNS_QUERY } from '~/composables/useWorkList'
import { DEFAULT_TRUST, TRUST_CHOICES, type TrustLevel } from '~/composables/useSessions'
import type { Session } from '~/composables/useSessions'
import {
  buildWorkList, onTab, removableRuns, statusCounts, tabOf,
  WORK_ORIGIN, WORK_STATUS,
  type WorkItem, type WorkOrigin, type WorkStatus,
} from '~/utils/workList'

/**
 * The rail beside this page is what the in-flight half of it used to be. See
 * `layouts/work.vue`.
 */
definePageMeta({ layout: 'work' })

const { needsYouCount, create, createMany, race, startFrom, fetchAll } = useSessions()
const { fetchAll: fetchWorktrees } = useWorktrees()
const { fetchRuns, hideRuns } = useRuns()
const { transcripts, fetchAll: fetchTranscripts, adopt } = useTranscripts()
const { workingDir, displayPath } = useWorkingDir()
/**
 * Images for the first turn. A session is very often started from a screenshot
 * of the thing that is wrong, and describing that in words first was the only
 * way to hand it over.
 */
const {
  attachments, dropZone, dragOver, attach: attachImages, remove: removeAttachment,
  clear: clearAttachments, onDragOver, onDragLeave, onDrop,
} = useChatAttachments()

const { projects, nameFor, addProject } = useProjects()
const router = useRouter()
const toast = useToast()

/**
 * The list, shared with the rail.
 *
 * The fetching, the poll and the scope live in `useWorkList` now, because the
 * rail shows the same work from the same data and the two have to agree — a rail
 * saying a session is blocked next to a page that has not noticed is worse than
 * either on its own. What is left here is what this page does *about* the work.
 */
const {
  sessions, visibleSessions, runs, loading,
  scope, runsQuery, tabCounts, pullFor,
} = useWorkList()

/**
 * Which of this page's two jobs is on screen. The in-flight rows are the rail's
 * now, so what is left is starting something and reading what finished.
 */
const { pane } = useWorkPane()

/**
 * The shell docked to the bottom of this page.
 *
 * The shortcut is bound here rather than in the dock because the dock only
 * renders once it is open — a component that has to exist to be opened cannot
 * be the thing listening for the key that opens it.
 */
const {
  open: terminalOpen,
  height: terminalHeight,
  toggle: toggleTerminal,
  bindShortcut: bindTerminalShortcut,
} = useWorkTerminal()

bindTerminalShortcut()

const prompt = ref('')
const creating = ref(false)

/**
 * The box, and the one key that puts the cursor in it.
 *
 * `n` from anywhere lands here with `?new=1`, which this clears again the moment
 * it has focused — otherwise the second `n` is a navigation to the URL you are
 * already on and nothing happens, which is the worst way for a shortcut to fail.
 */
const promptBox = ref<HTMLTextAreaElement | null>(null)
const route = useRoute()

async function focusComposer() {
  // The composer only exists on the Start view, so `n` from History has to move
  // you there first rather than focusing nothing.
  pane.value = 'start'
  await nextTick()
  promptBox.value?.focus()
  promptBox.value?.scrollIntoView({ block: 'center' })
}

const existingRef = ref('')
const startingFrom = ref(false)

/**
 * The second way in, folded away until it is wanted.
 *
 * Starting from a branch or a pull request is a real entry point, but it is the
 * rarer one, and left open it costs a field, a button and a paragraph of
 * explanation above every session on the page. One word in the hint line opens
 * it, and the explanation comes with it rather than sitting there permanently.
 */
const showExisting = ref(false)

/**
 * Starting several at once is its own mode rather than a clever reading of the
 * main box. One instruction per line is only obvious once you have been told;
 * inferred from a multi-line paste it would turn one carefully written prompt
 * into eight sessions and eight checkouts, which is not a mistake anyone wants
 * to discover afterwards.
 */
/**
 * How much the new session may do, chosen before it starts.
 *
 * Trust used to be a thing you set on a session that was already running, so
 * every session's *first* turn — usually the longest, and the one that does the
 * bulk of the work — ran at "Edit files" no matter what you meant. Rituals have
 * always chosen upfront; sessions were the odd ones out.
 *
 * Remembered, because somebody who works in Auto works in Auto, and re-picking
 * it on every session is the kind of small tax that gets a feature ignored.
 */
const TRUST_KEY = 'agents-ui:session-trust'
const startTrust = ref<TrustLevel>(DEFAULT_TRUST)

onMounted(() => {
  const stored = localStorage.getItem(TRUST_KEY)
  if (TRUST_CHOICES.some(c => c.value === stored)) startTrust.value = stored as TrustLevel
})

function chooseTrust(value: TrustLevel) {
  startTrust.value = value
  try {
    localStorage.setItem(TRUST_KEY, value)
  } catch {
    // A full or blocked store costs the memory, not the choice.
  }
}

/**
 * Which agent the session runs on, chosen beside the trust it is given and for
 * the same reason: both are decided before the first turn, because the first
 * turn is the one that does the work.
 *
 * Not remembered in `localStorage` like the trust level, and that is deliberate.
 * The answer to "which agent" belongs to the repository — a project whose suite
 * only one agent reliably passes is a real thing — so the default comes from the
 * server, per repository, and this only overrides it for the session in front of
 * you. See `projectProvider.ts`.
 */
const { available: agents, hasChoice: canChooseAgent, shortfalls, fetchAll: fetchProviders } = useProviders()
const startProvider = ref<string | null>(null)

onMounted(() => void fetchProviders())

/** What the picked agent cannot do, said before the worktree is cut. */
const agentShortfalls = computed(() => startProvider.value ? shortfalls(startProvider.value) : [])

/**
 * Race the agents rather than picking one: one instruction, one session per
 * agent, and whichever passes `make check` is the one worth landing.
 *
 * Not remembered, unlike the trust level. Racing costs a session per agent for
 * one piece of work, and a setting that quietly stayed on would turn every
 * instruction typed afterwards into N of them. It is a decision per piece of
 * work, so it is asked per piece of work.
 */
const racing = ref(false)

/** Turning it on makes the single-agent choice meaningless, so it goes. */
watch(racing, (on) => {
  if (on) startProvider.value = null
})

const racingAgents = computed(() => agents.value.map(a => a.label).join(' vs '))

/**
 * The command list, in the box a session starts from.
 *
 * The session composer has had it since it shipped; this box had nothing, and
 * it is the one place where the *first* turn is written — the turn that does
 * the bulk of the work. `/code-review` typed here went off as literal text and
 * came back having guessed at it, which is the failure this removes.
 *
 * Same component, same keys and the same rule as the session composer, so the
 * habit carries between the two boxes. See `utils/slashCommands.ts`.
 */
const { commands, fetchAll: fetchCommands } = useCommands()
const paletteOpen = ref(false)
const palette = ref<{ move: (d: number) => void; choose: () => void; hasMatches: boolean } | null>(null)

/**
 * Which agent this instruction will actually reach.
 *
 * `Default` means whatever this repository is set to in Settings, so the answer
 * is not readable off the picker alone — it comes from the same endpoint the
 * setting is written through, and the server resolves a session the same way.
 */
const { state: projectProvider, load: loadProjectProvider } = useProjectProvider()
const effectiveProvider = computed(() => startProvider.value ?? projectProvider.value?.provider ?? 'claude')

// Another repository is another default agent. The command lists themselves are
// refetched app-wide on a switch; this answer is not, so it is asked again here.
watch(workingDir, () => { void loadProjectProvider() })

/**
 * Whether the session being started can use the library at all.
 *
 * Commands, skills and agents are Claude Code's own on-disk formats; Cursor has
 * its own and they do not share a schema, so offering `/code-review` to a
 * Cursor session offers something that resolves to nothing. A race is every
 * agent at once, which is the same problem for whichever of them is not Claude
 * Code — so it is not offered there either. This is the session page's
 * `hasLibrary`, asked before the session exists.
 */
const hasLibrary = computed(() => !racing.value && effectiveProvider.value === 'claude')

/** An agent that cannot use them takes the list away rather than leaving it up. */
watch(hasLibrary, (can) => { if (!can) paletteOpen.value = false })

const commandQuery = computed(() => slashQuery(prompt.value))

watch(prompt, () => {
  if (!hasLibrary.value) {
    paletteOpen.value = false
    return
  }
  paletteOpen.value = offersCommands(prompt.value)
})

function insertCommand(invocation: string) {
  prompt.value = `${invocation} `
  paletteOpen.value = false
  // Back in the box with the cursor after the space, because what follows the
  // command is usually the argument you opened the list to write.
  nextTick(() => promptBox.value?.focus())
}

/** The box owns the keys while the list is open, so it can drive it. */
function onPromptKey(event: KeyboardEvent) {
  // Enter here means "pick the highlighted command", which has to win over
  // starting — otherwise choosing one would cut a worktree for a half-typed
  // instruction.
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
  onCreate()
}

const batchMode = ref(false)
/**
 * The box that takes images is the single-session one on Start. Elsewhere on
 * this page there is nowhere for a dropped file to go, and holding it invisibly
 * until somebody happens to open that box is how a screenshot gets attached to
 * a session nobody meant to attach it to — or silently thrown away.
 *
 * The batch box is deliberately not it: it splits on lines, one session each,
 * and there is no answer to which of five sessions an image belongs to.
 */
const takesImages = computed(() => pane.value === 'start' && !batchMode.value)

function onImageDragOver(event: DragEvent) {
  if (takesImages.value) onDragOver(event)
}

function onImageDrop(event: DragEvent) {
  if (takesImages.value) onDrop(event)
}

// Anything held when the box goes away goes with it, rather than reappearing
// on something else later.
watch(takesImages, (takes) => { if (!takes) clearAttachments() })
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
    const result = await createMany(batchPrompts.value, undefined, startTrust.value, startProvider.value)
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

    // A branch can only be checked out once, so asking for one that already has
    // a workspace lands in that workspace rather than failing beside it. Said,
    // because arriving in a conversation that already has history is not the
    // same as starting one.
    if (session.how === 'continued' || session.how === 'adopted') {
      toast.add({
        title: session.how === 'continued' ? 'Continued the session on that branch' : 'Reused the workspace on that branch',
        description: session.note ?? 'A workspace already had it checked out, so this went there.',
        color: 'info',
      })
    }

    router.push(`/sessions/${session.id}`)
  } catch (e) {
    // The one refusal that names somewhere to go: a session mid-turn on that
    // branch. Nothing here interrupts it, but the person asked about it.
    const held = errorSessionId(e)
    if (held) {
      toast.add({ title: 'Already working on that branch', description: errorMessage(e), color: 'warning' })
      router.push(`/sessions/${held}`)
      return
    }

    toast.add({ title: 'Could not start there', description: errorMessage(e), color: 'error' })
  } finally {
    startingFrom.value = false
  }
}

const adopting = ref<string | null>(null)
const showTranscripts = ref(false)

/**
 * The ones offered, which is also the number the header says.
 *
 * The list has always stopped at five. Folding it put a count on the header,
 * and counting all of them there would have promised twelve and opened onto
 * five — a disclosure that lies about what is behind it is worse than no count.
 */
const recentTranscripts = computed(() => transcripts.value.slice(0, 5))

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
  // The sessions, the runs, the worktrees and the projects are the layout's — it
  // owns them because the rail needs them on every route of this surface, not
  // just this one. These are only ever read here.
  //
  // The commands and the repository's agent are for the box: the list has to be
  // there before the first `/`, and which agent this starts on decides whether
  // the list is offered at all.
  await Promise.all([fetchTranscripts(), countRemoved(), fetchCommands(), loadProjectProvider()])
})

const imageInput = ref<HTMLInputElement | null>(null)

/** ⌘V of a screenshot into the box, the same gesture as everywhere else. */
function onPromptPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []).filter(file => imageMediaType(file))
  if (!files.length) return

  event.preventDefault()
  attachImages(files)
}

function onPickImages(event: Event) {
  const picker = event.target as HTMLInputElement
  const files = Array.from(picker.files ?? [])
  if (files.length) attachImages(files)
  picker.value = ''
}

async function onCreate() {
  const value = prompt.value.trim()
  // A screenshot on its own says what to look at, which is enough to start on.
  if ((!value && !attachments.value.length) || creating.value) return

  creating.value = true
  try {
    if (racing.value) {
      const result = await race(value, undefined, startTrust.value, attachments.value)
      prompt.value = ''
      clearAttachments()
      await fetchWorktrees()

      toast.add({
        title: `${result.started.length} agents on it`,
        description: result.failed.length
          ? `${result.failed.length} could not start — the rest are working.`
          : 'Each in its own workspace. Whichever passes the checks is the one to land.',
        color: result.failed.length ? 'warning' : 'success',
      })

      // Into the first one, which is where its own race band lists the others.
      const first = result.started[0]
      if (first) await router.push(`/sessions/${first.id}`)
      return
    }

    const session = await create(value, undefined, startTrust.value, attachments.value, startProvider.value)
    prompt.value = ''
    clearAttachments()
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

/**
 * A project that is not a git repository.
 *
 *   project/          picked, because the specs are half the work
 *     app/            the repository
 *     specs/
 *
 * Every session here is refused — a worktree has to be a worktree of
 * something — but the page said "branches from project/ and starts work
 * straight away" right up until you pressed the button. The repository it
 * wants is one directory down and plainly visible, so it offers that instead,
 * and remembers the folder it came out of so the specs stay readable.
 */
const activeProject = computed(() => projects.value.find(p => p.path === workingDir.value) ?? null)
const notARepo = computed(() => Boolean(activeProject.value && !activeProject.value.isRepo))

const nestedRepos = ref<{ path: string; name: string; depth: number }[]>([])
const lookingInside = ref(false)
const adoptingRepo = ref<string | null>(null)

watch([notARepo, workingDir], async () => {
  nestedRepos.value = []
  if (!notARepo.value || !workingDir.value) return

  lookingInside.value = true
  try {
    const result = await $fetch<{ repos: { path: string; name: string; depth: number }[] }>(
      '/api/projects/nested',
      { query: { dir: workingDir.value } },
    )
    nestedRepos.value = result.repos
  } catch {
    // No suggestion is a worse page, not a broken one.
  } finally {
    lookingInside.value = false
  }
}, { immediate: true })

/** Switch to the repository inside, keeping its parent readable from sessions. */
async function useRepoInside(path: string) {
  adoptingRepo.value = path
  try {
    await addProject(path, { contextDir: workingDir.value ?? undefined })
    toast.add({
      title: 'Switched to the repository inside',
      description: 'Sessions branch from here, and the folder around it stays readable.',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: 'Could not switch to it', description: errorMessage(e), color: 'error' })
  } finally {
    adoptingRepo.value = null
  }
}

/**
 * Whether you have already asked for this.
 *
 * Three pairs of near-identical sessions here, each pair twenty-one minutes
 * apart, the second of each retyped from memory with typos the first does not
 * have. Somebody came back, could not tell the work was already underway, and
 * asked again — which costs two agents, two worktrees, and two sets of changes
 * to the same files that will conflict whenever the second one is merged.
 *
 * It never blocks. Asking twice on purpose is legitimate; not knowing is the
 * only thing being fixed.
 */
const duplicateOf = computed(() => findSimilar(prompt.value, sessions.value, workingDir.value))

/** The same question for each line of a batch, which is where this happened. */
const batchDuplicates = computed(() =>
  batchPrompts.value
    .map(line => ({ line, hit: findSimilar(line, sessions.value, workingDir.value) }))
    .filter((entry): entry is { line: string; hit: NonNullable<typeof entry.hit> } => Boolean(entry.hit)),
)

watch(() => route.query.new, (wants) => {
  if (!wants) return
  focusComposer()
  router.replace({ query: { ...route.query, new: undefined } })
}, { immediate: true })

/**
 * The status chips, and what they filter.
 *
 * Only the History statuses are on offer now: the in-flight ones belong to the
 * rail, which groups by them rather than filtering on them. A chip here for
 * "running" would filter a list that, by construction, has nothing running in
 * it.
 */
function chooseStatus(value: WorkStatus) {
  status.value = status.value === value ? null : value
}

/**
 * What has finished, filtered together.
 *
 * Runs whose source is a session are dropped by `buildWorkList` — that session
 * is its own row. `useRuns` is asked for the rest, and the search reaches the
 * server because that list is capped there; searching one loaded page of it
 * would silently miss everything past the cap.
 */
/**
 * Looking at what has been taken off the list, rather than at the list.
 *
 * A removal that cannot be seen or undone is a deletion wearing a softer word,
 * and this one genuinely is not: the run is still in the log and still counted by
 * ritual health and the spend total. So there has to be somewhere the tidied rows
 * are, and a way back from it.
 */
const REMOVED_QUERY: RunQuery = { exclude: ['session'], limit: 50, hidden: 'only' }

const viewingRemoved = ref(false)

const status = ref<WorkStatus | null>(null)
const origin = ref<WorkOrigin | null>(null)
const search = ref('')

const hasFilters = computed(() => Boolean(status.value || origin.value || search.value.trim()))

function clearFilters() {
  status.value = null
  origin.value = null
  search.value = ''
  void applyRunsQuery()
}

/**
 * What the runs half is asked for, published to the poll.
 *
 * `runsQuery` is shared state because the poll in `useWorkList` fires every four
 * seconds and this page has two views of the same list. A poll hard-coded to the
 * ordinary query would wipe the removed-rows view out from under the reader on
 * the next tick.
 */
async function applyRunsQuery() {
  const base = viewingRemoved.value ? REMOVED_QUERY : RUNS_QUERY
  const q = search.value.trim()
  runsQuery.value = q ? { ...base, q } : { ...base }
  await fetchRuns(runsQuery.value)
}

/** This view's pile, unfiltered, so the chip counts describe it rather than a slice. */
const allWork = computed(() => onTab(
  buildWorkList({ sessions: visibleSessions.value, runs: runs.value }),
  'history',
))

const work = computed(() => onTab(
  buildWorkList(
    { sessions: visibleSessions.value, runs: runs.value },
    { status: status.value, origin: origin.value, query: search.value },
  ),
  'history',
))

const statusChips = computed(() => {
  const counts = statusCounts(allWork.value)
  return WORK_STATUS
    .filter(s => tabOf(s.value) === 'history')
    .map(s => ({ ...s, count: counts[s.value] }))
    // A chip with nothing behind it is a dead end, unless it is the one you have
    // already pressed — removing that under your cursor is worse.
    .filter(s => s.count > 0 || status.value === s.value)
})

/**
 * Taking rows off the list.
 *
 * "Remove" and not "delete", and the difference is the whole design. Runs are
 * what `failingStreak`, the spend total and the night-shift figures are computed
 * from — so deleting a failed ritual run would reset the streak and make a broken
 * ritual look healthy. Clearing a cluttered list must never be a way to silence
 * the warning this app exists to give, so nothing is deleted: the row leaves the
 * list and every other reading of history is untouched.
 *
 * Which is why undo is offered rather than a confirmation. A reversible action
 * asking "are you sure?" spends the reader's attention on a decision that costs
 * nothing to get wrong.
 */
async function removeRuns(items: WorkItem[], label: string) {
  const ids = items.map(item => item.runId).filter((id): id is string => Boolean(id))
  if (!ids.length) return

  try {
    const { changed, skipped } = await hideRuns(ids, true)
    await Promise.all([
      applyRunsQuery(),
      // Without this the "N removed" way back stays at whatever it was on load,
      // and the only route to an undo is a toast that expires.
      countRemoved(),
    ])

    toast.add({
      title: changed.length === 1 ? `Removed ${label}` : `Removed ${changed.length} rows`,
      description: skipped.length
        ? `${skipped.length} still running, so ${skipped.length === 1 ? 'it was' : 'they were'} left alone. `
          + 'Nothing was deleted — spend and ritual health still count all of it.'
        : 'Nothing was deleted. Spend and ritual health still count it.',
      color: 'success',
      actions: [{
        label: 'Undo',
        onClick: () => void restoreRuns(changed),
      }],
    })
  } catch (e) {
    toast.add({ title: 'Could not remove that', description: errorMessage(e), color: 'error' })
  }
}

async function restoreRuns(ids: string[]) {
  if (!ids.length) return
  try {
    await hideRuns(ids, false)
    await Promise.all([applyRunsQuery(), countRemoved()])
  } catch (e) {
    toast.add({ title: 'Could not put that back', description: errorMessage(e), color: 'error' })
  }
}

/**
 * The rows a "clear" would take, which is only ever what you can currently see.
 *
 * Scoped to the filtered list on purpose: a button that clears more than is on
 * screen is one nobody can predict the effect of. Running rows are never in it —
 * they are not finished, and removing one reads as cancelling it.
 */
const clearable = computed(() => (viewingRemoved.value ? [] : removableRuns(work.value)))

async function clearVisible() {
  await removeRuns(clearable.value, 'it')
  confirmingClear.value = false
}

const confirmingClear = ref(false)

/** How many rows are sitting in the removed view, so there is a way back to them. */
const removedCount = ref(0)

async function countRemoved() {
  try {
    const rows = await $fetch<{ id: string }[]>('/api/runs', {
      query: { hidden: 'only', exclude: 'session', limit: 100 },
    })
    removedCount.value = rows.length
  } catch {
    // A count that cannot be read is not worth breaking the page over.
  }
}

async function toggleRemovedView() {
  viewingRemoved.value = !viewingRemoved.value
  confirmingClear.value = false
  await applyRunsQuery()
  if (!viewingRemoved.value) await countRemoved()
}

/** The session behind a row, when the row is one. `null` means it is a run. */
function sessionFor(item: WorkItem): Session | null {
  if (item.origin !== 'session') return null
  const id = item.key.slice('session:'.length)
  return sessions.value.find(s => s.id === id) ?? null
}

/**
 * Which of the rows on screen produced nothing, for the bulk clear-up. Taken
 * from what is visible rather than from a whole project, so the button never
 * closes something you cannot see.
 */
const emptySessionIds = computed(() =>
  work.value
    .filter(item => item.outcome === 'Nothing came of it')
    .map(item => item.key.slice('session:'.length)),
)

// Typing is not a request per keystroke, but the query has to reach the server.
let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => { void applyRunsQuery() }, 200)
})
onUnmounted(() => { if (searchDebounce) clearTimeout(searchDebounce) })

/**
 * Clearing out what came to nothing.
 *
 * Two steps, on purpose: this deletes branches and whole checkouts, and it
 * does several at once. The server checks each one again before touching it,
 * so a session that gained changes since this page loaded survives regardless
 * of what was clicked here.
 */
const confirmingClose = ref<string | null>(null)
const closing = ref(false)

async function closeEmpty(key: string, ids: string[]) {
  closing.value = true
  try {
    const result = await $fetch<{ closed: string[]; message: string }>('/api/sessions/close-empty', {
      method: 'POST',
      body: { ids },
    })
    confirmingClose.value = null
    await fetchAll()
    void fetchWorktrees()
    toast.add({
      title: result.closed.length ? 'Cleared' : 'Nothing was closed',
      description: result.message,
      color: result.closed.length ? 'success' : 'warning',
    })
  } catch (e) {
    toast.add({ title: 'Could not close those', description: errorMessage(e), color: 'error' })
  } finally {
    closing.value = false
  }
}
</script>

<template>
  <div
    ref="dropZone"
    class="relative"
    @dragover="onImageDragOver"
    @dragleave="onDragLeave"
    @drop="onImageDrop"
  >
    <!--
      The whole page, not just the box: a file dropped anywhere else is the
      browser navigating away from the app.
    -->
    <div
      v-if="dragOver"
      class="fixed inset-3 z-50 pointer-events-none rounded-xl flex items-center justify-center fs-sm font-medium"
      style="background: var(--accent-muted); border: 2px dashed var(--accent); color: var(--text-primary);"
    >
      Drop an image to start a session with it
    </div>
    <PageHeader title="Work" measure>
      <template #trailing>
        <!--
          Counts what is on screen, which is only ever a list on History. On
          Start it would be a number over a composer, describing something else.
        -->
        <span v-if="pane === 'history' && allWork.length" class="type-mono-meta">{{ allWork.length }}</span>
        <SessionStatus
          v-if="needsYouCount"
          activity="awaiting-permission"
          compact
        />

        <!--
          A shell in the project you already have selected, without going through
          a session to get one. Hidden when there is no project, because there
          would be nowhere to open it.
        -->
        <UButton
          v-if="workingDir"
          icon="i-lucide-square-terminal"
          size="xs"
          variant="ghost"
          :color="terminalOpen ? 'primary' : 'neutral'"
          :title="`${terminalOpen ? 'Hide' : 'Open'} terminal (Ctrl+\`)`"
          @click="toggleTerminal"
        />
      </template>
    </PageHeader>

    <!--
      Three views, because they are three jobs — and none of them is the list of
      what is in flight any more, because that is the rail.

      Start is where work begins: the composer, the other two ways in, and the
      workspaces already cut. History is a thing you read: last night as a
      picture, and every finished row underneath it. Ledger is the same history
      with the money against it — what a merge cost, by ritual, agent, model and
      repository — and it sits here rather than on a page of its own precisely so
      its headline can be checked against the rows one tab away.

      The first two used to be "In flight" and "History", and the first of those
      was the in-flight rows themselves. Keeping the name once the rows had moved
      to the rail would have left a tab called "In flight" with nothing in flight
      on it. What has *not* changed is where the line falls: `TAB_STATUSES` and
      `isSettled` still decide what counts as finished with, and the rail takes
      everything on the other side of it.
    -->
    <div class="page-container page-container--measure pt-3">
      <div class="flex items-center gap-0.5 p-0.5 rounded-md w-fit" style="background: var(--input-bg); border: 1px solid var(--border-subtle);">
        <button
          v-for="option in [
            // Start has nothing to count — it is a composer, not a list.
            { value: 'start' as const, label: 'Start', count: null as number | null },
            { value: 'history' as const, label: 'History', count: tabCounts.history },
            // Neither does the ledger: a count here would be a second, quieter
            // answer to the question the tab itself is about.
            { value: 'ledger' as const, label: 'Ledger', count: null as number | null },
          ]"
          :key="option.value"
          class="px-2.5 py-1 rounded fs-mono font-medium transition-all focus-ring flex items-center gap-1.5"
          :style="{
            background: pane === option.value ? 'var(--accent-muted)' : 'transparent',
            color: pane === option.value ? 'var(--accent)' : 'var(--text-disabled)',
          }"
          @click="pane = option.value"
        >
          {{ option.label }}
          <span v-if="option.count" class="font-mono fs-micro opacity-70">{{ option.count }}</span>
        </button>
      </div>
    </div>

    <!--
      Ordered by what you came to do: start something, then see what happened to
      what is already going.

      Landing is not on this page. The merge train used to sit here and is nine
      rows tall, so on a 1512×810 window both the box you start work in and every
      session were below the fold — and it was answering a different question
      from everything around it. It lives on /land now, next to the pull requests
      that ask the same one.

      The paragraph explaining what a session is went earlier. Permanent
      onboarding text on a page you open several times a day is a sign the labels
      are not trusted; "Branches from …, its own workspace, its own branch" is
      already said under the composer, where it is doing something.
    -->
    <div class="page-container page-container--measure py-4 flex flex-col gap-5">
      <!--
        Said before the button, not after it. Pressing "Start session" here
        used to be the first anyone heard that this folder cannot be branched,
        having just been told it would be — and the repository it needs is
        usually sitting one directory down.
      -->
      <div
        v-if="notARepo && pane === 'start'"
        class="order-1 rounded-lg p-4 space-y-3"
        style="background: var(--warning-wash); border: 1px solid var(--warning-edge);"
      >
        <div class="flex items-start gap-2.5">
          <UIcon name="i-lucide-folder-git-2" class="size-4 shrink-0 mt-0.5 ink-warn" />
          <div class="space-y-1">
            <div class="fs-sm font-medium text-body">
              <span class="font-mono">{{ displayPath }}</span> is not a git repository
            </div>
            <p class="fs-mono leading-relaxed text-label">
              Sessions work on their own copy of a repository, so there has to be one to copy.
            </p>
          </div>
        </div>

        <div v-if="lookingInside" class="fs-mono text-meta">Looking for one inside…</div>

        <div v-else-if="nestedRepos.length" class="space-y-2">
          <p class="fs-mono leading-relaxed text-label">
            {{ nestedRepos.length === 1 ? 'There is one inside' : 'There are some inside' }}.
            Sessions branch from the repository, and everything around it stays readable —
            so notes and specs beside it are still there to work from.
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="repo in nestedRepos"
              :key="repo.path"
              :label="`Use ${repo.name}`"
              icon="i-lucide-corner-down-right"
              size="xs"
              :loading="adoptingRepo === repo.path"
              :disabled="Boolean(adoptingRepo)"
              @click="useRepoInside(repo.path)"
            />
          </div>
        </div>

        <p v-else class="fs-mono leading-relaxed text-label">
          Nothing inside it is one either. Pick a repository in the sidebar, or run
          <span class="font-mono">git init</span> here.
        </p>
      </div>

      <!-- Start a session -->
      <div v-if="workingDir && pane === 'start'" class="order-3 space-y-1.5">
        <!-- One session, told what to do in the same breath -->
        <template v-if="!batchMode">
          <div class="flex gap-2 items-start relative">
            <!--
              Sits above the box, where the instruction being typed still shows.
              The same list the session composer opens, in the box where the
              first turn is written.
            -->
            <div v-if="paletteOpen && hasLibrary" class="absolute bottom-full left-0 right-0 mb-2 z-10">
              <CommandPalette
                ref="palette"
                :commands="commands"
                :query="commandQuery"
                @select="insertCommand"
                @close="() => { paletteOpen = false }"
              />
            </div>
            <textarea
              ref="promptBox"
              v-model="prompt"
              rows="2"
              class="field-input flex-1 resize-y"
              :placeholder="hasLibrary
                ? 'What should this session do? Type / for commands. Enter to start, Shift+Enter for a new line.'
                : 'What should this session do? Enter to start, Shift+Enter for a new line.'"
              :disabled="creating"
              @keydown="onPromptKey"
              @paste="onPromptPaste"
            />
            <input
              ref="imageInput"
              type="file"
              multiple
              :accept="IMAGE_MEDIA_TYPES.join(',')"
              class="hidden"
              @change="onPickImages"
            >
            <UButton
              icon="i-lucide-paperclip"
              size="sm"
              variant="ghost"
              color="neutral"
              :disabled="creating"
              title="Attach an image — or paste or drop one"
              aria-label="Attach an image"
              @click="imageInput?.click()"
            />
            <!--
              For the command you do not know exists. Not offered when the
              session would not start on Claude Code: a button opening a list of
              things that resolve to nothing is worse than no button.
            -->
            <UButton
              v-if="hasLibrary"
              icon="i-lucide-slash"
              size="sm"
              variant="ghost"
              color="neutral"
              :disabled="creating"
              :title="`${commands.length} commands available`"
              aria-label="Show commands"
              @click="() => { paletteOpen = !paletteOpen }"
            />
            <UButton
              label="Start session"
              icon="i-lucide-plus"
              size="sm"
              :loading="creating"
              :disabled="!prompt.trim() && !attachments.length"
              @click="onCreate"
            />
          </div>

          <!-- What the first turn will be looking at -->
          <ChatAttachmentStrip
            :attachments="attachments"
            removable
            @remove="removeAttachment"
          />
          <!--
            One line for what was three paragraphs: where it branches from, and
            the two other ways in. Explaining every path permanently, above a
            page you open several times a day, pushed the work itself off the
            first screen — and the labels on the controls already say most of it.
          -->
          <p class="type-meta flex items-center gap-x-2 gap-y-0.5 flex-wrap">
            <span>
              Branches from <span class="font-mono">{{ displayPath }}</span> into its own workspace.
            </span>
            <button class="underline underline-offset-2 hover:text-label" @click="batchMode = true">
              Start several
            </button>
            <span class="ink-4">·</span>
            <button
              class="underline underline-offset-2 hover:text-label"
              @click="showExisting = !showExisting"
            >
              {{ showExisting ? 'Hide' : 'Start from a branch or PR' }}
            </button>
          </p>

          <!--
            Not a warning and not a block. A second go at something that went
            badly is a normal thing to want; not knowing the first one exists
            is not.
          -->
          <p v-if="duplicateOf" class="type-meta flex items-center gap-1.5 flex-wrap">
            <UIcon name="i-lucide-copy" class="size-3 shrink-0 ink-warn" />
            <span style="color: var(--warning);">You already asked for this.</span>
            <NuxtLink
              :to="`/sessions/${duplicateOf.session.id}`"
              class="underline underline-offset-2 hover:text-label"
            >{{ duplicateOf.session.title }}</NuxtLink>
            <span>— {{ relativeTime(duplicateOf.session.updatedAt) }}. Starting another is fine.</span>
          </p>
        </template>

        <!-- Several sessions, one per line, counted before anything happens -->
        <template v-else>
          <textarea
            v-model="batchText"
            rows="5"
            class="field-input w-full resize-y font-mono fs-sm"
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
            <span v-if="tooMany" class="type-meta ink-error">
              {{ batchPrompts.length }} is too many — {{ MAX_AT_ONCE }} at once is the limit.
              Each one is a full checkout.
            </span>
            <span v-else-if="startingBatch" class="type-meta">
              Cutting a workspace each. They start working as they are made.
            </span>
          </div>

          <!--
            Where it actually happened: a batch of three, then the same three
            again twenty minutes later, retyped rather than re-run.
          -->
          <div v-if="batchDuplicates.length && !startingBatch" class="space-y-1">
            <p class="type-meta ink-warn">
              {{ batchDuplicates.length === 1 ? 'One of these' : `${batchDuplicates.length} of these` }}
              you have already asked for:
            </p>
            <p
              v-for="entry in batchDuplicates"
              :key="entry.line"
              class="type-meta flex items-center gap-1.5 flex-wrap pl-3"
            >
              <span class="truncate max-w-[22rem]">{{ entry.line }}</span>
              <span>→</span>
              <NuxtLink
                :to="`/sessions/${entry.hit.session.id}`"
                class="underline underline-offset-2 hover:text-label"
              >{{ entry.hit.session.title }}</NuxtLink>
              <span>{{ relativeTime(entry.hit.session.updatedAt) }}</span>
            </p>
          </div>
        </template>

        <!--
          Chosen here rather than after the fact, because the first turn is the
          one that does the work. Applies to a batch too: twenty sessions is
          exactly when you do not want to set this twenty times.
        -->
        <div class="flex items-center gap-3 flex-wrap pt-0.5">
          <div class="pill-picker">
            <button
              v-for="choice in TRUST_CHOICES"
              :key="choice.value"
              type="button"
              class="pill-picker__option"
              :class="{ 'pill-picker__option--active': startTrust === choice.value }"
              :title="choice.hint"
              @click="chooseTrust(choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>
          <!--
            Only the one with consequences says anything. Each pill carries its
            own hint on hover, so spelling all three out in a sentence beside
            them was a line of text that never changed and never told you
            anything the label had not.
          -->
          <!--
            Amber rather than accent. Accent is this app's interactive colour —
            every link and every pressable thing is that blue — so a sentence in
            it that cannot be clicked is a false affordance, and this one sat
            directly between two rows of controls. It is a caution about the
            option just chosen, and caution has its own token.
          -->
          <span
            v-if="startTrust === 'full'"
            class="type-detail flex items-center gap-1.5"
            style="color: var(--warning);"
          >
            <UIcon name="i-lucide-zap" class="size-3.5 shrink-0" />
            Runs commands without asking, sandboxed, in its own workspace.
          </span>

          <!--
            Which agent, offered only when this machine has more than one. A
            picker with a single option is a control that cannot do anything, and
            on a machine with only Claude Code installed that is what it would
            be. `Default` leaves it to whatever this repository was set to in
            Settings, so the common case is one fewer decision.
          -->
          <div v-if="canChooseAgent && !racing" class="pill-picker">
            <button
              type="button"
              class="pill-picker__option"
              :class="{ 'pill-picker__option--active': startProvider === null }"
              title="Whatever this repository is set to in Settings"
              @click="startProvider = null"
            >
              Default
            </button>
            <button
              v-for="agent in agents"
              :key="agent.id"
              type="button"
              class="pill-picker__option"
              :class="{ 'pill-picker__option--active': startProvider === agent.id }"
              @click="startProvider = agent.id"
            >
              {{ agent.label }}
            </button>
          </div>

          <!--
            The other thing you can do with more than one agent: stop choosing.
            Offered beside the picker rather than as a mode of its own, because it
            is an answer to the same question — which agent should do this — and
            "all of them, and I will keep whichever passes" is a legitimate one.
          -->
          <label
            v-if="canChooseAgent && !batchMode"
            class="flex items-center gap-2 cursor-pointer type-detail"
            :title="`Starts one session per agent on the same instruction: ${racingAgents}`"
          >
            <input v-model="racing" type="checkbox" class="shrink-0">
            <span :style="racing ? { color: 'var(--accent)' } : undefined">Race the agents</span>
          </label>
        </div>

        <!--
          Said before the button, because it is the cost of pressing it: a race is
          a session per agent for one piece of work. Worth it against an afternoon
          spent on a diff that was never going to pass, and not worth it by
          accident — which is why the checkbox above is not remembered.
        -->
        <p
          v-if="racing"
          class="type-detail flex items-start gap-1.5"
          style="color: var(--accent);"
        >
          <UIcon name="i-lucide-flag" class="size-3.5 shrink-0 mt-0.5" />
          <span>
            {{ agents.length }} workspaces, one per agent — {{ racingAgents }}. Each runs the
            same instruction and its own <code>make check</code>; whichever passes is the one
            worth landing. It costs {{ agents.length }}× the tokens of one session.
          </span>
        </p>

        <!--
          What the chosen agent cannot do, before the worktree is cut rather than
          after two turns. The one that actually bites is permissions: a session
          on an agent that cannot stop and ask does not wait to be let through,
          it is refused and carries on having done less — which reads like a turn
          that simply went badly.
        -->
        <ul
          v-if="agentShortfalls.length"
          class="type-detail space-y-0.5"
          style="color: var(--warning);"
        >
          <li v-for="line in agentShortfalls" :key="line" class="flex items-start gap-1.5">
            <UIcon name="i-lucide-info" class="size-3.5 shrink-0 mt-0.5" />
            <span>{{ line }}</span>
          </li>
        </ul>

        <!-- Or start on something that already exists -->
        <div v-if="!batchMode && showExisting" class="space-y-1.5 pt-1">
          <div class="flex gap-2">
            <!--
              Open pull requests and recent branches, offered rather than
              remembered. Free text is kept because the useful paste is often a
              URL from somebody's message, for a pull request on a fork this
              checkout has no remote for.
            -->
            <RefPicker
              v-model="existingRef"
              class="flex-1"
              input-class="field-input"
              placeholder="Pick a pull request or branch, or paste a URL"
              with-pull-requests
              :disabled="startingFrom"
              @enter="onStartFrom"
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
          <p class="type-meta">
            Checks the branch out in its own workspace. What you change from there is
            this session's, shown separately from what the branch already had.
          </p>
        </div>
      </div>

      <div
        v-else-if="pane === 'start'"
        class="rounded-md px-4 py-3 flex items-start gap-3"
        style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
      >
        <UIcon name="i-lucide-folder" class="size-4 shrink-0 mt-0.5 ink-accent" />
        <span class="type-detail ink-2">
          Pick a project folder in the sidebar to start a session. Sessions branch from a git repository.
        </span>
      </div>

      <!--
        Work already started in the terminal, which this can pick up.

        Folded, because five dashed rows and a paragraph explaining them is a
        third of the first screen spent on something you reach for occasionally —
        and it sat between the composer and the actual list of work. The header
        still says how many are there, which is the part worth seeing every time.
      -->
      <div v-if="workingDir && transcripts.length && pane === 'start'" class="order-4">
        <button
          class="flex items-center gap-2 py-1 focus-ring rounded"
          @click="showTranscripts = !showTranscripts"
        >
          <UIcon
            :name="showTranscripts ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-3 ink-4"
          />
          <span class="text-section-label">Continue from your terminal</span>
          <span class="type-mono-meta">{{ recentTranscripts.length }}</span>
        </button>

        <div v-if="showTranscripts" class="space-y-2 pt-2">
          <p class="type-meta">
            Conversations you had with Claude Code here. Continuing one resumes it in a
            clean copy of the branch, so what it does next is reviewable before it lands —
            uncommitted work from the terminal stays where it is.
          </p>
          <div
            v-for="transcript in recentTranscripts"
            :key="transcript.sdkSessionId"
            class="flex items-center gap-3 px-3 py-2.5 rounded-md"
            style="border: 1px dashed var(--border-subtle);"
          >
            <UIcon name="i-lucide-terminal" class="size-4 shrink-0 ink-4" />
            <div class="flex-1 min-w-0">
              <div class="type-strong truncate text-body">{{ transcript.title }}</div>
              <div class="type-mono-meta">
                {{ transcript.turnCount }} turn{{ transcript.turnCount === 1 ? '' : 's' }}
                · {{ relativeTime(transcript.updatedAt) }}
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
      </div>

      <div v-if="pane === 'history' && loading && !sessions.length" class="order-5 space-y-1">
        <SkeletonRow v-for="i in 3" :key="i" />
      </div>

      <!--
        Grouped by repository rather than split into "here" and "everything
        else". A session that is blocked is blocked whichever project it is in,
        and the old shape made that answerable only after switching.
      -->
      <!--
        One list of work, sessions and runs together.

        They used to be two pages, split by what *started* the work — which is a
        distinction the system cares about and nobody else does. What makes the
        merge possible without flattening either is two layers: the chips filter
        on the coarse question that is true of both, and each row still says
        where it got to in its own words. "Ready to land" and "Nothing came of
        it" are both done, and only a session can be either.

        A row is one piece of work you would act on. Activity listed one row per
        run, so a four-turn session appeared four times, competing with itself.
      -->
      <!--
        The night as a picture, before the same night as rows.

        It was on Now, where it was the third of five bands on a page whose job
        is "what needs me" — and a timeline of what already finished is the one
        thing that never does. Here it is the heading of the view it describes.
      -->
      <NightShift v-if="pane === 'history'" class="order-5" />

      <!--
        The same history, priced. Its own tab rather than a band under the rows:
        it reads a different window from them — its own selector, whole days
        rather than hours — and two windows arguing on one screen is how a page
        stops being trusted.
      -->
      <CostLedger v-if="pane === 'ledger'" class="order-5" />

      <!--
        Under it rather than beside it, and never folded into it: this machine's
        join and the team's appended lines are two populations, and one figure
        made of both would be a number nobody could reproduce. See the note at
        the top of `TeamLedger.vue`.
      -->
      <TeamLedger v-if="pane === 'ledger'" class="order-5" />

      <div v-if="pane === 'history'" class="order-5 space-y-3">
        <div class="flex items-center gap-1.5 flex-wrap">
          <button
            v-for="chip in statusChips"
            :key="chip.value"
            class="px-2.5 py-1 rounded-md fs-mono transition-all focus-ring"
            :style="{
              background: status === chip.value ? 'var(--accent-muted)' : 'transparent',
              color: status === chip.value ? 'var(--accent)' : 'var(--text-tertiary)',
            }"
            @click="chooseStatus(chip.value)"
          >
            {{ chip.label }}
            <span class="font-mono fs-micro ml-1 opacity-70">{{ chip.count }}</span>
          </button>

          <div class="w-px h-4 mx-1 shrink-0" style="background: var(--border-default);" />

          <button
            v-for="chip in WORK_ORIGIN"
            :key="chip.value"
            class="px-2.5 py-1 rounded-md fs-mono transition-all focus-ring flex items-center gap-1.5"
            :style="{
              background: origin === chip.value ? 'var(--accent-muted)' : 'transparent',
              color: origin === chip.value ? 'var(--accent)' : 'var(--text-tertiary)',
            }"
            @click="origin = origin === chip.value ? null : chip.value"
          >
            <UIcon :name="chip.icon" class="size-3 shrink-0" />
            {{ chip.label }}
          </button>

          <span v-if="status || origin" class="ml-auto">
            <UButton label="Clear" size="xs" variant="ghost" color="neutral" @click="clearFilters" />
          </span>
        </div>

        <!--
          Searching the whole log rather than the page of it that is loaded: the
          runs half is capped by the server, so the query has to reach it.
        -->
        <input
          v-model="search"
          class="field-search w-full"
          placeholder="Search work — what it was called, and what it did…"
        />

        <!--
          Tidying the list: one row rather than two.

          Closing what came to nothing and removing finished rows are the same
          job — keeping the list readable — and they were two stacked rows of
          sentence-plus-button sitting between the search box and the work. The
          counts moved into the button labels, which is where they were needed:
          "Close 5 empty" says as much as a sentence explaining that five of
          these left no changes behind, and the confirmation still spells out
          that branches go with them.

          Both are scoped to what is on screen — the filters decide it — because
          a clear whose reach you cannot predict is one nobody presses twice.
        -->
        <div
          v-if="pane === 'history' && (emptySessionIds.length || clearable.length || removedCount || viewingRemoved)"
          class="flex items-center justify-between gap-3 flex-wrap"
        >
          <p v-if="viewingRemoved" class="type-detail ink-2">
            Rows you removed. They are still counted by spend and ritual health —
            removing only takes them off the list.
          </p>
          <button
            v-else-if="removedCount"
            class="type-meta ink-3 hover:ink-1 hover:underline focus-ring rounded"
            @click="toggleRemovedView"
          >
            {{ removedCount }} removed
          </button>
          <span v-else />

          <div class="flex items-center gap-2 flex-wrap justify-end">
            <UButton
              v-if="viewingRemoved"
              label="Back to the list"
              size="xs"
              variant="ghost"
              color="neutral"
              @click="toggleRemovedView"
            />
            <template v-else>
              <!-- One question at a time: two confirmations in one row read as one -->
              <template v-if="emptySessionIds.length && !confirmingClear">
                <template v-if="confirmingClose">
                  <span class="type-meta ink-2">
                    Close {{ emptySessionIds.length }} and delete their branches?
                  </span>
                  <UButton
                    label="Close them"
                    size="xs"
                    color="error"
                    :loading="closing"
                    @click="closeEmpty('visible', emptySessionIds)"
                  />
                  <UButton
                    label="Cancel"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    @click="() => { confirmingClose = null }"
                  />
                </template>
                <UButton
                  v-else
                  :label="`Close ${emptySessionIds.length} empty`"
                  icon="i-lucide-trash-2"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  @click="() => { confirmingClose = 'visible' }"
                />
              </template>

              <template v-if="clearable.length && !confirmingClose">
                <template v-if="confirmingClear">
                  <span class="type-meta ink-2">
                    Remove {{ clearable.length }} finished {{ clearable.length === 1 ? 'row' : 'rows' }}?
                  </span>
                  <UButton label="Remove" size="xs" variant="soft" @click="clearVisible" />
                  <UButton
                    label="Cancel"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    @click="() => { confirmingClear = false }"
                  />
                </template>
                <UButton
                  v-else
                  :label="`Clear ${clearable.length} finished`"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-x"
                  @click="() => { confirmingClear = true }"
                />
              </template>
            </template>
          </div>
        </div>

        <!--
          No gaps. The rows carry their own hairline and butt up against each
          other, which is what makes forty of them read as one list rather than
          forty objects. The top border closes the run above the first row.
        -->
        <div v-if="work.length" class="work-list">
          <template v-for="item in work" :key="item.key">
            <SessionCard
              v-if="sessionFor(item)"
              :session="sessionFor(item)!"
              :repo-name="scope === 'here' ? null : nameFor(sessionFor(item)!.repoDir)"
              :pull="pullFor(sessionFor(item)!)"
            />
            <RunCard
              v-else
              :item="item"
              @remove="removeRuns([item], item.title)"
              @restore="restoreRuns([item.runId!])"
            />
          </template>
        </div>

        <EmptyState
          v-else-if="hasFilters"
          icon="i-lucide-search-x"
          title="Nothing matches those filters"
          description="Widen them, or clear them to see everything again."
          action-label="Clear filters"
          @action="clearFilters"
        />
      </div>


      <!--
        Only History can be empty in a way worth saying. Start is a composer, and
        an empty state over a text box you are about to type in would be telling
        you that the thing you are doing has not happened yet.
      -->
      <EmptyState
        v-if="workingDir && pane === 'history' && !work.length && !hasFilters && !loading"
        class="order-5"
        icon="i-lucide-history"
        :title="scope === 'here' ? 'Nothing has finished in this project' : 'Nothing has finished yet'"
        description="Sessions, rituals and commands land here once they have finished, with what each of them came to. What is still in flight is in the rail."
      />

      <!--
        Always visible on Start, so worktrees never accumulate unnoticed. Not
        on History: a checkout that still exists is not history.
      -->
      <WorktreePanel v-if="pane === 'start'" class="order-8" />
    </div>

    <!--
      Fixed to the bottom of the viewport, so the page reserves room for it
      rather than running underneath — otherwise the last session card is
      permanently behind the shell.
    -->
    <div v-if="terminalOpen && workingDir" :style="{ height: `${terminalHeight}px` }" />
    <WorkTerminalDock />
  </div>
</template>
