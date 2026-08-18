<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { findSimilar } from '~/utils/similarSession'
import { isSendKey } from '~/utils/keys'
import type { RunQuery } from '~/composables/useRuns'
import { TRUST_CHOICES, type TrustLevel } from '~/composables/useSessions'
import type { Session } from '~/composables/useSessions'
import {
  buildWorkList, onTab, removableRuns, statusCounts, tabOf, WORK_ORIGIN, WORK_STATUS,
  type WorkItem, type WorkOrigin, type WorkStatus, type WorkTab,
} from '~/utils/workList'

const {
  sessions, here, elsewhere, workingCount, needsYouCount, loading,
  fetchAll, create, createMany, startFrom,
} = useSessions()
const { fetchAll: fetchWorktrees } = useWorktrees()
const { runs, fetchRuns, hideRuns } = useRuns()
const { transcripts, fetchAll: fetchTranscripts, adopt } = useTranscripts()
const { workingDir, displayPath } = useWorkingDir()
const { projects, nameFor, activate, addProject, ensureLoaded: ensureProjectsLoaded } = useProjects()
const router = useRouter()
const toast = useToast()

const prompt = ref('')
const creating = ref(false)
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
const startTrust = ref<TrustLevel>('edits')

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
    const result = await createMany(batchPrompts.value, undefined, startTrust.value)
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

/**
 * Set while a poll is in the air, so the next tick skips rather than stacking.
 *
 * The list costs a few `git` invocations per session, and with enough sessions
 * open it can take longer to build than the gap between polls. Firing anyway
 * meant each tick started before the last had answered, which is self-
 * sustaining: the overlap is what made it slow. A skipped tick costs four
 * seconds of freshness; not skipping cost the whole app.
 */
let polling = false

onMounted(async () => {
  await Promise.all([
    fetchAll(), fetchWorktrees(), fetchTranscripts(), ensureProjectsLoaded(),
    fetchRuns(runsQuery.value), countRemoved(),
  ])

  // Only poll while something could change on its own — but that now includes a
  // ritual firing, which no session on this page would report.
  poll = setInterval(async () => {
    if (polling) return
    const live = sessions.value.some(s => s.activity === 'working')
      || runs.value.some(r => r.status === 'running' || r.status === 'queued')
    if (!live) return

    polling = true
    try {
      await Promise.all([fetchAll(), fetchRuns({ ...runsQuery.value, q: search.value.trim() })])
    } finally {
      polling = false
    }
  }, 4000)
})

onUnmounted(() => { if (poll) clearInterval(poll) })

async function onCreate() {
  const value = prompt.value.trim()
  if (!value || creating.value) return

  creating.value = true
  try {
    const session = await create(value, undefined, startTrust.value)
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

/**
 * Which projects the list covers.
 *
 * Kept in shared state rather than in the component, so going into a session
 * and coming back does not quietly narrow the view again — a person who asked
 * to see everything meant it for longer than one navigation.
 */
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

const scope = useState<'here' | 'all'>('sessions-scope', () => 'here')

/**
 * Which half of the page you are on.
 *
 * Shared state for the same reason `scope` is: opening a session and coming back
 * should not quietly put you on the other tab. Defaults to what is happening
 * now, because that is what somebody who typed /work came for — history is a
 * thing you go and look at.
 */
const tab = useState<WorkTab>('work-tab', () => 'flight')

/**
 * A status chip is only meaningful on the tab that owns it, so choosing one on
 * the other tab moves you there rather than filtering to nothing.
 */
function chooseStatus(value: WorkStatus) {
  if (status.value === value) {
    status.value = null
    return
  }
  status.value = value
  tab.value = tabOf(value)
}

// With no project selected there is no "here" to narrow to, and the toggle
// would be a control with one working position.
watchEffect(() => { if (!workingDir.value) scope.value = 'all' })

/** A session nobody has answered is the reason to look at another project. */
function needsYou(list: Session[]) {
  return list.filter(
    s => s.activity === 'awaiting-permission'
      || (s.activity === 'idle' && s.check?.status === 'failing'),
  ).length
}

const elsewhereNeedsYou = computed(() => needsYou(elsewhere.value))

/**
 * The work list: sessions and runs, filtered together.
 *
 * Runs whose source is a session are dropped by `buildWorkList` — that session
 * is its own row. `useRuns` is asked for the rest, and the search reaches the
 * server because that list is capped there; searching one loaded page of it
 * would silently miss everything past the cap.
 */
/**
 * Runs a session owns are excluded on the server, not here.
 *
 * On a real machine 49 of the 50 most recent runs were turns of a session that
 * is already its own row, so filtering client-side spent the whole cap on rows
 * that were then discarded — and a ritual run from yesterday was invisible
 * behind fifty turns of one session.
 */
const RUNS_QUERY: RunQuery = { exclude: ['session'], limit: 50, hidden: 'exclude' }

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
const runsQuery = computed(() => (viewingRemoved.value ? REMOVED_QUERY : RUNS_QUERY))

const status = ref<WorkStatus | null>(null)
const origin = ref<WorkOrigin | null>(null)
const search = ref('')

const hasFilters = computed(() => Boolean(status.value || origin.value || search.value.trim()))

function clearFilters() {
  status.value = null
  origin.value = null
  search.value = ''
}

const visibleSessions = computed(() => (scope.value === 'here' ? here.value : sessions.value))

/** Everything, both tabs, unfiltered — what the tab counts are read from. */
const everything = computed(() => buildWorkList({
  sessions: visibleSessions.value,
  runs: runs.value,
}))

/** This tab's pile, unfiltered, so the chip counts describe it rather than a slice. */
const allWork = computed(() => onTab(everything.value, tab.value))

const work = computed(() => onTab(
  buildWorkList(
    { sessions: visibleSessions.value, runs: runs.value },
    { status: status.value, origin: origin.value, query: search.value },
  ),
  tab.value,
))

const tabCounts = computed(() => {
  const counts = statusCounts(everything.value)
  return {
    flight: counts.running + counts['needs-you'],
    history: counts.done + counts.failed,
  }
})

const statusChips = computed(() => {
  const counts = statusCounts(everything.value)
  return WORK_STATUS
    .filter(s => tabOf(s.value) === tab.value)
    .map(s => ({ ...s, count: counts[s.value] }))
    // A chip with nothing behind it is a dead end, unless it is the one you have
    // already pressed — removing that under your cursor is worse.
    .filter(s => s.count > 0 || status.value === s.value)
})

// A filter left behind on the tab that owned it hides the whole of this one.
watch(tab, () => {
  if (status.value && tabOf(status.value) !== tab.value) status.value = null
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
      fetchRuns({ ...runsQuery.value, q: search.value.trim() }),
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
    await Promise.all([
      fetchRuns({ ...runsQuery.value, q: search.value.trim() }),
      countRemoved(),
    ])
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
  await fetchRuns({ ...runsQuery.value, q: search.value.trim() })
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
  searchDebounce = setTimeout(() => { void fetchRuns({ ...runsQuery.value, q: search.value.trim() }) }, 200)
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

/**
 * Switching to the project a row belongs to.
 *
 * The list is no longer grouped by repository — a run has no repository to group
 * under, so grouping by one would have applied to half the rows. Sessions carry
 * their repo name on the card instead, and this is still how you go there.
 */
async function switchTo(path: string) {
  await activate(path)
  scope.value = 'here'
}
</script>

<template>
  <div>
    <PageHeader title="Work">
      <template #trailing>
        <!--
          Only worth a control when there is somewhere else to look. One project
          means one possible answer, and a toggle with one position is furniture.
        -->
        <div
          v-if="workingDir && elsewhere.length"
          class="flex items-center gap-0.5 p-0.5 rounded-md"
          style="background: var(--input-bg); border: 1px solid var(--border-subtle);"
        >
          <button
            v-for="option in [{ value: 'here' as const, label: 'This project' }, { value: 'all' as const, label: 'All projects' }]"
            :key="option.value"
            class="px-2 py-0.5 rounded fs-micro font-medium transition-all"
            :style="{
              background: scope === option.value ? 'var(--accent-muted)' : 'transparent',
              color: scope === option.value ? 'var(--accent)' : 'var(--text-disabled)',
            }"
            @click="scope = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <span v-if="allWork.length" class="type-mono-meta">{{ allWork.length }}</span>
        <SessionStatus
          v-if="needsYouCount"
          activity="awaiting-permission"
          compact
        />
      </template>
    </PageHeader>

    <!--
      Two tabs, because they are two jobs.

      In flight is a thing you might interrupt: the composer, what is running,
      what is stuck, and the workspaces they are sitting in. History is a thing
      you read: last night as a picture, and every finished row underneath it.
      Held in one list the finished rows win on volume — forty of them, and the
      two you could act on at the bottom.
    -->
    <div class="page-container page-container--measure pt-3">
      <div class="flex items-center gap-0.5 p-0.5 rounded-md w-fit" style="background: var(--input-bg); border: 1px solid var(--border-subtle);">
        <button
          v-for="option in [
            { value: 'flight' as const, label: 'In flight', count: tabCounts.flight },
            { value: 'history' as const, label: 'History', count: tabCounts.history },
          ]"
          :key="option.value"
          class="px-2.5 py-1 rounded fs-mono font-medium transition-all focus-ring flex items-center gap-1.5"
          :style="{
            background: tab === option.value ? 'var(--accent-muted)' : 'transparent',
            color: tab === option.value ? 'var(--accent)' : 'var(--text-disabled)',
          }"
          @click="tab = option.value"
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
        v-if="notARepo && tab === 'flight'"
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
      <div v-if="workingDir && tab === 'flight'" class="order-3 space-y-1.5">
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
          <span
            v-if="startTrust === 'full'"
            class="type-detail flex items-center gap-1.5"
            style="color: var(--accent);"
          >
            <UIcon name="i-lucide-zap" class="size-3.5 shrink-0" />
            Runs commands without asking, sandboxed, in its own workspace.
          </span>
        </div>

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
        v-else-if="tab === 'flight'"
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
      <div v-if="workingDir && transcripts.length && tab === 'flight'" class="order-4">
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

      <div v-if="loading && !sessions.length" class="order-5 space-y-1">
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
        thing that never does. Here it is the heading of the tab it describes.
      -->
      <NightShift v-if="tab === 'history'" class="order-5" />

      <div class="order-5 space-y-3">
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
          v-if="tab === 'history' && (emptySessionIds.length || clearable.length || removedCount || viewingRemoved)"
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

        <div v-if="work.length" class="space-y-2">
          <template v-for="item in work" :key="item.key">
            <SessionCard
              v-if="sessionFor(item)"
              :session="sessionFor(item)!"
              :repo-name="scope === 'here' ? null : nameFor(sessionFor(item)!.repoDir)"
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


      <EmptyState
        v-if="workingDir && !work.length && !hasFilters && !loading"
        class="order-5"
        :icon="tab === 'flight' ? 'i-lucide-git-branch' : 'i-lucide-history'"
        :title="tab === 'flight'
          ? 'Nothing is running'
          : (scope === 'here' ? 'Nothing has finished in this project' : 'Nothing has finished yet')"
        :description="tab === 'flight'
          ? 'Start a session above to give Claude its own copy of this project. It turns up here while it works, and moves to History when it is done.'
          : 'Sessions, rituals and commands land here once they have finished, with what each of them came to.'"
      />

      <!--
        The way back to work happening somewhere else. Only worth saying when
        the current view is hiding some of it.
      -->
      <button
        v-if="scope === 'here' && elsewhere.length"
        class="order-7 w-full flex items-center gap-2 px-3 py-2.5 rounded-md hover-row focus-ring"
        style="border: 1px dashed var(--border-subtle);"
        @click="scope = 'all'"
      >
        <UIcon name="i-lucide-folders" class="size-3.5 shrink-0 text-meta" />
        <span class="type-detail">
          {{ elsewhere.length }} session{{ elsewhere.length === 1 ? '' : 's' }} in other projects
        </span>
        <span
          v-if="elsewhereNeedsYou"
          class="type-meta"
          style="color: var(--error);"
        >{{ elsewhereNeedsYou }} needing you</span>
        <span class="ml-auto type-meta ink-accent">Show</span>
      </button>

      <!--
        Always visible on this tab, so worktrees never accumulate unnoticed. Not
        on History: a checkout that still exists is not history.
      -->
      <WorktreePanel v-if="tab === 'flight'" class="order-8" />
    </div>
  </div>
</template>
