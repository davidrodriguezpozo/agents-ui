<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui'
import {
  URGENCY_LABELS,
  asOfLabel,
  countUrgency,
  groupByRepo,
  isCurrent,
  landedLabel,
  moodOf,
  orderPulls,
  orderTiles,
  quotaMeter,
  sinceLabel,
  spendMeter,
  takeSome,
  untilLabel,
  urgencyOf,
  withDetail,
  type WallDetail,
  type WallPrompt,
  type WallPull,
  type WallRowData,
  type WallTile,
  type WallTone,
  type WallUrgency,
} from '~/utils/wall'
import { errorMessage } from '~/utils/errors'
import { SOUND_LABELS, diffSounds } from '~/utils/sound'
import {
  describe as describeVoice,
  matchProject,
  needsConfirmation,
  parseCommand,
  type VoiceCommand,
} from '~/utils/voice'

/**
 * Fleet — mission control.
 *
 * It began as a wall: cards, big type, a rotation of acts, a screen to leave on
 * at the end of a room. That is not what it became. It is the page this app gets
 * opened *to* with work already running, read at a desk from two feet away, to
 * answer one question — what should I look at next — and everything below follows
 * from taking that seriously instead of the poster it started as.
 *
 * **Density is the feature.** Twenty sessions across four repositories, nine pull
 * requests, whatever Slack found, the clock's next five jobs and the day's
 * throughput, all at once and without a click. The alternative is not a calmer
 * screen, it is four tabs and a habit of remembering to check them, which is the
 * thing this app exists to not require.
 *
 * **Three clocks, and each panel says which one it is on.** The fleet is two
 * seconds old and free to know — see `/api/wall`. Pull requests are up to a
 * minute old and cost `gh` per repository — see `wallPulls.ts`. The inbox is
 * however long ago somebody last spent two minutes asking Slack. Drawn
 * identically those three would all read as *now*, so the ones that are not say
 * so in their heading. A screen that hides its own staleness is the failure mode
 * of every dashboard, and it is worse than being slow.
 *
 * **It can be acted on.** A row waiting on a permission answer carries the answer;
 * a running one carries its brake; an inbox source carries the button that goes
 * and looks again. Everything else reports, and reporting is fine — but a screen
 * where nothing can be done is a screen you leave to go and do it somewhere else.
 *
 * **And right-clicked.** A row is one line and can hold about three buttons, which
 * is nowhere near the number of reasonable things to want from it — its pull
 * request, its branch name, the project it lives in, the review it is asking for.
 * Those are in a context menu, built by `sessionMenu` and `pullMenu` below.
 *
 * **What it will not do is act off a stale reading.** That used to be enforced by
 * refusing to act at all: pull request rows linked to GitHub and nothing else,
 * because a row may be a minute old and may belong to a repository this screen
 * does not have selected. But the constraint was never "this screen cannot start
 * work" — it was "this screen's copy of the facts cannot decide what the work is".
 * So the menu selects the right project first and then calls the same route /land
 * calls, which re-reads the pull request on the server before it builds a prompt.
 * The stale reading decides what to offer; the server decides what to do.
 *
 * **It says when it has stopped knowing.** The characteristic failure of a screen
 * left open is not being wrong, it is being nine minutes old while looking exactly
 * as it did when it was right. So a poll that throws is remembered and the page
 * says so in words.
 *
 * Escape goes back, `F` fills the screen, `S` is sound, held `V` is voice. The
 * cinema rotation that used to live here is gone: an act at a time was the right
 * answer for an audience across a room and the wrong one for the person actually
 * using this, who needs all of it visible at once.
 */

const { snapshot, now, connected, refresh, watchWall } = useWall()
watchWall()

// Already polled app-wide; this is guarded against starting a second one, so
// reading it here costs nothing.
const { attention, watchContinuously } = useAttention()
onMounted(() => watchContinuously())

/**
 * The half of the screen that leaves the machine, on its own far slower clock.
 *
 * A minute, matched to the server's cache. See `useWallPulls` for why this is not
 * simply another field on the snapshot.
 */
const {
  reading: pulls,
  refreshing: pullsRefreshing,
  error: pullsError,
  refresh: refreshPulls,
  watchPulls,
} = useWallPulls()
watchPulls()

/**
 * What was found elsewhere, as last found.
 *
 * Read on mount and never polled, because looking is a two-minute job that costs
 * money — `useInbox` and `server/utils/inbox.ts` both explain why. The panel
 * carries the button and says how old each source is; nothing here goes and looks
 * without being asked.
 */
const {
  sources: inboxSources,
  refreshing: inboxRefreshing,
  load: loadInbox,
  refresh: refreshInbox,
} = useInbox()

onMounted(() => void loadInbox())

const router = useRouter()

const current = computed(() =>
  (snapshot.value?.tiles ?? []).filter(tile => isCurrent(tile, now.value)),
)

const mood = computed(() => moodOf(current.value))

/**
 * The counts, for the header and for each repository's group.
 *
 * `settled` is deliberately absent: a row that needs nothing is on the screen
 * already, and a count of things that are fine is the kind of number that makes a
 * summary line longer without making it say more.
 */
function bandsOf(tiles: WallTile[]) {
  const counts = countUrgency(tiles)

  return (['needs-you', 'broken', 'working'] as WallUrgency[])
    .filter(urgency => counts[urgency])
    .map(urgency => ({ urgency, count: counts[urgency], label: URGENCY_LABELS[urgency] }))
}

const bands = computed(() => bandsOf(current.value))

const repos = computed(() => new Set(current.value.map(tile => tile.repo)).size)

const spend = computed(() => spendMeter(
  snapshot.value?.spend.todayUsd ?? 0,
  snapshot.value?.spend.capUsd ?? 0,
))

const quota = computed(() => quotaMeter(snapshot.value?.quota ?? null))

const clock = computed(() =>
  new Date(now.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
)

const MOOD_TONES: Record<ReturnType<typeof moodOf>, string> = {
  attention: 'var(--error)',
  busy: 'var(--accent)',
  quiet: 'var(--text-disabled)',
}

const landedToday = computed(() => snapshot.value?.landedToday ?? [])
const upcoming = computed(() => snapshot.value?.upcoming ?? [])
const day = computed(() => snapshot.value?.day ?? { runs: 0, failed: 0, lastHour: 0 })

/**
 * The half that costs git, asked far less often.
 *
 * `/api/wall` is built without spawning a process so it can be polled every couple
 * of seconds forever; files changed and how far behind a base is cannot be had that
 * way. `/api/sessions` answers those, at the price of a process per session, and it
 * is the same request the Work page already makes — so this screen costs what that
 * screen costs, not more, and only while it is open.
 *
 * Ten seconds because these figures move when a turn finishes, not between polls.
 * Each fact still has exactly one owner: liveness comes from the snapshot, git
 * comes from here, and `withDetail` is where they meet.
 */
const { sessions, fetchAll: fetchSessions } = useSessions()

const details = computed(() => {
  const map = new Map<string, WallDetail>()

  for (const session of sessions.value) {
    map.set(session.id, {
      changedFiles: session.worktree?.changedFiles,
      behind: session.worktree?.behind,
      checkStale: session.checkStale,
      summary: session.summary?.text,
      prUrl: session.prUrl,
    })
  }

  return map
})

onMounted(() => {
  void fetchSessions()
  const poll = setInterval(() => void fetchSessions(), 10_000)
  onUnmounted(() => clearInterval(poll))
})

/** Rows for the table: the live half, with whatever git has said, grouped by repo. */
const rows = computed(() => withDetail(orderTiles(current.value), details.value))
const groups = computed(() => groupByRepo(rows.value))
const manyRepos = computed(() => groups.value.length > 1)

/**
 * How many rows a panel in the rail may draw.
 *
 * Four, measured rather than chosen: six panels of five rows overflowed the rail
 * on a 1100px window, and a rail that scrolls by one row is a rail that hides
 * something for no gain. Every panel reports what it cut, so the cap costs a
 * figure rather than a fact — and the page that lists all of it is one click away.
 */
const PANEL_ROWS = 4

const reviewQueue = computed(() => takeSome(orderPulls(pulls.value.reviewing), PANEL_ROWS))
const myPulls = computed(() => takeSome(orderPulls(pulls.value.mine), PANEL_ROWS))

/**
 * How old the GitHub half is. Every panel drawn from it says this.
 *
 * The age, never the error — a failed poll used to replace this with whatever the
 * fetch threw, which is a sentence of unknown length in a heading that does not
 * wrap. The failure is said in the panel instead, where there is room for it and
 * where it can say the thing that actually matters: the list below is the last
 * good read rather than the current state.
 */
const pullsStamp = computed(() => asOfLabel(pulls.value.at, now.value))

/**
 * Repositories whose pull requests could not be read.
 *
 * Named rather than counted, and never silently absent: an empty list because
 * `gh` is not signed in looks exactly like an empty list because nothing is
 * waiting, and only one of those is good news.
 */
const pullProblems = computed(() => takeSome(pulls.value.problems, 2))

const pullsNote = computed(() => {
  const { toMerge, failing } = pulls.value.summary
  const parts: string[] = []
  if (failing) parts.push(`${failing} red`)
  if (toMerge) parts.push(`${toMerge} ready`)
  return parts.join(' · ')
})

/**
 * Everything the inbox found, from every source, as one list.
 *
 * Flattened because the reader does not care which service a waiting thing came
 * from until they decide to go and answer it — at which point the row says so.
 * Two panels of two rows would spend twice the space to make the same point.
 */
const inboxRows = computed(() =>
  inboxSources.value.flatMap(source =>
    source.items.map(item => ({
      key: `${source.key}-${item.id}`,
      source: source.label,
      icon: source.icon,
      title: item.title,
      why: item.why,
      url: item.url,
    })),
  ),
)

const inbox = computed(() => takeSome(inboxRows.value, PANEL_ROWS))

/**
 * Whether any source has ever answered.
 *
 * The empty state turns on this rather than on the item count, because "nothing
 * is waiting" and "nobody has ever asked" are opposite facts that look identical
 * in an empty panel.
 */
const inboxEverChecked = computed(() => inboxSources.value.some(source => source.checkedAt))

const MOOD_LABEL: Record<ReturnType<typeof moodOf>, string> = {
  attention: 'Something needs you',
  busy: 'Work in flight',
  quiet: 'Nothing running',
}

/**
 * The strip of figures under the header.
 *
 * The panels below answer "which one"; this answers "how many", for everything at
 * once and in one place that never scrolls. It is the part of this screen that is
 * a terminal rather than a dashboard: a fixed row of labelled numbers, in the same
 * order every time, so a glance at the same six inches of screen answers the same
 * six questions all day.
 *
 * Only bad news gets a colour. A strip where four of eleven figures are lit is a
 * strip where none of them are.
 */
interface WallStat {
  key: string
  label: string
  value: string
  /** A second, quieter figure about the same thing — `3 failed` beside `41`. */
  note?: string
  tone: WallTone
}

const stats = computed<WallStat[]>(() => {
  const { summary, mine } = pulls.value

  return [
    {
      key: 'needs',
      label: 'needs you',
      value: String(attention.value.needsYou),
      tone: attention.value.needsYou ? 'error' : 'quiet',
    },
    {
      key: 'working',
      label: 'working',
      value: String(attention.value.working),
      tone: attention.value.working ? 'accent' : 'quiet',
    },
    {
      key: 'sessions',
      label: 'sessions',
      // Current over live: the table draws the first number, and the second is
      // what it is a slice of. A quiet screen otherwise reads the same at three
      // sessions and at thirty.
      value: `${current.value.length}/${snapshot.value?.liveSessions ?? current.value.length}`,
      note: repos.value > 1 ? `${repos.value} repos` : undefined,
      tone: 'quiet',
    },
    {
      key: 'review',
      label: 'to review',
      value: String(summary.toReview),
      tone: summary.toReview ? 'accent' : 'quiet',
    },
    {
      key: 'mine',
      label: 'my prs',
      value: String(mine.length),
      note: summary.waiting ? `${summary.waiting} waiting` : undefined,
      tone: 'quiet',
    },
    {
      key: 'red',
      label: 'ci red',
      value: String(summary.failing),
      tone: summary.failing ? 'error' : 'quiet',
    },
    {
      key: 'inbox',
      label: 'inbox',
      value: inboxEverChecked.value ? String(inboxRows.value.length) : '—',
      tone: inboxRows.value.length ? 'warning' : 'quiet',
    },
    {
      key: 'runs',
      label: '24h runs',
      value: String(day.value.runs),
      tone: 'quiet',
    },
    {
      // Its own figure rather than a note beside the run count, because a note
      // does not carry the colour and "28" is not the bad news — "15 failed" is.
      key: 'failed',
      label: 'failed',
      value: String(day.value.failed),
      tone: day.value.failed ? 'error' : 'quiet',
    },
    {
      key: 'hour',
      label: 'last hour',
      value: String(day.value.lastHour),
      tone: 'quiet',
    },
    {
      key: 'landed',
      label: 'landed',
      value: String(landedToday.value.length),
      tone: landedToday.value.length ? 'success' : 'quiet',
    },
    {
      key: 'next',
      label: 'next',
      value: upcoming.value[0] ? untilLabel(upcoming.value[0]!.at, now.value) : '—',
      note: snapshot.value?.pausedRituals ? `${snapshot.value.pausedRituals} stopped` : undefined,
      tone: snapshot.value?.pausedRituals ? 'warning' : 'quiet',
    },
  ]
})

/**
 * Answering, and stopping.
 *
 * Held here rather than in the row so a prompt cannot be answered twice by two
 * clicks, and so a row stays honest about what is in flight while the wall's next
 * poll catches up with the answer.
 */
const answeringIds = ref<string[]>([])
const stoppingIds = ref<string[]>([])

async function answerPrompt(prompt: WallPrompt, decision: { behavior: 'allow' | 'deny'; scope?: 'once' | 'session' }) {
  if (answeringIds.value.includes(prompt.id)) return
  answeringIds.value = [...answeringIds.value, prompt.id]

  try {
    await $fetch(`/api/permissions/${encodeURIComponent(prompt.id)}`, { method: 'POST', body: decision })
    // Straight back to the server rather than waiting out the poll: the whole
    // point of answering here is that the row stops saying "blocked" at once.
    await refresh()
  } catch (e: unknown) {
    report(errorMessage(e))
  } finally {
    answeringIds.value = answeringIds.value.filter(id => id !== prompt.id)
  }
}

async function stopRow(row: { sessionId: string; runId?: string }) {
  if (!row.runId || stoppingIds.value.includes(row.sessionId)) return
  stoppingIds.value = [...stoppingIds.value, row.sessionId]

  try {
    await $fetch(`/api/runs/${encodeURIComponent(row.runId)}/cancel`, { method: 'POST' })
    await refresh()
  } catch (e: unknown) {
    report(errorMessage(e))
  } finally {
    stoppingIds.value = stoppingIds.value.filter(id => id !== row.sessionId)
  }
}

/* ------------------------------------------------------------ right-click -- */

/**
 * What you can do to a row without leaving the screen.
 *
 * The buttons on a row are the two or three things worth a permanent target on a
 * line twenty of which have to fit. Everything else you might reasonably want —
 * its pull request, its branch name, the project it lives in, the review it
 * needs — is a real want that does not deserve a column, and until now the
 * answer to all of them was "go to another page and find it again".
 *
 * Built here rather than in the rows because half the entries need facts a row
 * does not carry. A row knows its repository's *folder name*; which checkout
 * that is, and whether it is the one currently selected, is `useSessions` and
 * `useProjects`, both of which live up here.
 *
 * **Nothing here acts on this screen's copy of anything.** The reading behind a
 * pull request row is up to a minute old and may belong to a repository this
 * screen does not have selected, so every entry that writes selects the project
 * first and then calls the same server route /land calls — which re-reads the
 * pull request before it builds a prompt. The stale reading decides what to
 * offer; it never decides what to do.
 */
const { work: workOnPull } = useGithubPulls()
const { projects, activate, ensureLoaded: loadProjects } = useProjects()
const { workingDir } = useWorkingDir()

/**
 * Whether a right-click menu is open.
 *
 * Only so Escape can mean the nearer thing. This screen's Escape leaves for Now,
 * which is right when the screen is all there is and wrong the moment something
 * is open on top of it — the same reading `pending` already gets a few lines
 * down. Reka closes one menu when another opens, so a boolean is the whole state.
 */
const menuOpen = ref(false)

/** Told, rather than silently nothing: a clipboard can be refused. */
async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    report(`Copied ${what}`)
  } catch {
    report(`Could not copy ${what}`)
  }
}

/**
 * Make a repository the selected one, if it is not already.
 *
 * Every write below goes through this first. `/api/github/pulls/work` reads the
 * project from the request's own header, so acting on a pull request in a
 * repository that is not selected would have started a session in the wrong
 * checkout — which is the failure this screen used to avoid by refusing to act
 * at all.
 */
async function ensureProject(repoDir: string | undefined): Promise<boolean> {
  if (!repoDir) {
    report('That row does not say which checkout it belongs to')
    return false
  }
  if (workingDir.value === repoDir) return true

  try {
    await activate(repoDir)
    return true
  } catch (e: unknown) {
    report(errorMessage(e))
    return false
  }
}

/** Start a session on a pull request, from the server's reading and not this one. */
async function startOnPull(pull: WallPull, intent?: 'review' | 'address' | 'fix' | 'update') {
  if (!await ensureProject(pull.repoDir)) return

  try {
    const session = await workOnPull(pull.number, intent)
    await router.push(`/sessions/${session.id}`)
  } catch (e: unknown) {
    report(errorMessage(e))
  }
}

/** The checkout a session row belongs to, which the snapshot does not carry. */
function repoDirOf(sessionId: string): string | undefined {
  return sessions.value.find(s => s.id === sessionId)?.repoDir
}

function sessionMenu(row: WallRowData) {
  const repoDir = repoDirOf(row.sessionId)
  const prompt = row.prompts[0]

  const open: ContextMenuItem[] = [
    { label: 'Open session', icon: 'i-lucide-arrow-right', to: `/sessions/${row.sessionId}` },
  ]
  if (row.detail?.prUrl ?? row.prUrl) {
    open.push({
      label: 'Open pull request',
      icon: 'i-lucide-git-pull-request',
      to: row.detail?.prUrl ?? row.prUrl,
      target: '_blank',
    })
  }

  // Only what this row can actually do right now. An "Allow" on a row nothing is
  // asking about is a menu teaching you not to read it.
  const act: ContextMenuItem[] = []
  if (prompt) {
    act.push(
      {
        label: 'Allow once',
        icon: 'i-lucide-check',
        disabled: answeringIds.value.includes(prompt.id),
        onSelect: () => void answerPrompt(prompt, { behavior: 'allow', scope: 'once' }),
      },
      {
        label: 'Deny',
        icon: 'i-lucide-x',
        color: 'error' as const,
        disabled: answeringIds.value.includes(prompt.id),
        onSelect: () => void answerPrompt(prompt, { behavior: 'deny' }),
      },
    )
  }
  if (row.activity === 'working' && row.runId) {
    act.push({
      label: 'Stop this turn',
      icon: 'i-lucide-square',
      disabled: stoppingIds.value.includes(row.sessionId),
      onSelect: () => void stopRow(row),
    })
  }

  const where: ContextMenuItem[] = [
    { label: 'Copy branch', icon: 'i-lucide-copy', onSelect: () => void copy(row.branch, 'the branch name') },
  ]
  if (repoDir && repoDir !== workingDir.value) {
    where.push({
      label: `Switch to ${row.repo}`,
      icon: 'i-lucide-folder-git-2',
      onSelect: () => void ensureProject(repoDir),
    })
  }

  return [open, act, where].filter(group => group.length)
}

function pullMenu(pull: WallPull) {
  const open: ContextMenuItem[] = [
    { label: 'Open on GitHub', icon: 'i-lucide-external-link', to: pull.url, target: '_blank' },
  ]

  // One entry, worded by whose it is. Somebody else's pull request is a review;
  // your own is whatever the server decides it needs when it re-reads it, which
  // is the same judgement the badge on this row came from.
  const act: ContextMenuItem[] = [
    {
      label: pull.mine ? 'Start a session on it' : 'Review it here',
      icon: 'i-lucide-git-branch',
      onSelect: () => void startOnPull(pull, pull.mine ? undefined : 'review'),
    },
  ]

  const where: ContextMenuItem[] = [
    { label: 'Copy link', icon: 'i-lucide-copy', onSelect: () => void copy(pull.url, 'the link') },
  ]
  if (pull.repoDir && pull.repoDir !== workingDir.value) {
    where.push({
      label: `Switch to ${pull.repo}`,
      icon: 'i-lucide-folder-git-2',
      onSelect: () => void ensureProject(pull.repoDir),
    })
  }

  return [open, act, where]
}

/**
 * Go and look elsewhere, because somebody pressed the button.
 *
 * The only thing on this screen that spends money without a turn being started,
 * so the refusal is reported in words rather than swallowed — a source that is not
 * configured has to say that instead of appearing to do nothing.
 */
async function lookAgain(key: string, label: string) {
  if (inboxRefreshing.value) return

  const result = await refreshInbox(key)
  if (!result.ok) report(`Could not check ${label}: ${result.reason}`)
}

/**
 * The sound of the fleet.
 *
 * Driven off the same snapshots the screen draws, diffed rather than streamed:
 * what plays is what *changed* between two polls, which is the only definition
 * under which silence means "nothing happened" rather than "nothing is connected".
 * `utils/sound.ts` decides what that is; this only hands it the pair.
 */
const sound = useSound()

/**
 * What the noises mean, on the control that makes them.
 *
 * A screen left running in a shared room makes sounds other people hear, and the
 * first question is always "what was that?". The vocabulary is six lines, which is
 * short enough to answer that in a tooltip and too long to put on the screen
 * permanently.
 */
const soundLegend = computed(() => {
  const vocabulary = Object.values(SOUND_LABELS).join('\n')
  return sound.enabled.value
    ? `Sound on — S\n\n${vocabulary}`
    : 'Turn on sound — S'
})

/** The newest tick already accounted for, so the same one is never played twice. */
let heardTickAt = 0

watch(snapshot, (next, previous) => {
  if (!next) return

  const { events, tickAt } = diffSounds(previous ?? null, next, heardTickAt)
  heardTickAt = tickAt
  sound.emit(events)
})

/**
 * Speaking to the screen.
 *
 * Off until switched on, held down to be heard, and confirmed by hand before
 * anything runs. The grammar and — more to the point — what it refuses live in
 * `utils/voice.ts`; the microphone and the privacy caveat that comes with it live
 * in `useVoice`. What is left here is the wiring: what each understood command
 * actually does on this machine.
 */
const voice = useVoice()

/** A command that will start or stop work, waiting for a keypress. */
const pending = ref<VoiceCommand | null>(null)
/** What the last one did, shown for a few seconds and then forgotten. */
const outcome = ref<string | null>(null)
let outcomeTimer: ReturnType<typeof setTimeout> | null = null

function report(text: string, spoken = text) {
  outcome.value = text
  voice.speak(spoken)
  if (outcomeTimer) clearTimeout(outcomeTimer)
  outcomeTimer = setTimeout(() => { outcome.value = null }, 8000)
}

/**
 * Asked once, before the microphone is ever opened.
 *
 * Chrome's speech recognition sends the audio to Google. Everything else this app
 * does is local, so switching this on is a decision somebody should make knowing
 * that — not something to discover in a network tab afterwards. Remembered, so it
 * is asked once per machine rather than nagging a display every morning.
 */
const CONSENT_KEY = 'agents-ui:wall-voice-consent'
const askingConsent = ref(false)

function toggleVoice() {
  if (voice.enabled.value) {
    voice.setEnabled(false)
    pending.value = null
    return
  }

  if (import.meta.client && localStorage.getItem(CONSENT_KEY) !== '1') {
    askingConsent.value = true
    return
  }

  voice.setEnabled(true)
}

function acceptConsent() {
  localStorage.setItem(CONSENT_KEY, '1')
  askingConsent.value = false
  voice.setEnabled(true)
}

/** Held: listen. Released: parse once, and act or ask. */
function heard(transcript: string) {
  const command = parseCommand(transcript)

  if (command.kind === 'unknown') {
    report(describeVoice(command), 'I did not catch that')
    return
  }

  if (command.kind === 'refused') {
    // Said out loud as well as shown. A room that hears *why* learns the
    // boundary; a room that watches nothing happen learns the thing is broken.
    report(command.why)
    return
  }

  if (needsConfirmation(command)) {
    pending.value = command
    voice.speak(describeVoice(command))
    return
  }

  runCommand(command)
}

async function runCommand(command: VoiceCommand) {
  pending.value = null

  switch (command.kind) {
    case 'session':
      await startSpokenSession(command.instruction, command.project)
      return

    case 'stop':
      await stopWork(command.project)
      return
  }
}

/**
 * A spoken instruction becomes a session, exactly as though it had been typed.
 *
 * The repository is resolved against the projects already registered and never
 * against the filesystem — see `matchProject` — and falls back to the one this
 * app is pointed at rather than guessing. A named project that matches nothing is
 * refused in words instead of quietly landing in the wrong repo, which is the one
 * mistake here that would be expensive.
 */
async function startSpokenSession(instruction: string, spokenProject?: string) {
  const named = matchProject(spokenProject, projects.value)

  if (spokenProject && !named) {
    report(`No project here is called ${spokenProject}.`)
    return
  }

  const repoDir = named?.path ?? workingDir.value
  if (!repoDir) {
    report('Pick a project first — a session needs a repository to branch from.')
    return
  }

  try {
    const session = await $fetch<{ id: string; title: string }>('/api/sessions', {
      method: 'POST',
      body: { prompt: instruction, repoDir },
    })

    report(`Started: ${session.title}`, `Started a session: ${instruction}`)
  } catch (e: unknown) {
    const message = (e as { data?: { data?: { message?: string } } })?.data?.data?.message
    report(message ?? 'That session could not be started.')
  }
}

/**
 * The brake. Cancels the turn each live session is on, which keeps everything
 * already written — stopping ends the turn, not the work, exactly as the button
 * on a session does.
 */
async function stopWork(spokenProject?: string) {
  const named = matchProject(spokenProject, projects.value)

  if (spokenProject && !named) {
    report(`No project here is called ${spokenProject}.`)
    return
  }

  const targets = current.value.filter(tile =>
    tile.runId && tile.activity === 'working' && (!named || tile.repo === named.name),
  )

  if (!targets.length) {
    report('Nothing is running.')
    return
  }

  const stopped = await Promise.all(targets.map(async (tile) => {
    try {
      await $fetch(`/api/runs/${encodeURIComponent(tile.runId!)}/cancel`, { method: 'POST' })
      return true
    } catch {
      return false
    }
  }))

  const count = stopped.filter(Boolean).length
  report(count
    ? `Stopped ${count} ${count === 1 ? 'turn' : 'turns'}. What they wrote is still there.`
    : 'Nothing could be stopped.')
}

/**
 * Escape leaves, `F` fills the screen, `S` is sound, held `V` is voice.
 *
 * On the page rather than as buttons only, because the machine driving a screen
 * like this is often not the one you are sitting at — a keyboard reachable once,
 * during setup, is the whole interaction it expects to have.
 */
function onKey(event: KeyboardEvent) {
  /**
   * A command waiting for a hand owns the keyboard until it is answered.
   *
   * Escape means "not that" here rather than "leave the screen", which is the
   * safer reading of the same key: somebody who has just heard it offer to start
   * an agent and hits Escape is cancelling, not navigating.
   */
  // An open menu owns Escape, and handles it itself. Falling through to the
  // switch below closed the menu and left the screen in one keypress.
  if (menuOpen.value && event.key === 'Escape') return

  if (pending.value) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void runCommand(pending.value)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      pending.value = null
      report('Dropped.')
      return
    }
  }

  // Held rather than pressed: the microphone is open only while the key is down.
  // `repeat` is what a held key sends after the first event, and starting the
  // recogniser again on each of those would abort the utterance in progress.
  if ((event.key === 'v' || event.key === 'V') && !event.repeat) {
    if (voice.enabled.value) voice.start()
    return
  }

  switch (event.key) {
    case 'Escape':
      void router.push('/')
      return
    case 'f':
    case 'F':
      void toggleFullscreen()
      return
    case 's':
    case 'S':
      sound.toggle()
      return
  }
}

/** The key coming up is what ends the utterance, and the only thing that does. */
function onKeyUp(event: KeyboardEvent) {
  if (event.key !== 'v' && event.key !== 'V') return
  if (!voice.enabled.value) return

  const transcript = voice.stop()

  // Silence after a key press reads as a broken microphone. It is usually a
  // press too short to catch a word, and saying so is the difference between
  // "try again" and "this does not work".
  if (!transcript) {
    report('Nothing heard.', '')
    return
  }

  heard(transcript)
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    // Refused because it was not asked for by a gesture, or unsupported. The
    // page is unaffected, and saying so would be noise on a display.
  }
}

/** Hidden after a few still seconds, restored the moment the mouse moves. */
const cursorHidden = ref(false)
let idleTimer: ReturnType<typeof setTimeout> | null = null

function stirCursor() {
  cursorHidden.value = false
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { cursorHidden.value = true }, 4000)
}

onMounted(() => {
  document.addEventListener('keydown', onKey)
  document.addEventListener('keyup', onKeyUp)
  window.addEventListener('mousemove', stirCursor)
  stirCursor()
  // Needed before a spoken project name can be matched against anything.
  void loadProjects()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('mousemove', stirCursor)
  if (idleTimer) clearTimeout(idleTimer)
  if (outcomeTimer) clearTimeout(outcomeTimer)
})
</script>

<template>
  <div class="wall" :class="{ 'is-idle': cursorHidden }">
    <header class="wall-header">
      <div class="wall-head">
        <!--
          Out, and back to the app. Top left because that is where a back arrow
          lives in every other piece of software somebody has ever used, and this
          is the one control on the screen that has to be findable without being
          looked for — the sidebar is suppressed on this route, so it is the only
          way out that does not involve knowing about Escape.
        -->
        <NuxtLink to="/" class="wall-back" title="Back to Now — Esc" aria-label="Back to Now">
          <UIcon name="i-lucide-arrow-left" class="size-4" />
        </NuxtLink>

        <span class="wall-mood" :style="{ background: MOOD_TONES[mood] }" :title="MOOD_LABEL[mood]" />
        <h1 class="wall-brand">Fleet</h1>

        <p v-if="bands.length" class="wall-bands">
          <span v-for="(band, index) in bands" :key="band.urgency">
            <span v-if="index" class="wall-band-sep">·</span>
            <span class="wall-band" :class="`is-${band.urgency}`">
              {{ band.count }} {{ band.label.toLowerCase() }}
            </span>
          </span>
          <span v-if="repos > 1" class="wall-band-sep">·</span>
          <span v-if="repos > 1" class="wall-band is-settled">{{ repos }} repos</span>
        </p>
        <p v-else class="wall-bands">
          <span class="wall-band is-settled">nothing running</span>
        </p>
      </div>

      <!--
        Everything that is *read*, on one baseline.

        The meters are two-line blocks — a caption over a bar — and the clock is a
        single line of much larger type. Centring them against each other put the
        captions six pixels above the clock's baseline: each one vertically
        centred and none of them lined up. Aligning by baseline instead lets the
        bars hang below the line the words share, which is where a bar belongs.
      -->
      <div class="wall-readouts">
        <WallMeter v-if="quota" label="Limit" :meter="quota" />
        <WallMeter label="Today" :meter="spend" />
        <span class="wall-clock">{{ clock }}</span>
      </div>
    </header>

    <!--
      The tape of figures. Fixed order, one line, never scrolls — see `stats`.
    -->
    <div class="wall-stats">
      <span v-for="stat in stats" :key="stat.key" class="wall-stat" :class="`is-${stat.tone}`">
        <span class="wall-stat-label">{{ stat.label }}</span>
        <span class="wall-stat-value">{{ stat.value }}</span>
        <span v-if="stat.note" class="wall-stat-note">{{ stat.note }}</span>
      </span>
    </div>

    <p v-if="!connected" class="wall-offline">
      <UIcon name="i-lucide-unplug" class="size-4 shrink-0" />
      This screen is not being updated — the server stopped answering. What is
      below is the last it said.
    </p>

    <main class="wall-main">
      <!--
        The table. Grouped by repository only when there is more than one, because
        a single header over every row on the screen is a header that says nothing.
      -->
      <section class="wall-table" aria-label="Sessions">
        <!--
          Named columns, because three right-aligned numbers with no headings is a
          riddle. They are the reason this is a table rather than a list: the same
          fact in the same place on every row is what makes twenty of them
          readable down the screen as well as across.
        -->
        <header v-if="rows.length" class="wall-columns">
          <span class="wall-col-where">repo · branch</span>
          <span class="wall-col-title">session</span>
          <span class="wall-col-doing">doing</span>
          <span class="wall-col-num" title="Files changed against the base">files</span>
          <span class="wall-col-num" title="Commits on the base this session does not have">behind</span>
          <span class="wall-col-num" title="Turns taken">turns</span>
          <span class="wall-col-num">for</span>
          <span class="wall-col-actions" />
        </header>

        <div v-if="rows.length" class="wall-scroll">
          <div v-for="group in groups" :key="group.repo" class="wall-group">
            <header v-if="manyRepos" class="wall-group-head">
              <span class="wall-group-name">{{ group.repo }}</span>
              <span class="wall-group-counts">
                <span v-for="band in bandsOf(group.tiles)" :key="band.urgency" :class="`is-${band.urgency}`">
                  {{ band.count }} {{ band.label.toLowerCase() }}
                </span>
              </span>
            </header>

            <WallRow
              v-for="row in group.tiles"
              :key="row.sessionId"
              :row="row"
              :now="now"
              :busy="answeringIds"
              :stopping="stoppingIds.includes(row.sessionId)"
              :menu="sessionMenu(row)"
              @answer="(prompt, decision) => answerPrompt(prompt, decision)"
              @stop="stopRow(row)"
              @menu-open="open => { menuOpen = open }"
            />
          </div>
        </div>

        <!--
          The quiet state, which is most of a working day and so is not treated as
          an absence: what somebody glancing at an idle screen wants is the
          reassurance that it is idle on purpose.
        -->
        <div v-else class="wall-empty">
          <UIcon name="i-lucide-moon-star" class="wall-empty-icon" />
          <p class="wall-empty-line">Nothing is running.</p>
          <p v-if="upcoming[0]" class="wall-empty-next">
            {{ upcoming[0].title }}
            <span class="wall-empty-when">{{ untilLabel(upcoming[0].at, now) }}</span>
          </p>
          <p v-else class="wall-empty-next">No scheduled work is due.</p>
        </div>
      </section>

      <!--
        The rail: six panels in two columns, each on its own clock and each saying
        which one.

        The two columns have a fixed membership rather than being auto-placed,
        because auto-placement makes rows: a short panel beside a tall one is
        stretched to the row's height or leaves a hole under it, and both read as a
        panel that has lost something. Two independent columns are two independent
        stacks, and which panel is in which is a judgement — the urgent half sits
        nearest the table, where the eye already is.
      -->
      <div class="wall-rails">
       <div class="wall-rail">
        <WallPanel title="Needs you" :count="attention.needsYou" loud :hidden="Math.max(0, attention.items.length - PANEL_ROWS)">
          <ul v-if="attention.items.length" class="wall-list">
            <li v-for="item in attention.items.slice(0, PANEL_ROWS)" :key="`${item.kind}-${item.id}`" class="wall-list-row">
              <span class="wall-list-dot" />
              <span class="min-w-0">
                <span class="wall-list-title truncate">{{ item.title }}</span>
                <span class="wall-list-because truncate">{{ item.because }}</span>
              </span>
            </li>
          </ul>
          <p v-else class="wall-panel-empty">Nothing is waiting on you.</p>
        </WallPanel>

        <WallPanel
          title="Your review"
          :count="pulls.summary.toReview"
          :loud="Boolean(pulls.summary.toReview)"
          :stamp="pullsStamp"
          :hidden="reviewQueue.hidden"
        >
          <template #actions>
            <!--
              The refresh, for somebody standing in front of the screen who has
              just merged something. The server holds a reading for a minute; this
              is the one button that says never mind that.
            -->
            <button
              class="wall-panel-button"
              :disabled="pullsRefreshing"
              title="Ask GitHub again now — normally read once a minute"
              @click="refreshPulls(true)"
            >
              <UIcon name="i-lucide-refresh-cw" class="size-3" :class="{ 'animate-spin': pullsRefreshing }" />
            </button>
          </template>

          <div v-if="reviewQueue.shown.length" class="wall-pulls">
            <WallPullRow
              v-for="pull in reviewQueue.shown"
              :key="pull.url"
              :pull="pull"
              :now="now"
              :menu="pullMenu(pull)"
              @menu-open="open => { menuOpen = open }"
            />
          </div>
          <p v-else-if="pulls.repos" class="wall-panel-empty">No review has been asked of you.</p>
          <p v-else class="wall-panel-empty">No repository here could be read.</p>

          <!--
            A repository that could not be answered for, named. An empty list
            because `gh` is not signed in must never look like an empty list
            because nothing is waiting.
          -->
          <p v-for="problem in pullProblems.shown" :key="problem.repo" class="wall-problem">
            <UIcon name="i-lucide-triangle-alert" class="wall-problem-icon shrink-0" />
            <span class="truncate"><strong>{{ problem.repo }}</strong> — {{ problem.reason }}</span>
          </p>
          <p v-if="pullProblems.hidden" class="wall-problem">
            and {{ pullProblems.hidden }} more that could not be read
          </p>

          <!--
            The last poll failed. Said in the panel rather than in the stamp,
            because the news is not "this is old" — it is that what is on screen is
            the last good read and nothing since has been seen.
          -->
          <p v-if="pullsError" class="wall-problem" :title="pullsError">
            <UIcon name="i-lucide-unplug" class="wall-problem-icon shrink-0" />
            <span class="truncate">GitHub could not be asked just now — this is the last it said.</span>
          </p>
        </WallPanel>

        <WallPanel
          title="Next up"
          :note="snapshot?.pausedRituals ? `${snapshot.pausedRituals} stopped` : ''"
        >
          <ul v-if="upcoming.length" class="wall-list is-tight">
            <li v-for="ritual in upcoming" :key="ritual.id" class="wall-list-row">
              <UIcon name="i-lucide-clock" class="wall-list-icon is-quiet shrink-0" />
              <span class="min-w-0 flex-1">
                <span class="wall-list-title truncate">{{ ritual.title }}</span>
                <span v-if="ritual.repo" class="wall-list-because truncate">{{ ritual.repo }}</span>
              </span>
              <span class="wall-list-when">{{ untilLabel(ritual.at, now) }}</span>
            </li>
          </ul>
          <p v-else class="wall-panel-empty">No scheduled work is due.</p>
        </WallPanel>

        <WallPanel title="Landed today" :count="landedToday.length" :hidden="Math.max(0, landedToday.length - PANEL_ROWS)">
          <ul v-if="landedToday.length" class="wall-list">
            <li v-for="entry in landedToday.slice(0, PANEL_ROWS)" :key="entry.sessionId" class="wall-list-row">
              <UIcon name="i-lucide-git-merge" class="wall-list-icon shrink-0" />
              <NuxtLink :to="`/sessions/${entry.sessionId}`" class="min-w-0">
                <span class="wall-list-title truncate">{{ entry.title }}</span>
                <span class="wall-list-because truncate">{{ entry.repo }} · {{ landedLabel(entry.how) }}</span>
              </NuxtLink>
            </li>
          </ul>
          <p v-else class="wall-panel-empty">Nothing has landed today.</p>
        </WallPanel>
       </div>

       <div class="wall-rail">
        <WallPanel
          title="Your pull requests"
          :count="pulls.mine.length"
          :note="pullsNote"
          :hidden="myPulls.hidden"
        >
          <div v-if="myPulls.shown.length" class="wall-pulls">
            <WallPullRow
              v-for="pull in myPulls.shown"
              :key="pull.url"
              :pull="pull"
              :now="now"
              :menu="pullMenu(pull)"
              @menu-open="open => { menuOpen = open }"
            />
          </div>
          <p v-else class="wall-panel-empty">Nothing of yours is open.</p>
        </WallPanel>

        <WallPanel
          title="Elsewhere"
          :count="inboxRows.length"
          :hidden="inbox.hidden"
        >
          <ul v-if="inbox.shown.length" class="wall-list">
            <li v-for="row in inbox.shown" :key="row.key" class="wall-list-row">
              <UIcon :name="row.icon" class="wall-list-icon is-quiet shrink-0" />
              <a :href="row.url" target="_blank" rel="noopener" class="min-w-0" :title="row.why">
                <span class="wall-list-title truncate">{{ row.title }}</span>
                <span class="wall-list-because truncate">{{ row.why }}</span>
              </a>
            </li>
          </ul>
          <p v-else-if="inboxEverChecked" class="wall-panel-empty">Nothing is waiting on you elsewhere.</p>
          <p v-else class="wall-panel-empty">Nobody has looked yet.</p>

          <!--
            Per source, because the age of the answer is part of the answer and
            each source has its own. In seconds rather than dollars, for the reason
            the Now queue gives: on a subscription the recorded cost is notional,
            and a figure in dollars beside a button reads as a charge.
          -->
          <div class="wall-sources">
            <span v-for="source in inboxSources" :key="source.key" class="wall-source">
              <UIcon :name="source.icon" class="wall-source-icon shrink-0" />
              <span class="wall-source-name">{{ source.label.toLowerCase() }}</span>
              <span v-if="source.error" class="wall-source-bad truncate" :title="source.error">unavailable</span>
              <span v-else class="wall-source-age">
                {{ source.checkedAt ? sinceLabel(source.checkedAt, now) : 'never' }}
              </span>
              <button
                class="wall-source-button"
                :disabled="inboxRefreshing !== null"
                :title="`Go and look now — a check takes a minute or two${source.error ? `\n\nLast time: ${source.error}` : ''}`"
                @click="lookAgain(source.key, source.label)"
              >
                {{ inboxRefreshing === source.key ? 'looking…' : 'check' }}
              </button>
            </span>
          </div>
        </WallPanel>

       </div>
      </div>
    </main>

    <!--
      The heartbeat, and the controls that used to be in the corner.

      The ticker is here rather than in the rail because it is the one thing on the
      screen that is neither a list nor a figure: it is proof of life, and without
      it a quiet minute reads as a machine that has stopped. The toggles sit at its
      right because they are for the minute somebody sets this up, not for the days
      it then runs — a control cluster in the top right corner spent the most
      valuable space on the screen on three things nobody presses twice.
    -->
    <section class="wall-tape">
      <WallTicker class="wall-tape-feed" line :ticks="snapshot?.ticker ?? []" :now="now" />

      <div class="wall-tools">
        <button
          v-if="sound.supported.value"
          class="wall-control"
          :class="{ 'is-on': sound.enabled.value }"
          :title="soundLegend"
          @click="sound.toggle()"
        >
          <UIcon :name="sound.enabled.value ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" class="size-4" />
        </button>
        <button
          class="wall-control"
          :class="{ 'is-on': voice.enabled.value }"
          :title="voice.enabled.value ? 'Voice on — hold V to speak' : 'Turn on voice'"
          @click="toggleVoice"
        >
          <UIcon :name="voice.enabled.value ? 'i-lucide-mic' : 'i-lucide-mic-off'" class="size-4" />
        </button>
        <button class="wall-control" title="Fullscreen — F" @click="toggleFullscreen">
          <UIcon name="i-lucide-maximize" class="size-4" />
        </button>
      </div>
    </section>

    <!--
      The disclosure, before the microphone is ever opened. Worded as the
      exception it is: this app is otherwise entirely local.
    -->
    <div v-if="askingConsent" class="wall-consent">
      <UIcon name="i-lucide-mic" class="size-5 shrink-0" />
      <div class="min-w-0">
        <p class="wall-consent-line">
          Speech is transcribed by Google, not on this machine.
        </p>
        <p class="wall-consent-detail">
          Chrome sends the audio captured while you hold <kbd>V</kbd> to its own
          speech service. Nothing is listened to between key presses, and this is
          the only part of this app that leaves your computer.
        </p>
      </div>
      <div class="wall-consent-actions">
        <button class="wall-consent-button is-primary" @click="acceptConsent">Turn it on</button>
        <button class="wall-consent-button" @click="askingConsent = false">Not now</button>
      </div>
    </div>

    <WallVoice
      v-if="voice.enabled.value || outcome"
      class="wall-voice"
      :state="voice.state.value"
      :transcript="voice.transcript.value"
      :pending="pending"
      :outcome="outcome"
      :error="voice.error.value"
    />

    <!--
      No chart of last night here any more.

      It was the original bottom third of this screen and it went the way cinema
      mode did, for the same reason: this is read to decide what to look at *now*,
      and a picture of the last twenty-four hours answers a question nobody
      standing in front of it is asking. What was worth keeping from it is in the
      figure strip — how many runs, how many failed, how many in the last hour —
      and the chart itself is still on Now, where a retrospective belongs.
    -->
  </div>
</template>

<style scoped>
.wall {
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: clamp(6px, 0.8vh, 12px);
  padding: clamp(10px, 1.1vw, 20px);
  background: var(--surface-base);
  overflow: hidden;
}

.wall.is-idle {
  cursor: none;
}

/*
 * The whole header sits on one baseline, not just each half of it.
 *
 * Both halves align internally by baseline, but centring the two *groups* against
 * each other put "Fleet" five pixels below the readouts on the right: every
 * element vertically centred, and no two of them on the same line. Aligning the
 * header itself by baseline resolves each group to its own first line, which is
 * the line the reader sees.
 */
.wall-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 20px;
  flex-shrink: 0;
}

.wall-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

/*
 * The way out. Quiet, and never faint: this is the only exit on a route with no
 * sidebar, so the hover-to-reveal treatment the old control cluster had would be
 * wrong here — a back arrow you have to find by waving a mouse at the corner is
 * not a back arrow.
 */
.wall-back {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  flex-shrink: 0;
  /* No text of its own, so it centres on the line rather than sitting on the
     baseline the words share. */
  align-self: center;
  color: var(--text-tertiary);
  border: 1px solid var(--border-subtle);
}

.wall-back:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.wall-mood {
  width: clamp(8px, 0.7vw, 12px);
  height: clamp(8px, 0.7vw, 12px);
  border-radius: 999px;
  flex-shrink: 0;
  /* No text of its own, so it is centred on the line rather than sitting on the
     baseline, where a bare dot reads as a full stop. */
  align-self: center;
  transition: background 0.6s ease;
}

.wall-brand {
  font-family: var(--font-display, var(--font-sans));
  font-size: clamp(16px, 1.35vw, 25px);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.wall-bands {
  font-family: var(--font-sans);
  font-size: clamp(11px, 0.9vw, 15px);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wall-band-sep {
  margin: 0 7px;
  color: var(--text-disabled);
}

.wall-band.is-needs-you { color: var(--accent); }
.wall-band.is-broken { color: var(--error); }
.wall-band.is-working { color: var(--text-secondary); }
.wall-band.is-settled { color: var(--text-tertiary); }

/*
 * One baseline for everything the header states.
 *
 * A flex item's baseline is its first line's baseline, so a meter aligns by its
 * caption and lets its bar hang below — which is what puts the captions and the
 * clock on the single line the eye expects.
 */
.wall-readouts {
  display: flex;
  align-items: baseline;
  gap: clamp(12px, 1.6vw, 26px);
  min-width: 0;
}

/*
 * Each meter as wide as the words in it, floored only so a very short value still
 * draws a bar worth seeing. A fixed width was tried twice and was wrong twice:
 * too wide stretched the name and its value to opposite ends of nothing, too
 * narrow truncated "five-hour has room" into an ellipsis.
 */
.wall-readouts > .wall-meter {
  flex: 0 0 auto;
  min-width: 96px;
}

.wall-clock {
  font-family: var(--font-mono);
  font-size: clamp(15px, 1.4vw, 26px);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

/* ── The tape of figures ─────────────────────────────────────────────────── */

/*
 * One row, fixed order, wrapping only when the window is genuinely too narrow.
 *
 * The order never changes and that is the whole value: the same six inches of
 * screen answers the same six questions all day, so reading it becomes a glance
 * rather than a search. Sorting these by whichever is currently interesting would
 * be the single worst thing that could be done to this row.
 */
.wall-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px clamp(10px, 1.3vw, 22px);
  flex-shrink: 0;
  padding: 5px clamp(8px, 0.8vw, 14px);
  border-radius: 8px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
}

.wall-stat {
  display: flex;
  align-items: baseline;
  gap: 5px;
  white-space: nowrap;
}

.wall-stat-label {
  font-family: var(--font-sans);
  font-size: clamp(9px, 0.66vw, 11.5px);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-disabled);
}

.wall-stat-value {
  font-family: var(--font-mono);
  font-size: clamp(12px, 0.95vw, 16px);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.wall-stat-note {
  font-family: var(--font-sans);
  font-size: clamp(9px, 0.68vw, 11.5px);
  color: var(--text-disabled);
}

/*
 * Only bad news is lit. A strip where four figures of eleven have a colour is a
 * strip where none of them do, so `quiet` — the ordinary case — deliberately has
 * no rule of its own beyond the default above.
 */
.wall-stat.is-accent .wall-stat-value { color: var(--accent); }
.wall-stat.is-error .wall-stat-value { color: var(--error); }
.wall-stat.is-warning .wall-stat-value { color: var(--warning); }
.wall-stat.is-success .wall-stat-value { color: var(--success); }

.wall-offline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 12px;
  border-radius: 8px;
  font-family: var(--font-sans);
  font-size: clamp(12px, 0.9vw, 16px);
  color: var(--error);
  background: var(--error-wash);
  border: 1px solid var(--error-edge);
}

/* ── The two halves ──────────────────────────────────────────────────────── */

.wall-main {
  flex: 1;
  min-height: 0;
  display: grid;
  /*
   * The table keeps the room and the rail gets two columns of it, because six
   * panels stacked in one column is a rail nobody can see the bottom of. Below
   * about 1400px there is not width for two, and the media query at the end of
   * this block falls back to one.
   */
  grid-template-columns: minmax(0, 1fr) clamp(300px, 33vw, 640px);
  gap: clamp(8px, 1vw, 18px);
}

/*
 * The fleet column keeps `min-height: 0` inside its own component; the grid
 * needs it here too, because a grid item's default minimum is its content and
 * without it the table grows past the viewport the moment there are more rows
 * than fit — pushing the tape under it off the screen.
 */
.wall-main > * {
  min-width: 0;
  min-height: 0;
}

/*
 * Two independent stacks, and the one scrolling surface on this side.
 *
 * The crowded case is the expected one, so the rail scrolls rather than squeezing
 * — a panel compressed to two rows is a panel lying about how much is waiting.
 */
.wall-rails {
  display: flex;
  align-items: flex-start;
  gap: clamp(6px, 0.7vw, 12px);
  overflow-y: auto;
}

.wall-rail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(6px, 0.7vw, 12px);
}

/* Below about 1400px there is not width for two columns of panels beside a table,
   so the rail narrows to one and the six stack in the order they are written. */
@media (max-width: 1400px) {
  .wall-main {
    grid-template-columns: minmax(0, 1fr) clamp(230px, 27vw, 340px);
  }

  .wall-rails {
    flex-direction: column;
  }
}

/* ── Panels ──────────────────────────────────────────────────────────────── */

.wall-panel-empty {
  font-family: var(--font-sans);
  font-size: clamp(10.5px, 0.8vw, 14px);
  color: var(--text-disabled);
}

.wall-panel-button {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  flex-shrink: 0;
  color: var(--text-disabled);
  cursor: pointer;
}

.wall-panel-button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-secondary);
}

.wall-panel-button:disabled {
  cursor: default;
}

.wall-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}

/* A list of one-line rows does not need the room two-line ones do. */
.wall-list.is-tight {
  gap: 3px;
}

.wall-list-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  min-width: 0;
}

.wall-list-dot {
  width: 6px;
  height: 6px;
  margin-top: 5px;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--error);
}

.wall-list-icon {
  width: clamp(11px, 0.85vw, 14px);
  height: clamp(11px, 0.85vw, 14px);
  margin-top: 2px;
  color: var(--success);
}

/* Everything that is not news: a clock, a source's own mark. */
.wall-list-icon.is-quiet {
  color: var(--text-disabled);
}

.wall-list-title {
  display: block;
  font-family: var(--font-sans);
  font-size: clamp(11px, 0.85vw, 15px);
  font-weight: 500;
  color: var(--text-primary);
}

.wall-list-because {
  display: block;
  font-family: var(--font-sans);
  font-size: clamp(10px, 0.75vw, 13px);
  color: var(--text-tertiary);
}

.wall-list-when {
  font-family: var(--font-mono);
  font-size: clamp(9.5px, 0.72vw, 12.5px);
  color: var(--accent);
  white-space: nowrap;
  flex-shrink: 0;
}

.wall-pulls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

/*
 * A repository that could not be read, in the panel it is missing from.
 *
 * Not a toast and not a tooltip: this is the difference between "nothing is
 * waiting" and "we could not ask", and it has to be readable without a mouse.
 */
.wall-problem {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  margin-top: 5px;
  font-family: var(--font-sans);
  font-size: clamp(9.5px, 0.72vw, 12.5px);
  color: var(--warning);
}

.wall-problem-icon {
  width: 11px;
  height: 11px;
}

/* Where the rows from elsewhere came from, and how long ago somebody asked. */
.wall-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
}

.wall-source {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: clamp(9.5px, 0.7vw, 12px);
  color: var(--text-disabled);
}

.wall-source-icon {
  width: 11px;
  height: 11px;
}

.wall-source-name {
  color: var(--text-tertiary);
}

.wall-source-age {
  font-family: var(--font-mono);
}

.wall-source-bad {
  color: var(--warning);
}

.wall-source-button {
  color: var(--accent);
  cursor: pointer;
}

.wall-source-button:hover:not(:disabled) {
  text-decoration: underline;
}

.wall-source-button:disabled {
  color: var(--text-disabled);
  cursor: default;
}

/* ── The table ───────────────────────────────────────────────────────────── */

/*
 * The column header, aligned with `WallRow`'s grid by repeating it. Two grids that
 * have to agree is a real cost; the alternative is one grid over both, which makes
 * every row a member of a single enormous layout and takes the expandable prompt
 * line with it. Kept in step by a comment in each place and by there being exactly
 * two of them.
 */
.wall-columns {
  display: grid;
  grid-template-columns:
    16px
    minmax(120px, 15%)
    minmax(140px, 1fr)
    minmax(140px, 30%)
    40px 46px 40px
    46px
    46px;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-default);
  background: var(--surface-base);
  font-family: var(--font-sans);
  font-size: 10px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-disabled);
}

/* The status glyph column has no heading; the first label starts after it. */
.wall-columns > :first-child {
  grid-column: 2;
}

.wall-col-num {
  text-align: right;
}

.wall-table {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
}

/*
 * The one scrolling surface in the left half, and the difference between this
 * screen and the wall it grew out of: nobody stands in front of a wall to scroll
 * it, and somebody is always sitting in front of this. Twenty sessions is a normal
 * day for the person who asked for it, and truncating those to what fits would be
 * the screen quietly hiding the thing they opened it to see.
 */
.wall-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.wall-group + .wall-group {
  margin-top: 2px;
}

.wall-group-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 10px 5px;
  background: var(--surface-base);
  border-bottom: 1px solid var(--border-subtle);
  /* Sticky so the repository a row belongs to is still readable when the list is
     scrolled past its own heading. */
  position: sticky;
  top: 0;
  z-index: 1;
}

.wall-group-name {
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
}

.wall-group-counts {
  display: flex;
  gap: 10px;
  font-family: var(--font-sans);
  font-size: 11px;
  color: var(--text-tertiary);
}

.wall-group-counts .is-needs-you { color: var(--accent); }
.wall-group-counts .is-broken { color: var(--error); }

.wall-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.wall-empty-icon {
  width: 26px;
  height: 26px;
  color: var(--text-disabled);
}

.wall-empty-line {
  font-family: var(--font-sans);
  font-size: 17px;
  font-weight: 500;
  color: var(--text-secondary);
}

.wall-empty-next {
  font-family: var(--font-sans);
  font-size: 12.5px;
  color: var(--text-tertiary);
}

.wall-empty-when {
  font-family: var(--font-mono);
  color: var(--accent);
  margin-left: 6px;
}

/* ── The tape, and the controls at the end of it ─────────────────────────── */

.wall-tape {
  display: flex;
  align-items: center;
  gap: clamp(8px, 1vw, 16px);
  flex-shrink: 0;
  padding: 2px clamp(6px, 0.6vw, 10px);
}

.wall-tape-feed {
  flex: 1;
  min-width: 0;
}

/*
 * Present, and quiet until wanted: these are for the minute somebody sets this
 * screen up, not for the days it then runs. Which is also why they are no longer
 * in the top right corner — that space is worth more than three buttons nobody
 * presses twice.
 */
.wall-tools {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
  opacity: 0.3;
  transition: opacity 0.2s ease;
}

.wall-tools:hover {
  opacity: 1;
}

.wall-control {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
}

.wall-control:hover {
  background: var(--surface-hover);
}

/* Lit while on, and the cluster stops being faint with it — whether the room is
   about to make a noise is worth reading without hovering. */
.wall-control.is-on {
  background: var(--accent-muted);
  color: var(--accent);
}

.wall-tools:has(.is-on) {
  opacity: 0.7;
}

/* ── Voice ───────────────────────────────────────────────────────────────── */

.wall-voice {
  flex-shrink: 0;
}

.wall-consent {
  display: flex;
  align-items: flex-start;
  gap: clamp(10px, 1.2vw, 20px);
  flex-shrink: 0;
  padding: clamp(10px, 1.2vh, 18px) clamp(12px, 1.4vw, 22px);
  border-radius: 10px;
  background: var(--surface-raised);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  color: var(--text-secondary);
}

.wall-consent-line {
  font-family: var(--font-sans);
  font-size: clamp(13px, 1.05vw, 19px);
  font-weight: 500;
  color: var(--text-primary);
}

.wall-consent-detail {
  margin-top: 4px;
  font-family: var(--font-sans);
  font-size: clamp(11px, 0.9vw, 16px);
  color: var(--text-tertiary);
  max-width: 90ch;
}

.wall-consent-detail kbd {
  font-family: var(--font-mono);
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--badge-subtle-bg);
}

.wall-consent-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.wall-consent-button {
  padding: 6px 12px;
  border-radius: 7px;
  font-family: var(--font-sans);
  font-size: clamp(11px, 0.9vw, 15px);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  cursor: pointer;
}

.wall-consent-button:hover {
  background: var(--surface-hover);
}

.wall-consent-button.is-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
</style>
