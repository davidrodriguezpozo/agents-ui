<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { findSimilar } from '~/utils/similarSession'
import { isSendKey } from '~/utils/keys'
import { TRUST_CHOICES, type TrustLevel } from '~/composables/useSessions'
import type { Session } from '~/composables/useSessions'

const {
  sessions, here, elsewhere, workingCount, needsYouCount, loading,
  fetchAll, create, createMany, startFrom,
} = useSessions()
const { fetchAll: fetchWorktrees } = useWorktrees()
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
  await Promise.all([fetchAll(), fetchWorktrees(), fetchTranscripts(), ensureProjectsLoaded()])
  // Only poll while something could change on its own.
  poll = setInterval(async () => {
    if (polling) return
    if (!sessions.value.some(s => s.activity === 'working')) return

    polling = true
    try {
      await fetchAll()
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

function relative(ts: number) {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

// With no project selected there is no "here" to narrow to, and the toggle
// would be a control with one working position.
watchEffect(() => { if (!workingDir.value) scope.value = 'all' })

/** Sessions needing an answer come first — they are the ones blocking. */
function byUrgency(a: Session, b: Session) {
  const rank = { 'awaiting-permission': 0, working: 2, failed: 3, idle: 4, missing: 5 }

  // A session that finished and does not work needs you almost as much as one
  // that is asking — it just has not said so. Without this it sorts as plain
  // idle and sits below whatever ran most recently.
  const rankOf = (s: Session) =>
    s.activity === 'idle' && s.check?.status === 'failing' ? 1 : rank[s.activity]

  return rankOf(a) - rankOf(b) || b.updatedAt - a.updatedAt
}

/** A session nobody has answered is the reason to look at another project. */
function needsYou(list: Session[]) {
  return list.filter(
    s => s.activity === 'awaiting-permission'
      || (s.activity === 'idle' && s.check?.status === 'failing'),
  ).length
}

const elsewhereNeedsYou = computed(() => needsYou(elsewhere.value))

/**
 * Sessions by repository. The project you are in leads, and the rest follow by
 * whichever has been touched most recently — the same order the switcher uses,
 * so the two never disagree about what "recent" means.
 */
const groups = computed(() => {
  const visible = scope.value === 'here' ? here.value : sessions.value
  const byRepo = new Map<string, Session[]>()

  for (const session of visible) {
    const existing = byRepo.get(session.repoDir)
    if (existing) existing.push(session)
    else byRepo.set(session.repoDir, [session])
  }

  return [...byRepo.entries()]
    .map(([path, list]) => ({
      path,
      name: nameFor(path),
      isActive: path === workingDir.value,
      sessions: [...list].sort(byUrgency),
      // Split into what each one wants from you, after the urgency sort so
      // the order inside a section is still the order it earned.
      sections: bySection([...list].sort(byUrgency)),
      needsYou: needsYou(list),
    }))
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      // A project with something blocked outranks one that is merely recent.
      if (Boolean(a.needsYou) !== Boolean(b.needsYou)) return a.needsYou ? -1 : 1
      return (b.sessions[0]?.updatedAt ?? 0) - (a.sessions[0]?.updatedAt ?? 0)
    })
})

/**
 * Clearing out what came to nothing.
 *
 * Two steps, on purpose: this deletes branches and whole checkouts, and it
 * does several at once. The server checks each one again before touching it,
 * so a session that gained changes since this page loaded survives regardless
 * of what was clicked here.
 */
/**
 * Landing the finished ones.
 *
 * Two steps, because this merges into the branch you have checked out. The
 * confirmation names the branch rather than saying "are you sure" — the branch
 * is the part worth checking before agreeing.
 */
const {
  showRun: landingRun, active: landing, starting: startingLanding, plan: landingPlan,
  start: beginLanding, refresh: refreshLanding, refreshPlan: refreshLandingPlan,
  dismiss: dismissLanding, watch: watchLanding,
} = useLanding()
const confirmingLand = ref(false)

onMounted(async () => {
  await Promise.all([refreshLanding(), refreshLandingPlan()])
  if (landing.value) watchLanding()
})

// The plan is read from the repository's worktrees, so it goes stale whenever a
// session does — a turn finishing, a merge landing, a project switch.
watch(workingDir, () => { refreshLandingPlan() })

/**
 * The train is only worth drawing when there is an order to show.
 *
 * One session has no order — the picture would be a single track beside a spine,
 * explaining a design decision that has not come up yet. It earns its space from
 * two upwards, which is also the point at which merging by hand starts being
 * wrong rather than merely tedious.
 */
const trainSessions = computed(() =>
  sessions.value.filter(s => s.inCurrentProject && s.status !== 'archived'))

const showTrain = computed(() => trainSessions.value.length >= 2)

/**
 * Which sessions are in their base branch now, for the landing panel.
 *
 * Read from git on every sessions fetch, so the panel can prefer what is true
 * over what an old run concluded — it kept insisting a session with sixteen
 * commits had never committed anything.
 */
const landedSessionIds = computed(() =>
  sessions.value.filter(s => s.landed).map(s => s.id))

async function onLand() {
  confirmingLand.value = false
  try {
    await beginLanding()
    toast.add({
      title: 'Landing started',
      description: 'It runs the checks again for each one. You can leave this page.',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: 'Could not start landing', description: errorMessage(e), color: 'error' })
    // Usually the base checkout: re-reading the plan puts the reason on the
    // train, where it stays until it is fixed.
    await refreshLandingPlan()
  }
}

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

/** One project needs no heading to say which project it is. */
const showProjectHeadings = computed(() => groups.value.length > 1)

async function switchTo(path: string) {
  await activate(path)
  scope.value = 'here'
}
</script>

<template>
  <div>
    <PageHeader title="Sessions">
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
        <span v-if="sessions.length" class="type-mono-meta">{{ sessions.length }}</span>
        <SessionStatus
          v-if="needsYouCount"
          activity="awaiting-permission"
          compact
        />
      </template>
    </PageHeader>

    <div class="page-container page-container--measure py-4 space-y-5">
      <p class="type-body">
        Each session works on its own copy of your project, so several can run at the same time
        without overwriting each other. Nothing touches your files until you merge it.
      </p>

      <!--
        Said before the button, not after it. Pressing "Start session" here
        used to be the first anyone heard that this folder cannot be branched,
        having just been told it would be — and the repository it needs is
        usually sitting one directory down.
      -->
      <div
        v-if="notARepo"
        class="rounded-lg p-4 space-y-3"
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

      <!--
        Shown whether or not it is still going: the result of a landing is a
        list rather than a sentence, and the half that did not land is the half
        worth reading.
      -->
      <!--
        The order, before the ending. Kept above the panel rather than instead of
        it: while a landing runs the train shows which one the minutes are going
        into, and the panel below carries the list of what each came to.
      -->
      <MergeTrain
        v-if="showTrain && workingDir"
        :plan="landingPlan"
        :sessions="trainSessions"
        :base-branch="activeProject?.branch || 'your current branch'"
        :landing="landingRun"
        :starting="startingLanding"
        @land="onLand"
        @recheck="refreshLandingPlan"
      />

      <!--
        Above the composer rather than instead of it. It used to take its place,
        and since the newest run is shown whatever its status and nothing cleared
        it, one landing removed the way to start a session for good.
      -->
      <LandingPanel
        v-if="landingRun"
        :run="landingRun"
        :dismissable="!landing"
        :landed-ids="landedSessionIds"
        @dismiss="dismissLanding"
      />

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
          <span
            v-if="startTrust === 'full'"
            class="type-detail flex items-center gap-1.5"
            style="color: var(--accent);"
          >
            <UIcon name="i-lucide-zap" class="size-3.5 shrink-0" />
            Runs commands without asking, sandboxed, in its own workspace.
          </span>
          <span v-else-if="startTrust === 'readonly'" class="type-meta">
            It will propose changes rather than make them.
          </span>
          <span v-else class="type-meta">
            Writes files freely; stops to ask before anything riskier.
          </span>
        </div>

        <!-- Or start on something that already exists -->
        <div v-if="!batchMode" class="flex gap-2 pt-1">
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
            placeholder="…or pick a pull request or branch, or paste a URL"
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
        <UIcon name="i-lucide-folder" class="size-4 shrink-0 mt-0.5 ink-accent" />
        <span class="type-detail ink-2">
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
          <UIcon name="i-lucide-terminal" class="size-4 shrink-0 ink-4" />
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

      <!--
        Grouped by repository rather than split into "here" and "everything
        else". A session that is blocked is blocked whichever project it is in,
        and the old shape made that answerable only after switching.
      -->
      <div v-else-if="groups.length" class="space-y-6">
        <div v-for="group in groups" :key="group.path" class="space-y-2">
          <div v-if="showProjectHeadings" class="flex items-center gap-2">
            <UIcon
              name="i-lucide-folder-git-2"
              class="size-3.5 shrink-0"
              :style="{ color: group.isActive ? 'var(--accent)' : 'var(--text-disabled)' }"
            />
            <h2 class="text-section-label !mb-0">{{ group.name }}</h2>
            <span v-if="group.needsYou" class="type-meta ink-error">
              {{ group.needsYou }} needing you
            </span>
            <button
              v-if="!group.isActive"
              class="ml-auto type-meta px-2 py-0.5 rounded hover-bg shrink-0"
              style="color: var(--text-disabled);"
              title="Work in this project"
              @click="switchTo(group.path)"
            >
              Switch to it
            </button>
          </div>

          <!--
            The repository is named once. A heading says it for a group, and
            the sidebar says it for the project you are already in — so the
            card only carries it in the one case neither covers: a single
            group that is not the project you are looking at.
          -->
          <!--
            Sectioned rather than listed. Sixteen sessions in one chronological
            wall is a pile to work through; the same sixteen under "needs you",
            "done, waiting for you" and "nothing came of it" is three decisions.
            A single section needs no heading — the list is already the answer.
          -->
          <template v-for="part in group.sections" :key="part.section.outcome">
            <div v-if="group.sections.length > 1" class="flex items-baseline gap-2 pt-2 first:pt-0">
              <h3 class="text-section-label">{{ part.section.title }}</h3>
              <span class="type-mono-meta">{{ part.sessions.length }}</span>
              <span v-if="part.section.hint" class="fs-mono text-meta truncate">
                {{ part.section.hint }}
              </span>

              <!--
                The ending, offered where the finished work already is. Merging
                these by hand means six page visits, and the second one onwards
                is only honest if the base is brought in and the checks re-run
                first — which is exactly what nobody does.
              -->
              <template v-if="part.section.outcome === 'ready' && group.isActive && !landing">
                <span class="flex-1" />
                <template v-if="confirmingLand">
                  <span class="fs-mono text-label">
                    Merge what passes into {{ activeProject?.branch || 'your current branch' }}?
                  </span>
                  <UButton
                    label="Land them"
                    size="xs"
                    :loading="startingLanding"
                    @click="onLand"
                  />
                  <UButton
                    label="Cancel"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    @click="() => { confirmingLand = false }"
                  />
                </template>
                <UButton
                  v-else
                  label="Land what passes"
                  icon="i-lucide-git-merge"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  @click="() => { confirmingLand = true }"
                />
              </template>

              <!--
                Offered for the whole group, because one at a time is the tax
                that makes people stop clearing up at all. Nothing here has
                anything in it — that is what put it in this section.
              -->
              <template v-if="part.section.outcome === 'nothing'">
                <span class="flex-1" />
                <template v-if="confirmingClose === group.path">
                  <span class="fs-mono text-label">
                    Close {{ part.sessions.length }} and delete their branches?
                  </span>
                  <UButton
                    label="Close them"
                    size="xs"
                    color="error"
                    :loading="closing"
                    @click="closeEmpty(group.path, part.sessions.map(s => s.id))"
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
                  label="Close these"
                  icon="i-lucide-trash-2"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  @click="() => { confirmingClose = group.path }"
                />
              </template>
            </div>
            <SessionCard
              v-for="session in part.sessions"
              :key="session.id"
              :session="session"
              :repo-name="showProjectHeadings || group.isActive ? null : group.name"
            />
          </template>
        </div>
      </div>

      <EmptyState
        v-else-if="workingDir"
        icon="i-lucide-git-branch"
        :title="scope === 'here' ? 'No sessions in this project' : 'No sessions yet'"
        description="Start one to give Claude its own copy of this project to work in. You can run several at once and review each one's changes before keeping them."
      />

      <!--
        The way back to work happening somewhere else. Only worth saying when
        the current view is hiding some of it.
      -->
      <button
        v-if="scope === 'here' && elsewhere.length"
        class="w-full flex items-center gap-2 px-3 py-2.5 rounded-md hover-row focus-ring"
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

      <!-- Always visible, so worktrees never accumulate unnoticed -->
      <WorktreePanel />
    </div>
  </div>
</template>
