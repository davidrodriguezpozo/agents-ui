<script setup lang="ts">
import { errorMessage, errorSessionId } from '~/utils/errors'
import { workByPull } from '~/utils/pullWork'
import { relativeTime } from '~/utils/time'
import type { Pull, WorkIntent } from '~/composables/useGithubPulls'

/**
 * Everything with a diff behind it, and the decision to ship it or send it back.
 *
 * This was two halves of one job in two places. Pull requests lived here (as
 * "Reviews"); the merge train — the same question asked of sessions that have
 * not left this machine yet — lived at the top of /work, competing with the box
 * you start work in and pushing it below the fold on a laptop screen. The split
 * was by *where the branch is*, which is the system's distinction, not yours:
 * "what is finished and what do I do about it" is one question whether the
 * answer is a merge command or a GitHub button.
 *
 * So the page is that question, in two bands. **Ready here** is work this
 * machine can land itself. **On GitHub** is work that needs somebody, or is
 * waiting on somebody. Starting is not on this page at all — that is /work —
 * and neither is anything merely in flight.
 *
 * What it is emphatically not is a GitHub client. Pull requests you are only
 * subscribed to, the repository's feed, another team's queue: deliberately
 * absent. A worse GitHub in a smaller window is not worth building. The row
 * that turns into a session is.
 */

const {
  reading, summary, loading, loaded, busy, refresh, watchContinuously, stopWatching, work, merge,
} = useGithubPulls()
const { sessions, fetchAll: fetchSessions } = useSessions()
const { workingDir } = useWorkingDir()
const { projects } = useProjects()
const toast = useToast()

/** The pull request a merge has been offered on but not yet confirmed. */
const confirming = ref<number | null>(null)

onMounted(() => watchContinuously())
onUnmounted(stopWatching)

// Another project is another repository and another set of pull requests — and
// another answer to `inCurrentProject`, which is what decides whose sessions
// may be shown against those pull requests.
watch(workingDir, () => { void refresh(); void fetchSessions() })

const nothingOnGithub = computed(() =>
  reading.value.ok && !reading.value.reviewing.length && !reading.value.mine.length
)

/**
 * Yours, split by whether the next move is yours.
 *
 * The split is the page. A flat list of "my pull requests" is a list you have
 * to read all of to find the two that need you, which is the work this was
 * supposed to remove.
 */
const mineOnYou = computed(() => reading.value.mine.filter(p => p.verdict.onYou))
const mineWaiting = computed(() => reading.value.mine.filter(p => !p.verdict.onYou))

/* ----------------------------------------------------- already started it -- */

/**
 * Which pull requests you have already started on.
 *
 * Every row here offers to start a session, and until now none of them knew
 * whether you had — so the page invited you to begin work that was sitting
 * open, occasionally mid-turn, two screens away. The join is local: both halves
 * are already loaded, and the rule for what counts is in `~/utils/pullWork`.
 *
 * Restricted to this project's sessions, because the reading is this project's
 * repository and the sessions store holds every project on the machine. #482
 * exists everywhere.
 */
const sessionsHere = computed(() => sessions.value.filter(s => s.inCurrentProject))

const workOnPulls = computed(() =>
  workByPull([...reading.value.reviewing, ...reading.value.mine], sessionsHere.value))

/**
 * Sessions go stale on this page in a way they do not on /work.
 *
 * Nothing else here refetches them — the app fetches once at start-up — so a
 * chip saying "Working on it" would keep saying it for the rest of the day.
 * Polled on the same terms /work uses: only while something could actually
 * change on its own, and never overlapping itself.
 */
let sessionPoll: ReturnType<typeof setInterval> | null = null
let pollingSessions = false

onMounted(() => {
  void fetchSessions()

  sessionPoll = setInterval(async () => {
    if (pollingSessions) return
    if (!sessions.value.some(s => s.activity === 'working')) return

    pollingSessions = true
    try {
      await fetchSessions()
    } finally {
      pollingSessions = false
    }
  }, 5000)
})

onUnmounted(() => { if (sessionPoll) clearInterval(sessionPoll) })

/**
 * Press a row, land in the session for it.
 *
 * Pressing one twice used to be a dead end: the first press left a workspace
 * holding the pull request's branch, and every press after it came back with
 * git's "already checked out somewhere else" — for the same pull request you
 * were already looking at. So there are three arrivals rather than one, and the
 * page says which: a new workspace, the one that already had this branch, or a
 * workspace nobody claimed that has been taken over.
 *
 * A refusal that names a session is not really a refusal. The only case left is
 * a branch held by a session that is mid-turn, and the answer to that is to go
 * and look at it, which is what happens.
 */
async function startWork(pull: Pull, intent?: WorkIntent) {
  try {
    const session = await work(pull.number, intent)

    if (session.startError) {
      toast.add({ title: 'Session started, but not working', description: session.startError, color: 'warning' })
    } else if (session.how === 'continued') {
      toast.add({
        title: `Continued the session on #${pull.number}`,
        description: session.note
          ?? 'A session already had this branch checked out, so the instruction went there rather than to a second one.',
        color: 'info',
      })
    } else if (session.how === 'adopted') {
      toast.add({
        title: `Reused the workspace on #${pull.number}`,
        description: session.note ?? 'A workspace already had this branch and no session behind it.',
        color: 'info',
      })
    }

    await navigateTo(`/sessions/${session.id}`)
  } catch (e: any) {
    const held = errorSessionId(e)
    if (held) {
      toast.add({ title: `Already working on #${pull.number}`, description: errorMessage(e), color: 'warning' })
      await navigateTo(`/sessions/${held}`)
      return
    }

    toast.add({ title: `Could not start on #${pull.number}`, description: errorMessage(e), color: 'error' })
  }
}

async function confirmMerge(pull: Pull) {
  // Asked twice on purpose. Everything else on this page is a read or a local
  // workspace; this one is visible to everybody the moment it lands.
  if (confirming.value !== pull.number) {
    confirming.value = pull.number
    return
  }

  confirming.value = null
  try {
    await merge(pull.number)
    toast.add({ title: `#${pull.number} merged`, description: pull.title, color: 'success' })
  } catch (e: any) {
    toast.add({ title: `#${pull.number} was not merged`, description: errorMessage(e), color: 'error' })
  }
}

/* ---------------------------------------------------------------- landing -- */

/**
 * Landing the finished ones, which arrived here from /work.
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

onMounted(async () => {
  await Promise.all([refreshLanding(), refreshLandingPlan()])
  if (landing.value) watchLanding()
})

// The plan is read from the repository's worktrees, so it goes stale whenever a
// session does — a turn finishing, a merge landing, a project switch.
watch(workingDir, () => { refreshLandingPlan() })

const activeProject = computed(() => projects.value.find(p => p.path === workingDir.value) ?? null)

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

/** Nothing here and nothing there — the only case that gets one empty state. */
const nothingAnywhere = computed(() =>
  nothingOnGithub.value && !showTrain.value && !landingRun.value)
</script>

<template>
  <div>
    <PageHeader title="Land" measure>
      <template #trailing>
        <span v-if="summary.onYou" class="fs-mono font-mono ink-accent">
          {{ summary.onYou }} on you
        </span>
      </template>
      <template #right>
        <span v-if="reading.readAt" class="type-mono-meta hidden sm:inline">
          read {{ relativeTime(reading.readAt) }}
        </span>
        <button
          class="p-1.5 rounded-md hover-bg focus-ring press-scale"
          style="color: var(--text-tertiary);"
          title="Ask GitHub again"
          :disabled="loading"
          @click="refresh()"
        >
          <UIcon name="i-lucide-refresh-cw" class="size-3.5" :class="{ 'animate-spin': loading }" />
        </button>
      </template>
    </PageHeader>

    <div class="page-container page-container--measure py-4 space-y-7">
      <!--
        The report of a landing, whether or not one is still going: the result is
        a list rather than a sentence, and the half that did not land is the half
        worth reading. First on the page while it is happening, because then it
        is the thing that is happening.
      -->
      <LandingPanel
        v-if="landingRun"
        :run="landingRun"
        :dismissable="!landing"
        :landed-ids="landedSessionIds"
        @dismiss="dismissLanding"
      />

      <!--
        Ready here — branches this machine can land without asking GitHub.

        Folded, because nine rows of order is a thing you open when you are about
        to land rather than something to read past on every visit. It unfolds
        itself while a landing is actually running, which is `inFlight` in
        MergeTrain: at that point it is the news rather than a tool.
      -->
      <section v-if="showTrain && workingDir" class="space-y-2">
        <h2 class="text-section-label">Ready here</h2>
        <MergeTrain
          collapsible
          :plan="landingPlan"
          :sessions="trainSessions"
          :base-branch="activeProject?.branch || 'your current branch'"
          :landing="landingRun"
          :starting="startingLanding"
          @land="onLand"
          @recheck="refreshLandingPlan"
        />
      </section>

      <!-- On GitHub — everything that needs somebody else's browser -->
      <section class="space-y-4">
        <div class="flex items-baseline gap-2.5">
          <h2 class="text-section-label">On GitHub</h2>
          <span v-if="reading.repo" class="type-mono-meta font-mono">{{ reading.repo }}</span>
        </div>

        <!--
          A reason, never an empty list. Telling somebody nothing is waiting when
          really nobody asked is how a page teaches you to stop trusting it.
        -->
        <div
          v-if="!reading.ok"
          class="flex items-start gap-3 p-3.5 rounded-lg"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        >
          <UIcon name="i-lucide-plug-zap" class="size-4 shrink-0 mt-0.5 ink-warn" />
          <div class="min-w-0 space-y-1">
            <p class="type-strong text-body">GitHub could not be asked</p>
            <p class="type-detail">{{ reading.reason }}</p>
          </div>
        </div>

        <template v-else>
          <!-- Four numbers that answer "is there anything here for me" from the doorway -->
          <div v-if="!nothingOnGithub" class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div
              v-for="stat in [
                { label: 'on you', value: summary.onYou, tone: 'var(--accent)' },
                { label: 'to review', value: summary.toReview, tone: 'var(--text-primary)' },
                { label: 'ready to merge', value: summary.toMerge, tone: 'var(--success)' },
                { label: 'waiting on others', value: summary.waiting, tone: 'var(--text-tertiary)' },
              ]"
              :key="stat.label"
              class="px-3 py-2.5 rounded-lg"
              style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
            >
              <div class="stat-number tabular-nums" :style="{ color: stat.value ? stat.tone : 'var(--text-disabled)' }">
                {{ stat.value }}
              </div>
              <div class="stat-label">{{ stat.label }}</div>
            </div>
          </div>

          <div v-if="loading && !loaded" class="space-y-2">
            <SkeletonRow v-for="i in 3" :key="i" />
          </div>

          <template v-else>
            <section v-if="reading.reviewing.length" class="space-y-2">
              <h3 class="text-section-label">Waiting for your review</h3>
              <PullCard
                v-for="pull in reading.reviewing"
                :key="pull.number"
                :pull="pull"
                :busy="busy === pull.number"
                :work="workOnPulls.get(pull.number) ?? null"
                class="stagger-item"
                @work="intent => startWork(pull, intent)"
              />
            </section>

            <section v-if="mineOnYou.length" class="space-y-2">
              <h3 class="text-section-label">Yours, waiting on you</h3>
              <div v-for="pull in mineOnYou" :key="pull.number" class="space-y-1.5 stagger-item">
                <PullCard
                  :pull="pull"
                  :busy="busy === pull.number"
                  :work="workOnPulls.get(pull.number) ?? null"
                  :can-merge="pull.verdict.state === 'ready'"
                  @work="intent => startWork(pull, intent)"
                  @merge="confirmMerge(pull)"
                />
                <!-- The second press, spelled out rather than a modal over the list -->
                <div
                  v-if="confirming === pull.number"
                  class="flex items-center gap-2 px-3 py-2 rounded-md ml-3"
                  style="background: var(--success-wash); border: 1px solid var(--success-edge);"
                >
                  <UIcon name="i-lucide-git-merge" class="size-3.5 shrink-0 ink-ok" />
                  <span class="type-detail flex-1">
                    Merge #{{ pull.number }} into <span class="font-mono">{{ pull.baseBranch }}</span>?
                    Everyone on this repository sees it.
                  </span>
                  <button
                    class="fs-mono px-2 py-1 rounded press-scale focus-ring"
                    style="color: var(--text-tertiary);"
                    @click="confirming = null"
                  >
                    Cancel
                  </button>
                  <button
                    class="fs-mono px-2.5 py-1 rounded font-medium press-scale focus-ring"
                    style="background: var(--success); color: white;"
                    @click="confirmMerge(pull)"
                  >
                    Merge it
                  </button>
                </div>
              </div>
            </section>

            <section v-if="mineWaiting.length" class="space-y-2">
              <h3 class="text-section-label">Yours, waiting on somebody else</h3>
              <PullCard
                v-for="pull in mineWaiting"
                :key="pull.number"
                :pull="pull"
                :busy="busy === pull.number"
                :work="workOnPulls.get(pull.number) ?? null"
                class="stagger-item"
                @work="intent => startWork(pull, intent)"
              />
            </section>

            <p v-if="nothingOnGithub && !nothingAnywhere" class="type-detail">
              No open pull request
              <template v-if="reading.repo">in <span class="font-mono">{{ reading.repo }}</span></template>
              is yours or waiting on your review.
            </p>
          </template>
        </template>
      </section>

      <EmptyState
        v-if="nothingAnywhere"
        icon="i-lucide-git-merge"
        title="Nothing is waiting to land"
        description="No session here is finished, and no open pull request is yours or waiting on your review. When one is, it turns up here — and one press starts a session on it."
        action-label="Start something"
        action-to="/work"
      />
    </div>
  </div>
</template>
