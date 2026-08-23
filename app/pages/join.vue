<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

/**
 * The first hour, for somebody joining something already running.
 *
 * The existing first run assumes a person starting alone: create a folder,
 * install some tools, off you go. That is the wrong shape for the interesting
 * case now, which is a person cloning a repository their team has been using this
 * against for a month. Everything they need already exists — the check command,
 * the sandbox rules, the rituals — and none of it is theirs.
 *
 * So the whole design of this page is one distinction, repeated at every step:
 * **what is yours and what is the team's.** That is the thing a new person gets
 * wrong, and getting it wrong in either direction is expensive. Thinking a shared
 * ritual is yours means editing it locally and wondering why your change never
 * reaches anybody. Thinking your spend cap is shared means assuming somebody else
 * set it, and finding out on the invoice.
 *
 * Every step therefore carries a label — *yours* or *the team's* — and the last
 * step exists only to answer the question a new person actually has: now that I
 * have done this, what happens without me?
 */

const { projects, active, addProject, activate, ensureLoaded } = useProjects()
const { state: shared, load: loadShared } = useSharedProject()
const { schedules, fetchAll: loadSchedules, setEnabled } = useSchedules()
const { setWorkingDir } = useWorkingDir()
const toast = useToast()

const path = ref('')
const adding = ref(false)
const dailyCap = ref('')
const runCap = ref('')
const savingCaps = ref(false)
const capsSaved = ref(false)

onMounted(async () => {
  await ensureLoaded()
  if (active.value) {
    path.value = active.value.path
    await refresh()
  }

  const prefs = await $fetch<{ dailyCapUsd: number; runCapUsd: number }>('/api/preferences').catch(() => null)
  if (prefs) {
    dailyCap.value = prefs.dailyCapUsd ? String(prefs.dailyCapUsd) : ''
    runCap.value = prefs.runCapUsd ? String(prefs.runCapUsd) : ''
  }
})

async function refresh() {
  await Promise.all([loadShared(active.value?.path), loadSchedules()])
}

/** Step one is done when this machine has a checkout to work in. */
const hasCheckout = computed(() => Boolean(active.value))

/** The rituals this repository shares, as they arrived: off, and waiting. */
const sharedRituals = computed(() =>
  schedules.value.filter(s => s.sharedKey && s.projectDir === active.value?.path))

const waiting = computed(() => sharedRituals.value.filter(s => !s.enabled))

/** What will now happen without them: the rituals that are actually on. */
const willFire = computed(() =>
  schedules.value
    .filter(s => s.enabled && s.projectDir === active.value?.path)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0)))

/**
 * When a ritual next fires, as a time rather than a distance.
 *
 * `relativeTime` is built for things that have happened — it renders a run due
 * tomorrow morning as "just now", which on the one line of this page that is
 * supposed to say what happens *next* is worse than useless.
 */
function nextRun(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function onAddCheckout() {
  const value = path.value.trim()
  if (!value) return

  adding.value = true
  try {
    const project = await addProject(value)
    await activate(project?.path ?? value)
    setWorkingDir(project?.path ?? value)
    await refresh()
    toast.add({ title: 'That is your checkout', description: 'Nothing in it is shared until you share it.', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Could not use that folder', description: errorMessage(e), color: 'error' })
  } finally {
    adding.value = false
  }
}

async function onTurnOn(id: string) {
  const ritual = schedules.value.find(s => s.id === id)
  if (!ritual) return

  try {
    await setEnabled(ritual, true)
    await loadSchedules()
  } catch (e) {
    toast.add({ title: 'Could not turn it on', description: errorMessage(e), color: 'error' })
  }
}

async function onSaveCaps() {
  savingCaps.value = true
  try {
    await $fetch('/api/preferences', {
      method: 'PUT',
      body: {
        dailyCapUsd: Number(dailyCap.value) || 0,
        runCapUsd: Number(runCap.value) || 0,
      },
    })
    capsSaved.value = true
    toast.add({ title: 'Saved on this machine', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Could not save that', description: errorMessage(e), color: 'error' })
  } finally {
    savingCaps.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader title="Joining a team" />

    <div class="page-container page-container--measure py-4 space-y-6">
      <p class="fs-sm text-meta">
        Five steps, and one thing to keep hold of throughout: some of what you are about to see
        belongs to the repository and arrived with it, and some of it is yours and exists only
        on this machine. Each step below says which.
      </p>

      <!-- 1 · Yours -->
      <section class="step">
        <header class="flex items-baseline gap-2 flex-wrap">
          <span class="num">1</span>
          <h2 class="text-section-label">Point it at your own clone</h2>
          <span class="tag tag--mine">yours</span>
        </header>
        <p class="type-meta">
          Your checkout, on your disk. Sessions are worktrees inside it, so nothing here touches
          anybody else's copy — and nothing you do in it reaches the team until you push.
        </p>
        <div class="flex gap-2">
          <input
            v-model="path"
            class="field-input flex-1 font-mono"
            placeholder="/Users/you/work/the-repo"
            spellcheck="false"
            @keydown.enter="onAddCheckout"
          />
          <UButton label="Use this" size="sm" :loading="adding" :disabled="!path.trim()" @click="onAddCheckout" />
        </div>
        <p v-if="active" class="type-detail" style="color: var(--success);">
          Working in {{ active.name }}.
        </p>
      </section>

      <!-- 2 · Theirs -->
      <section class="step" :class="{ 'step--waiting': !hasCheckout }">
        <header class="flex items-baseline gap-2 flex-wrap">
          <span class="num">2</span>
          <h2 class="text-section-label">What the repository already decided</h2>
          <span class="tag tag--ours">the team's</span>
        </header>

        <p v-if="!hasCheckout" class="type-meta">Pick your clone first.</p>

        <template v-else-if="shared?.exists">
          <p class="type-meta">
            These came out of <span class="font-mono">{{ shared.file }}</span> in the repository —
            somebody committed them, and they arrived when you pulled. Changing them here means
            changing that file, which means a commit somebody reviews.
          </p>
          <ul class="facts">
            <li v-if="shared.config.checks">
              <b>How you tell whether it works:</b>
              <span class="font-mono">{{ shared.config.checks.command || 'nothing to run' }}</span>
            </li>
            <li v-if="shared.config.sandbox">
              <b>What runs here may reach:</b>
              {{ (shared.config.sandbox.allowedDomains ?? []).length || 'no' }}
              {{ (shared.config.sandbox.allowedDomains ?? []).length === 1 ? 'host' : 'hosts' }}, sandbox
              {{ shared.config.sandbox.enabled === false ? 'off' : 'on' }}
            </li>
            <li v-if="shared.config.rituals?.length">
              <b>Rituals the team runs:</b> {{ shared.config.rituals.length }}
            </li>
          </ul>
          <p v-if="shared.problems.length" class="type-detail" style="color: var(--warning);">
            {{ shared.problems.length }} of them cannot be used on this machine — Settings says
            which and why.
          </p>
        </template>

        <p v-else class="type-meta">
          This repository shares nothing yet: no check command, no sandbox rules, no rituals. That
          is normal, and it means everything below is yours to decide.
        </p>
      </section>

      <!-- 3 · Theirs, but your decision -->
      <section class="step" :class="{ 'step--waiting': !hasCheckout }">
        <header class="flex items-baseline gap-2 flex-wrap">
          <span class="num">3</span>
          <h2 class="text-section-label">Turn on the ones you want</h2>
          <span class="tag tag--ours">the team's, your call</span>
        </header>
        <p class="type-meta">
          A shared ritual arrives switched <b>off</b>. Pulling a repository is not agreeing to run
          something on your machine at 08:00 — that is a decision you make here, per ritual.
        </p>

        <p v-if="!sharedRituals.length" class="type-meta">Nothing shared to turn on.</p>
        <ul v-else class="facts">
          <li v-for="ritual in sharedRituals" :key="ritual.id" class="flex items-center justify-between gap-3">
            <span>
              <b>{{ ritual.title }}</b>
              <span class="ink-3"> · {{ ritual.description }}</span>
            </span>
            <UButton
              v-if="!ritual.enabled"
              label="Run it here"
              size="xs"
              variant="soft"
              @click="onTurnOn(ritual.id)"
            />
            <span v-else class="type-detail" style="color: var(--success);">on</span>
          </li>
        </ul>
      </section>

      <!-- 4 · Yours -->
      <section class="step">
        <header class="flex items-baseline gap-2 flex-wrap">
          <span class="num">4</span>
          <h2 class="text-section-label">Your own spending limit</h2>
          <span class="tag tag--mine">yours</span>
        </header>
        <p class="type-meta">
          Nobody else's cap applies to you: this is your machine, your Claude Code login and your
          bill. Work is <b>skipped</b> when a cap is reached, not queued up to run later.
        </p>
        <div class="flex gap-2 flex-wrap items-end">
          <label class="field-group">
            <span class="field-label">A day, in dollars</span>
            <input v-model="dailyCap" class="field-input" placeholder="no cap" inputmode="decimal" />
          </label>
          <label class="field-group">
            <span class="field-label">One run</span>
            <input v-model="runCap" class="field-input" placeholder="no cap" inputmode="decimal" />
          </label>
          <UButton label="Save" size="sm" variant="soft" :loading="savingCaps" @click="onSaveCaps" />
        </div>
        <p v-if="capsSaved" class="type-detail" style="color: var(--success);">
          Saved on this machine only.
        </p>
      </section>

      <!-- 5 · Yours -->
      <section class="step" :class="{ 'step--waiting': !hasCheckout }">
        <header class="flex items-baseline gap-2 flex-wrap">
          <span class="num">5</span>
          <h2 class="text-section-label">Start one session</h2>
          <span class="tag tag--mine">yours</span>
        </header>
        <p class="type-meta">
          One is enough to know it works. It cuts a worktree from your clone, runs a turn, and
          merges nothing until you say so.
        </p>
        <UButton label="Go to Work and start one" size="sm" to="/work" :disabled="!hasCheckout" />
      </section>

      <!--
        The question a new person actually has, and the one nothing in the app
        answered: I have finished setting up — so what happens now, without me?
      -->
      <section class="step step--summary">
        <h2 class="text-section-label">What will now happen without you</h2>

        <template v-if="willFire.length">
          <ul class="facts">
            <li v-for="ritual in willFire" :key="ritual.id">
              <b>{{ ritual.title }}</b> · {{ ritual.description }}
              <template v-if="ritual.nextRunAt"> · next {{ nextRun(ritual.nextRunAt) }}</template>
              <span v-if="ritual.sharedKey" class="ink-3"> · the team's</span>
            </li>
          </ul>
          <p class="type-meta">
            Those run while this app is running. On a laptop that means while it is open — put it
            on a machine that stays awake and it means always
            (<NuxtLink to="/settings#settings-notifications" class="underline">how you are told</NuxtLink>).
          </p>
        </template>

        <p v-else class="type-meta">
          <b>Nothing.</b> No ritual on this machine is switched on, so nothing will run unless you
          start it. That is a fine place to stop for today — step 3 is where you change it.
        </p>

        <p class="type-meta">
          Where you will be told: notifications from this browser, and the morning message if you
          set one up. Both are in
          <NuxtLink to="/settings#settings-notifications" class="underline">Settings</NuxtLink>, and
          both are yours rather than the team's.
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.step {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 8px;
  background: var(--surface-raised);
}
.step--waiting { opacity: 0.6; }
.step--summary { background: var(--accent-muted); }

.num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 999px;
  background: var(--surface-base);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

/* The whole point of the page, so it is a label and not a sentence. */
.tag {
  font-size: var(--fs-micro);
  font-family: var(--font-mono, monospace);
  padding: 1px 7px;
  border-radius: 999px;
}
.tag--mine { background: var(--accent-muted); color: var(--accent); }
.tag--ours { background: var(--plugin-tint); color: var(--plugin); }

.facts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
</style>
