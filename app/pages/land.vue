<script setup lang="ts">
import { errorMessage, errorSessionId } from '~/utils/errors'
import { workByPull } from '~/utils/pullWork'
import { relativeTime } from '~/utils/time'
import type { Pull, WorkIntent } from '~/composables/useGithubPulls'
import type { Issue, IssueIntent } from '~/composables/useGithubIssues'
import type { Arrival } from '~/composables/useQuickActions'

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
 * So the page is that question, in three bands. **Ready here** is work this
 * machine can land itself. **On GitHub** is work that needs somebody, or is
 * waiting on somebody. **Asked of you** is the other end of the same thread —
 * the issues, which are where a piece of work starts rather than where it
 * finishes, and which the app could previously only ever act on unattended.
 * Starting is not on this page at all — that is /work — and neither is anything
 * merely in flight.
 *
 * What it is emphatically not is a GitHub client. Pull requests you are only
 * subscribed to, the repository's feed, another team's queue: deliberately
 * absent. A worse GitHub in a smaller window is not worth building. The row
 * that turns into a session is.
 */

const {
  reading, summary, loading, loaded, busy, refresh, watchContinuously, stopWatching, work, merge,
} = useGithubPulls()
const {
  reading: issues, loading: issuesLoading, loaded: issuesLoaded, busy: issueBusy,
  readingNotion, refresh: refreshIssues, work: workIssue, readNotion,
} = useGithubIssues()
const { sessions, fetchAll: fetchSessions } = useSessions()
/** Where a press leaves you, and the sentence it leaves behind — see `useQuickActions`. */
const { load: loadQuickActions, arrive } = useQuickActions()
const { workingDir } = useWorkingDir()
const { projects } = useProjects()
const toast = useToast()

/** The pull request a merge has been offered on but not yet confirmed. */
const confirming = ref<number | null>(null)

onMounted(loadQuickActions)
onMounted(() => watchContinuously())
onUnmounted(stopWatching)

// Asked here as well as through the watch below, because the pull request
// reading is shared app-wide: the sidebar may already have taken one, in which
// case `readAt` does not move when this page opens and the band would sit empty
// until the next poll.
onMounted(refreshIssues)

// Another project is another repository and another set of pull requests — and
// another answer to `inCurrentProject`, which is what decides whose sessions
// may be shown against those pull requests.
watch(workingDir, () => { void refresh(); void fetchSessions() })

/**
 * The issue band, refreshed on the back of the pull request one.
 *
 * `readAt` moves on every reading `useGithubPulls` takes — the one at mount, the
 * two-minute poll, the header's refresh button, a project switch — and on the
 * failed ones too. Riding it means both bands are the same age and there is
 * still exactly one timer on this page. A second `setInterval` against
 * github.com, for a band nobody is watching in a tab left open all day, is the
 * thing worth not adding.
 */
watch(() => reading.value.readAt, () => { void refreshIssues() })

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

/**
 * Reviews composed on this machine and not yet sent.
 *
 * Its own request rather than a field on the pull request reading, because the
 * two fail differently: a review you have written and read is still yours to
 * send when GitHub comes back, so this band outlives the one below it going
 * dark. It does ask GitHub now — `reviewRetire` says why, and drops the ones you
 * already answered some other way — and it says when the answer did not arrive,
 * because a list that quietly stopped filtering looks exactly like the list that
 * never filtered at all.
 */
interface DraftedReview {
  sessionId: string
  pr: number
  title: string
  comments: number
  blocking: number
  event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'
  inCurrentProject: boolean
}

interface RetiredCounts {
  alreadyReviewed: number
  prClosed: number
  headMoved: number
  sessionClosed: number
}

const draftedReviews = ref<DraftedReview[]>([])
const draftsUnchecked = ref(0)
const draftsRetired = ref<RetiredCounts>({
  alreadyReviewed: 0, prClosed: 0, headMoved: 0, sessionClosed: 0,
})

async function loadDraftedReviews() {
  try {
    const payload = await $fetch<{
      pending: DraftedReview[]
      unchecked: number
      retired: RetiredCounts
    }>('/api/sessions/reviews')
    draftedReviews.value = payload.pending
    draftsUnchecked.value = payload.unchecked
    draftsRetired.value = payload.retired
  } catch {
    // A rollup that cannot be read is a missing band, not an error on a page
    // whose actual job is the pull requests below it.
  }
}

onMounted(loadDraftedReviews)

/**
 * What stopped waiting, said once and then dropped.
 *
 * Counted over a day rather than over the request, so the sentence is still
 * there on the next poll — the first time this band empties out it will empty
 * out by five or six rows at once, and rows that vanish without a reason are
 * how a page earns the same distrust the stale list had.
 */
const retiredNote = computed(() => {
  const { alreadyReviewed, prClosed, headMoved, sessionClosed } = draftsRetired.value
  const total = alreadyReviewed + prClosed + headMoved + sessionClosed
  if (!total) return null

  const parts: string[] = []
  if (alreadyReviewed) parts.push(`${alreadyReviewed} you had already reviewed on GitHub`)
  if (prClosed) parts.push(`${prClosed} on pull requests that have closed since`)
  if (headMoved) parts.push(`${headMoved} composed against commits that have been pushed over`)
  if (sessionClosed) parts.push(`${sessionClosed} whose session you closed`)

  return `${total} ${total === 1 ? 'review' : 'reviews'} stopped waiting in the last day — ${parts.join(', ')}.`
})

/** Shown rather than hidden: an unfiltered row is better than a missing one. */
const uncheckedNote = computed(() => {
  const count = draftsUnchecked.value
  if (!count) return null
  return count === 1
    ? 'One of these could not be checked against GitHub, so it may already have been sent.'
    : `${count} of these could not be checked against GitHub, so they may already have been sent.`
})

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
 * What the server did on the way in, when it is not what was asked for.
 *
 * One function for both bands rather than a toast per case: a workspace that was
 * continued and a turn that would not start are the same news whether the row
 * was a pull request or a ticket, and the three of them differ only in their
 * words. Null is the ordinary press, which `arrive` then says its own line about.
 */
function noteFor(
  session: { startError?: string; how?: string; note?: string },
  name: string,
): Arrival['note'] {
  if (session.startError) {
    return {
      title: 'Session started, but not working',
      description: session.startError,
      color: 'warning',
    }
  }

  if (session.how === 'continued') {
    return {
      title: `Continued the session on ${name}`,
      description: session.note
        ?? 'A session was already on this, so the instruction went there rather than to a second one.',
      color: 'info',
    }
  }

  if (session.how === 'adopted') {
    return {
      title: `Reused the workspace on ${name}`,
      description: session.note ?? 'A workspace already had this branch and no session behind it.',
      color: 'info',
    }
  }

  return null
}

/**
 * Press a row, and a session starts working on it.
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
 *
 * Whether arriving means the conversation or staying on this page is a
 * preference, and it is off by default, so `arrive` owns the ending.
 */
async function startWork(pull: Pull, intent?: WorkIntent) {
  try {
    const session = await work(pull.number, intent)

    await arrive(session.id, {
      title: `Working on #${pull.number}`,
      description: 'A session has it in its own worktree. This row says so from now on.',
      note: noteFor(session, `#${pull.number}`),
    })
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

/**
 * What to call a row in a sentence.
 *
 * `#42` for a GitHub issue, because that is what everybody says. A Notion ticket
 * has no such handle, so it is called by its title — cut, because a ticket title
 * can be a paragraph and a toast is not.
 */
function nameOf(issue: Issue): string {
  if (issue.source === 'github') return `#${issue.number}`
  return issue.title.length > 40 ? `${issue.title.slice(0, 40)}…` : issue.title
}

/**
 * The same press, from the other end of the workflow.
 *
 * Deliberately a second function rather than a branch inside `startWork`: the
 * two share the words for an arrival — `noteFor` — and nothing else. An issue or
 * a ticket has no branch to collide over, so the server never reports an
 * "adopted" workspace here and there is no takeover to explain.
 *
 * Keyed on `issue.key` rather than a number, because the band has two sources and
 * a number cannot name a Notion page. The server settles which tracker it is.
 */
async function startIssueWork(issue: Issue, intent: IssueIntent) {
  const name = nameOf(issue)

  try {
    const session = await workIssue(issue.key, intent)

    await arrive(session.id, {
      title: `Working on ${name}`,
      description: 'A session has it in its own worktree.',
      note: noteFor(session, name),
    })
  } catch (e: any) {
    const held = errorSessionId(e)
    if (held) {
      toast.add({ title: `Already working on ${name}`, description: errorMessage(e), color: 'warning' })
      await navigateTo(`/sessions/${held}`)
      return
    }

    toast.add({ title: `Could not start on ${name}`, description: errorMessage(e), color: 'error' })
  }
}

/**
 * Go and read Notion, which is a job rather than a request.
 *
 * Said out loud in the toast, cost included, because that is what it is: a model
 * run of tens of seconds against the MCP server. The band never does this on its
 * own — see `useGithubIssues` — so this button is the only thing that spends
 * anything on this page besides starting work.
 */
async function onReadNotion() {
  try {
    const result = await readNotion()
    const spent = result.costUsd ? ` · $${result.costUsd.toFixed(2)}` : ''

    if (result.error) {
      toast.add({ title: 'Notion was read, with a problem', description: result.error, color: 'warning' })
      return
    }

    toast.add({
      title: result.count
        ? `${result.count} ${result.count === 1 ? 'ticket' : 'tickets'} from Notion`
        : 'No ticket in Notion carries that status',
      description: `Read just now${spent}.`,
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: 'Notion was not read', description: errorMessage(e), color: 'error' })
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

/**
 * The Notion half's state, drawn from the reading rather than worked out here.
 *
 * Absent — a machine whose tickets are not in Notion — means the band says
 * nothing about Notion at all. Nobody needs a permanent note about a tracker they
 * do not use, which is the same rule `not-github` follows for a folder.
 */
const notion = computed(() => issues.value.notion ?? null)
const showNotion = computed(() => Boolean(notion.value?.configured))

/**
 * What the Notion half says about itself, in one sentence.
 *
 * Four states and they want different things from you: nothing has ever looked,
 * the last look was refused, the last look worked, or the look found nothing. The
 * refusal is verbatim from the run — it is where "Notion is not connected" comes
 * from, and it already names what to do about it.
 */
const notionLine = computed(() => {
  const half = notion.value
  if (!half) return ''
  if (!half.ok) return half.reason ?? 'Notion could not be read.'
  if (!half.checkedAt) return `Notion has not been read yet. Nothing here carries ${half.statusValue}.`

  const spent = half.costUsd ? ` · $${half.costUsd.toFixed(2)}` : ''
  const found = half.count
    ? `${half.count} ${half.count === 1 ? 'ticket' : 'tickets'} marked ${half.statusValue}`
    : `no ticket marked ${half.statusValue}`

  return `Notion: ${found}, read ${relativeTime(half.checkedAt)}${spent}.`
})

/**
 * Nothing here and nothing there — the only case that gets one empty state.
 *
 * `issues.ok` is part of it for the same reason `nothingOnGithub` tests the pull
 * requests': an issue band that could not be read is unknown, not empty, and
 * folding it into "nothing is waiting to land" would hide the one sentence that
 * says why. The Notion half has to be quiet too — a half that was refused is a
 * band with something to say, whatever it is showing.
 */
const nothingAnywhere = computed(() =>
  nothingOnGithub.value && !showTrain.value && !landingRun.value
  && issues.value.ok && !issues.value.issues.length
  && !showNotion.value)

/**
 * What the band says when it has nothing.
 *
 * It names the label, which is the point: an empty band is either "there is
 * nothing to do" or "you have not labelled anything yet", and those want
 * completely different things from you. The sentence says which word to reach
 * for, and Settings is where it is changed.
 */
const issuesEmptyLine = computed(() => {
  const where = issues.value.repo ? ` in ${issues.value.repo}` : ''
  return issues.value.label
    ? `No open issue${where} is assigned to you or labelled ${issues.value.label}.`
    : `No open issue${where} is assigned to you. No label is being watched.`
})
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
        After something lands, everything else in that repository is behind it.
        Offered here rather than on five session pages, and only ever offered —
        see `BaseSweepOffer`. Under the landing report, because it is what to do
        about what the report just said.
      -->
      <BaseSweepOffer v-if="workingDir && showTrain" />

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
          <!--
            Reviews composed here and not yet sent.
            
            Above the GitHub numbers because it is the only band on this page
            where the next move is a single press rather than a piece of work:
            the review is written, read and waiting on the one thing a machine
            must not do on its own.
          -->
          <div v-if="draftedReviews.length || retiredNote" class="space-y-2">
            <h3 class="text-section-label">Reviews waiting to be sent</h3>
            <NuxtLink
              v-for="review in draftedReviews"
              :key="review.sessionId"
              :to="`/sessions/${encodeURIComponent(review.sessionId)}`"
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
              style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
            >
              <UIcon name="i-lucide-message-square-code" class="size-4 shrink-0 ink-accent" />
              <div class="min-w-0 flex-1">
                <p class="type-strong text-body truncate">#{{ review.pr }} {{ review.title }}</p>
                <p class="type-detail">
                  {{ review.comments }} {{ review.comments === 1 ? 'comment' : 'comments' }}
                  <template v-if="review.blocking">
                    · {{ review.blocking }} blocking
                  </template>
                  <template v-if="review.event === 'REQUEST_CHANGES'">
                    · as a request for changes
                  </template>
                  <template v-if="!review.inCurrentProject">
                    · in another project
                  </template>
                </p>
              </div>
              <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0" style="color: var(--text-disabled);" />
            </NuxtLink>

            <!--
              Both notes are about the rows that are not here. The first says
              what left, the second admits the list may not have been filtered
              at all — which is the difference between a short list and a list
              that only looks short.
            -->
            <p v-if="uncheckedNote" class="type-detail">{{ uncheckedNote }}</p>
            <p v-if="retiredNote" class="type-detail">{{ retiredNote }}</p>
          </div>

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

      <!--
        Asked of you — the issues, which are where a piece of work starts.

        Under the pull requests on purpose: what is half-finished outranks what
        has not begun. A ritual could already fire on one of these being
        labelled; until now nobody could look at them, and nobody could start
        one by hand without reading it out to a session themselves.
      -->
      <section class="space-y-4">
        <div class="flex items-baseline gap-2.5">
          <h2 class="text-section-label">Asked of you</h2>
          <span v-if="issues.onYou" class="type-mono-meta font-mono ink-accent">
            {{ issues.onYou }} on you
          </span>
        </div>

        <!--
          A reason, never an empty list. Same rule the band above it keeps — and
          it no longer hides the rows: `gh` being missing is a fact about one of
          two trackers, and taking the Notion tickets off the screen with it
          would make one broken half into a blank band.
        -->
        <div
          v-if="!issues.ok"
          class="flex items-start gap-3 p-3.5 rounded-lg"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        >
          <UIcon name="i-lucide-plug-zap" class="size-4 shrink-0 mt-0.5 ink-warn" />
          <div class="min-w-0 space-y-1">
            <p class="type-strong text-body">Issues could not be read</p>
            <p class="type-detail">{{ issues.reason }}</p>
          </div>
        </div>

        <!--
          The Notion half, and the one control on this page that spends money.

          Shown only once somebody has configured it, so a machine whose tickets
          are not in Notion never hears about Notion. When the MCP server is not
          connected this is where it says so — the sentence comes from the run's
          own pre-flight, which already names the fix.
        -->
        <div
          v-if="showNotion"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        >
          <UIcon
            :name="notion?.ok ? 'i-lucide-file-text' : 'i-lucide-plug-zap'"
            class="size-4 shrink-0"
            :class="notion?.ok ? '' : 'ink-warn'"
          />
          <p class="type-detail flex-1 min-w-0">{{ notionLine }}</p>
          <button
            class="inline-flex items-center gap-1.5 fs-mono px-2.5 py-1.5 rounded-md font-medium press-scale focus-ring cursor-pointer shrink-0"
            style="background: var(--badge-subtle-bg); color: var(--text-secondary);"
            :disabled="readingNotion"
            title="Ask Notion for the tickets carrying that status. This is a run: it takes about a minute and costs a few cents."
            @click="onReadNotion()"
          >
            <UIcon
              :name="readingNotion ? 'i-lucide-loader-2' : 'i-lucide-refresh-cw'"
              class="size-3.5"
              :class="{ 'animate-spin': readingNotion }"
            />
            {{ readingNotion ? 'Reading Notion…' : 'Read Notion' }}
          </button>
        </div>

        <div v-if="issuesLoading && !issuesLoaded" class="space-y-2">
          <SkeletonRow v-for="i in 2" :key="i" />
        </div>

        <template v-else>
          <!--
            One list, both sources, in the order the server sorted them. Two
            lists under one heading would be two bands, and the reader would be
            doing the merge.
          -->
          <div v-if="issues.issues.length" class="space-y-2">
            <IssueCard
              v-for="issue in issues.issues"
              :key="issue.key"
              :issue="issue"
              :busy="issueBusy === issue.key"
              class="stagger-item"
              @work="intent => startIssueWork(issue, intent)"
            />
          </div>

          <p v-else-if="!nothingAnywhere && issues.ok" class="type-detail">
            {{ issuesEmptyLine }}
            <NuxtLink to="/settings#settings-issue-label" class="ink-accent hover:underline">
              Change the label
            </NuxtLink>
          </p>
        </template>
      </section>

      <EmptyState
        v-if="nothingAnywhere"
        icon="i-lucide-git-merge"
        title="Nothing is waiting to land"
        :description="`No session here is finished, and no open pull request is yours or waiting on your review. ${issuesEmptyLine} When one of them turns up it is here — and on a pull request or an issue, one press starts a session on it.`"
        action-label="Start something"
        action-to="/work"
      />
    </div>
  </div>
</template>
