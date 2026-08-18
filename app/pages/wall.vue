<script setup lang="ts">
import {
  URGENCY_LABELS,
  countUrgency,
  groupByRepo,
  isCurrent,
  landedLabel,
  moodOf,
  orderTiles,
  quotaMeter,
  spendMeter,
  takeTiles,
  untilLabel,
  urgencyOf,
  withDetail,
  type WallDetail,
  type WallPrompt,
  type WallTile,
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
 * Fleet — the wall.
 *
 * A screen to leave on. Not a page somebody navigates to with a question in
 * mind, which is what every other surface here is: this one is read at a glance,
 * from across a room, by somebody who was walking past on their way to
 * something else. That single difference decides everything about it.
 *
 * **No chrome.** The sidebar is suppressed for this route in `app.vue`, because
 * a wall showing its own navigation is a wall admitting it expects to be left.
 * Escape gets you back and `F` goes fullscreen; the cursor fades after a few
 * still seconds, since a mouse pointer frozen over a display all afternoon is
 * the one thing on it that is not information.
 *
 * **Three questions, in order.** Is anything wrong; is anything happening; what
 * has it cost. The left is the fleet, ordered so the first answer is always the
 * top row. The right rail is what is waiting on a person, and what landed. The
 * strip along the bottom is the night, which is the only part of this that looks
 * backwards.
 *
 * **It is a table, not a poster.** It began as a wall of cards and is used as an
 * orchestration screen — twenty sessions across four repositories, read at a desk,
 * to decide what to look at next. So the default view is dense rows in aligned
 * columns, grouped by repository, and it scrolls: a screen somebody sits at can,
 * where a wall cannot. The cards survive in cinema mode, which is the one place
 * big type is the right answer.
 *
 * **And it can be acted on.** A row that is waiting on a person carries the answer
 * to what it is waiting for, and a running one carries its brake. Everything else
 * here reports; these two do something, which is the whole difference between a
 * dashboard and a tool.
 *
 * **It says when it has stopped knowing.** The characteristic failure of an
 * unattended screen is not being wrong, it is being nine minutes old while
 * looking exactly as it did when it was right. So the header carries the
 * connection, and a wall whose server has gone away says so in words.
 *
 * **Cinema mode** is the same screen with an audience: one act at a time, on a
 * clock, for a display at the end of a room where a single still image stops
 * being looked at inside a minute. `C` turns it on, `?cinema=1` launches into
 * it, space pauses, the arrows step. What decides the rotation lives in
 * `utils/cinema.ts` — including the rule that an act with nothing to say is not
 * shown at all.
 */

const { snapshot, now, connected, refresh, watchWall } = useWall()
watchWall()

// Already polled app-wide; this is guarded against starting a second one, so
// reading it here costs nothing.
const { attention, watchContinuously } = useAttention()
onMounted(() => watchContinuously())

const router = useRouter()

const current = computed(() =>
  (snapshot.value?.tiles ?? []).filter(tile => isCurrent(tile, now.value)),
)

const fleet = computed(() => takeTiles(current.value))
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

/** What the rotation has to work with. */
const cinemaInput = computed(() => ({
  needsYou: attention.value.needsYou,
  tiles: current.value.length,
  landedToday: landedToday.value.length,
  runsInWindow: snapshot.value?.runsLastDay ?? 0,
}))

const cinema = useCinema(cinemaInput, now)

/**
 * A session that has just broken is worth cutting to the fleet for. Counted
 * here, where the tiles are, and only acted on when it goes *up* — see
 * `interruptFor`.
 */
const brokenCount = computed(() =>
  current.value.filter(tile => urgencyOf(tile) === 'broken').length,
)

watch(brokenCount, (count, before) => {
  if (count > (before ?? 0)) cinema.interruptFor('broken')
})

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
 * A wall in a shared room makes sounds other people hear, and the first question
 * is always "what was that?". The vocabulary is six lines, which is short enough
 * to answer that in a tooltip and too long to put on the screen permanently.
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
 * Speaking to the wall.
 *
 * Off until switched on, held down to be heard, and confirmed by hand before
 * anything runs. The grammar and — more to the point — what it refuses live in
 * `utils/voice.ts`; the microphone and the privacy caveat that comes with it live
 * in `useVoice`. What is left here is the wiring: what each understood command
 * actually does on this machine.
 */
const voice = useVoice()
const { projects, ensureLoaded: loadProjects } = useProjects()
const { workingDir } = useWorkingDir()

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
    case 'act': {
      // Turning the rotation on first: asking for an act while it is off is
      // asking for the rotation, whatever the words were.
      if (!cinema.enabled.value) cinema.setEnabled(true)

      /**
       * An act can be asked for and refused by the rotation itself — while
       * something needs a person the retrospective acts are not in it, and an act
       * with nothing in it is never in it. Showing it anyway lasts until the next
       * tick and then snaps somewhere else, which reads as the voice not working.
       *
       * So the override is *stated*. Found by asking for the night on a machine
       * with a broken ritual: the screen cut to "Needs you" and said nothing.
       */
      if (!cinema.acts.value.some(act => act.id === command.act)) {
        cinema.show(cinema.acts.value[0]?.id ?? 'fleet')
        report(attention.value.needsYou
          ? 'Something needs you first — showing that instead.'
          : 'Nothing to show there yet.')
        return
      }

      cinema.show(command.act)
      report(describeVoice(command))
      return
    }

    case 'rotation':
      switch (command.move) {
        case 'next': cinema.next(); break
        case 'previous': cinema.previous(); break
        // Idempotent: "pause" said twice leaves it paused, which is what the
        // word means. A blind toggle would have made the second one resume.
        case 'pause': if (!cinema.paused.value) cinema.togglePause(); break
        case 'resume': if (cinema.paused.value) cinema.togglePause(); break
      }
      report(describeVoice(command))
      return

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
 * Escape leaves, `F` fills the screen, `C` starts the rotation.
 *
 * All on the page rather than as buttons only, because the machine driving a
 * wall is usually not the one you are sitting at — a keyboard reachable once,
 * during setup, is the whole interaction this screen expects to have.
 */
function onKey(event: KeyboardEvent) {
  /**
   * A command waiting for a hand owns the keyboard until it is answered.
   *
   * Escape means "not that" here rather than "leave the wall", which is the
   * safer reading of the same key: somebody who has just heard the screen offer
   * to start an agent and hits Escape is cancelling, not navigating.
   */
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
    case 'c':
    case 'C':
      cinema.toggle()
      return
    case 's':
    case 'S':
      sound.toggle()
      return
  }

  // The rest only mean anything while the rotation is running.
  if (!cinema.enabled.value) return

  if (event.key === ' ') {
    // Otherwise the space also scrolls the page under the act.
    event.preventDefault()
    cinema.togglePause()
    return
  }

  if (event.key === 'ArrowRight') cinema.next()
  if (event.key === 'ArrowLeft') cinema.previous()
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
  <div class="wall" :class="{ 'is-idle': cursorHidden, 'is-cinema': cinema.enabled.value }">
    <!--
      The hairline that says how long this act has left. At the very top edge,
      full width, because it is the one element here that must never compete for
      attention with the content under it — and because that is where every
      audience already knows to read a progress bar.
    -->
    <div v-if="cinema.enabled.value" class="wall-progress" :class="{ 'is-paused': cinema.paused.value }">
      <div class="wall-progress-fill" :style="{ width: `${cinema.progress.value * 100}%` }" />
    </div>

    <header class="wall-header">
      <div class="flex items-baseline gap-3 min-w-0">
        <span class="wall-mood" :style="{ background: MOOD_TONES[mood] }" />
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

      <div class="flex items-center gap-6 shrink-0">
        <!--
          Everything that is *read* sits in here, on one baseline.
          
          The meters are two-line blocks — a caption over a bar — and the clock is
          a single line of much larger type. Centring them against each other, as
          the row used to, put the captions six pixels above the clock's baseline:
          each one is vertically centred and none of them line up. Aligning by
          baseline instead lets the bars hang below the line the words share,
          which is where a bar belongs.
        -->
        <div class="wall-readouts">
          <WallMeter v-if="quota" label="Limit" :meter="quota" />
          <WallMeter label="Today" :meter="spend" />

        <!--
          Which act, named, with a pip per act in the rotation. Named because a
          screen that changes every twenty seconds without saying what it is
          showing makes the viewer work it out each time.
        -->
          <div v-if="cinema.enabled.value" class="wall-acts">
            <span class="wall-act-name">{{ cinema.act.value.label }}</span>
            <span class="wall-pips">
              <button
                v-for="act in cinema.acts.value"
                :key="act.id"
                class="wall-pip"
                :class="{ 'is-on': act.id === cinema.act.value.id }"
                :title="act.label"
                @click="cinema.show(act.id)"
              />
            </span>
            <UIcon v-if="cinema.paused.value" name="i-lucide-pause" class="wall-act-paused" title="Paused — space" />
          </div>

          <span class="wall-clock">{{ clock }}</span>
        </div>

        <div class="wall-controls">
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
          <button
            class="wall-control"
            :class="{ 'is-on': cinema.enabled.value }"
            title="Cinema mode — C"
            @click="cinema.toggle()"
          >
            <UIcon name="i-lucide-clapperboard" class="size-4" />
          </button>
          <button class="wall-control" title="Fullscreen — F" @click="toggleFullscreen">
            <UIcon name="i-lucide-maximize" class="size-4" />
          </button>
          <NuxtLink to="/" class="wall-control" title="Back to Now — Esc">
            <UIcon name="i-lucide-x" class="size-4" />
          </NuxtLink>
        </div>
      </div>
    </header>

    <p v-if="!connected" class="wall-offline">
      <UIcon name="i-lucide-unplug" class="size-4 shrink-0" />
      This screen is not being updated — the server stopped answering. What is
      below is the last it said.
    </p>

    <!--
      Cinema mode: one act, full width, on a clock.

      Keyed by act so each one mounts fresh and runs its own entrance. The
      entrance is a CSS animation rather than a Vue <Transition> on purpose — a
      transition's class swap happens inside requestAnimationFrame, which does not
      run while the document is hidden, and a wall spends its life in a window
      that may well be occluded. That combination leaves the incoming act stuck at
      `opacity: 0` forever: mounted, correct, invisible. See the note in
      `nuxt.config.ts`, which is the same bug found the hard way. Here the resting
      state is visible and the animation only adds the fade, so a frame that never
      runs costs the fade and nothing else.
    -->
    <main v-if="cinema.enabled.value" class="wall-stage">
      <div :key="cinema.act.value.id" class="wall-act">
        <WallActAttention
          v-if="cinema.act.value.id === 'needs-you'"
          :items="attention.items"
          :count="attention.needsYou"
        />

        <WallActFleet
          v-else-if="cinema.act.value.id === 'fleet'"
          :tiles="fleet.shown"
          :hidden="fleet.hidden"
          :next-ritual="snapshot?.nextRitual"
          :now="now"
        />

        <div v-else-if="cinema.act.value.id === 'night'" class="wall-act-night">
          <NightShift />
        </div>

        <WallActLanded
          v-else-if="cinema.act.value.id === 'landed'"
          :entries="landedToday"
          :now="now"
        />

      </div>

      <!--
        The heartbeat, under every act. Without it a rotation through last
        night's numbers reads as a slideshow of a machine that has stopped.
      -->
      <WallTicker class="wall-heartbeat" line :ticks="snapshot?.ticker ?? []" :now="now" />
    </main>

    <main v-else class="wall-main">
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
              @answer="(prompt, decision) => answerPrompt(prompt, decision)"
              @stop="stopRow(row)"
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
          <p v-if="snapshot?.nextRitual" class="wall-empty-next">
            {{ snapshot.nextRitual.title }}
            <span class="wall-empty-when">{{ untilLabel(snapshot.nextRitual.at, now) }}</span>
          </p>
          <p v-else class="wall-empty-next">No scheduled work is due.</p>
        </div>
      </section>

      <aside class="wall-rail">
        <section class="wall-panel">
          <h2 class="wall-panel-title">
            Needs you
            <span v-if="attention.needsYou" class="wall-panel-count is-loud">{{ attention.needsYou }}</span>
          </h2>

          <ul v-if="attention.items.length" class="wall-list">
            <li v-for="item in attention.items.slice(0, 5)" :key="`${item.kind}-${item.id}`" class="wall-list-row">
              <span class="wall-list-dot" />
              <span class="min-w-0">
                <span class="wall-list-title truncate">{{ item.title }}</span>
                <span class="wall-list-because truncate">{{ item.because }}</span>
              </span>
            </li>
          </ul>
          <p v-else class="wall-panel-empty">Nothing is waiting on you.</p>
        </section>

        <section class="wall-panel">
          <h2 class="wall-panel-title">
            Landed today
            <span v-if="landedToday.length" class="wall-panel-count">{{ landedToday.length }}</span>
          </h2>

          <ul v-if="landedToday.length" class="wall-list">
            <li v-for="entry in landedToday.slice(0, 4)" :key="entry.sessionId" class="wall-list-row">
              <UIcon name="i-lucide-git-merge" class="wall-list-icon shrink-0" />
              <span class="min-w-0">
                <span class="wall-list-title truncate">{{ entry.title }}</span>
                <span class="wall-list-because truncate">{{ entry.repo }} · {{ landedLabel(entry.how) }}</span>
              </span>
            </li>
          </ul>
          <p v-else class="wall-panel-empty">Nothing has landed today.</p>
        </section>

        <div class="wall-rail-spacer" />

        <footer class="wall-rail-foot">
          <span v-if="snapshot?.nextRitual" class="truncate">
            Next: {{ snapshot.nextRitual.title }} {{ untilLabel(snapshot.nextRitual.at, now) }}
          </span>
          <span v-else class="truncate">No scheduled work due</span>

          <span v-if="snapshot?.pausedRituals" class="wall-rail-paused">
            {{ snapshot.pausedRituals }} stopped
          </span>
        </footer>
      </aside>
    </main>

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
      The night, along the bottom. The same component the Now page uses rather
      than a second chart drawing the same runs: two pictures of one night that
      could ever disagree is a worse outcome than one that is slightly too small.

      Not in cinema mode, where the night is an act of its own and gets the whole
      screen — a strip of it under the act it is about would be the same chart
      twice.
    -->
    <section v-if="!cinema.enabled.value" class="wall-night" aria-label="The last day">
      <NightShift compact />
    </section>
  </div>
</template>

<style scoped>
.wall {
  position: relative; /* The cinema progress hairline pins to this. */
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: clamp(8px, 1vh, 16px);
  padding: clamp(12px, 1.4vw, 26px);
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
  font-size: clamp(17px, 1.5vw, 28px);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.wall-bands {
  font-family: var(--font-sans);
  font-size: clamp(12px, 1vw, 17px);
  color: var(--text-tertiary);
}

.wall-band-sep {
  margin: 0 8px;
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
 * caption and lets its bar hang below — which is what puts the captions, the act
 * name and the clock on the single line the eye expects. The controls are
 * deliberately outside this: an icon button has no text to sit on a baseline, and
 * including it would align the row to the bottom of a 30px square.
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
 * narrow truncated "five-hour has room" into an ellipsis on a display meant to be
 * read from the back of a room.
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

.wall-controls {
  display: flex;
  gap: 4px;
  /* Present, and quiet until wanted: the controls are for the minute somebody
     sets this up, not for the days it then runs. */
  opacity: 0.25;
  transition: opacity 0.2s ease;
}

.wall-controls:hover {
  opacity: 1;
}

.wall-control {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
}

.wall-control:hover {
  background: var(--surface-hover);
}

/*
 * The cinema toggle stays lit while the rotation runs, and the whole control
 * cluster stops being faint — the one control on this screen whose state is
 * worth reading from across the room is whether the rotation is on.
 */
.wall-control.is-on {
  background: var(--accent-muted);
  color: var(--accent);
}

.wall.is-cinema .wall-controls {
  opacity: 0.6;
}

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

.wall-main {
  flex: 1;
  min-height: 0;
  display: grid;
  /* Narrower than the wall's rail: the table beside it is the point of the screen,
     and the rail is now two short lists rather than three panels. */
  grid-template-columns: minmax(0, 1fr) clamp(210px, 20vw, 330px);
  gap: clamp(10px, 1.2vw, 22px);
}

/*
 * The fleet column keeps `min-height: 0` inside its own component; the grid
 * needs it here too, because a grid item's default minimum is its content and
 * without it the fleet grows past the viewport the moment there are more tiles
 * than fit — over the night strip below. Found exactly that way, at nine tiles.
 */
.wall-main > * {
  min-width: 0;
  min-height: 0;
}

/* ── Cinema mode ─────────────────────────────────────────────────────────── */

.wall-progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--border-subtle);
  z-index: 2;
}

.wall-progress-fill {
  height: 100%;
  background: var(--accent);
  /* Matched to the tick that feeds it, so a bar advancing once a second reads
     as continuous rather than as a series of jumps. */
  transition: width 1s linear;
}

.wall-progress.is-paused .wall-progress-fill {
  background: var(--text-disabled);
  transition: none;
}

.wall-acts {
  display: flex;
  align-items: center;
  gap: clamp(6px, 0.8vw, 14px);
}

.wall-act-name {
  font-family: var(--font-sans);
  font-size: clamp(10px, 0.8vw, 13px);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.wall-pips {
  display: flex;
  gap: 5px;
}

.wall-pip {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--border-emphasis);
  cursor: pointer;
  transition: background 0.3s ease, transform 0.3s ease;
}

.wall-pip.is-on {
  background: var(--accent);
  transform: scale(1.35);
}

.wall-act-paused {
  width: 13px;
  height: 13px;
  color: var(--text-disabled);
}

.wall-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(8px, 1.2vh, 20px);
}

.wall-act {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* Resting state is visible; the animation only adds the entrance. See the
     comment in the template for why that distinction matters here. */
  opacity: 1;
  animation: act-in 420ms ease;
}

/*
 * Whatever act is inside takes the stage. Without this the fleet act drew its
 * tiles at their natural height and left two thirds of the screen empty, which
 * is the one thing a full-screen act must not do.
 */
.wall-act > * {
  flex: 1;
  min-height: 0;
}

/*
 * Bigger tiles, fewer across. An act has the whole width where the normal wall
 * gives the fleet three quarters of it, and the same grid there produces five
 * narrow columns in a room where the audience is furthest away.
 */
.wall-act :deep(.fleet-grid) {
  grid-template-columns: repeat(auto-fill, minmax(clamp(260px, 25vw, 420px), 1fr));
}

.wall-act :deep(.wall-tile) {
  max-height: clamp(180px, 32vh, 360px);
}

/*
 * Larger type inside a cinema tile, rather than a smaller tile.
 *
 * A tile with the room of a full screen and the type of a sidebar is mostly air,
 * and the instinct is to shrink the card. That is the wrong way round: the reason
 * this act has the whole screen is so the people furthest from it can read the
 * title and what the session is doing, so the space goes into those two lines and
 * the air goes away by itself.
 */
.wall-act :deep(.wall-tile-title) {
  font-size: clamp(16px, 1.5vw, 30px);
}

.wall-act :deep(.wall-tile-doing) {
  font-size: clamp(12px, 1.05vw, 20px);
}

.wall-act :deep(.wall-tile-repo),
.wall-act :deep(.wall-tile-branch),
.wall-act :deep(.wall-tile-sep),
.wall-act :deep(.wall-tile-meta) {
  font-size: clamp(11px, 0.9vw, 16px);
}

@keyframes act-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .wall-act {
    animation: none;
  }
  .wall-progress-fill {
    transition: none;
  }
}

/* The night act is the chart, given the room the strip version never has. */
.wall-act-night {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 clamp(4px, 2vw, 50px);
}

.wall-heartbeat {
  flex-shrink: 0;
  min-height: 1.6em;
}

.wall-rail {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(8px, 1vh, 16px);
}

.wall-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: clamp(10px, 1vw, 18px);
  border-radius: 10px;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
}

.wall-panel.is-grow {
  flex: 1;
  overflow: hidden;
}

.wall-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: clamp(10px, 0.8vw, 13px);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.wall-panel-count {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: clamp(9.5px, 0.7vw, 12px);
  letter-spacing: 0;
  background: var(--badge-subtle-bg);
  color: var(--text-secondary);
}

.wall-panel-count.is-loud {
  background: var(--error-tint);
  color: var(--error);
}

.wall-panel-empty {
  font-family: var(--font-sans);
  font-size: clamp(11px, 0.85vw, 15px);
  color: var(--text-disabled);
}

.wall-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.wall-list-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.wall-list-dot {
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 999px;
  flex-shrink: 0;
  background: var(--error);
}

.wall-list-icon {
  width: clamp(12px, 0.9vw, 15px);
  height: clamp(12px, 0.9vw, 15px);
  margin-top: 2px;
  color: var(--success);
}

.wall-list-title {
  display: block;
  font-family: var(--font-sans);
  font-size: clamp(12px, 0.9vw, 16px);
  font-weight: 500;
  color: var(--text-primary);
}

.wall-list-because {
  display: block;
  font-family: var(--font-sans);
  font-size: clamp(10.5px, 0.8vw, 14px);
  color: var(--text-tertiary);
}

/* Holds the two lists at the top so the footer stays at the bottom. */
.wall-rail-spacer {
  flex: 1;
  min-height: 0;
}

.wall-rail-foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: clamp(10px, 0.75vw, 13px);
  color: var(--text-disabled);
}

.wall-rail-paused {
  flex-shrink: 0;
  color: var(--warning);
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
 * The one scrolling surface here, and the difference between this screen and the
 * wall it grew out of: nobody is standing in front of a wall to scroll it, and
 * somebody is always sitting in front of this. Twenty sessions is a normal day for
 * the person who asked for it, and truncating those to what fits would be the
 * screen quietly hiding the thing they opened it to see.
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

.wall-night {
  flex-shrink: 0;
  max-height: 26vh;
  overflow: hidden;
}
</style>
