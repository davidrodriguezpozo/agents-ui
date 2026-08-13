<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import type { Settings } from '~/types'

const { settings, loading, load, save } = useSettings()
const {
  imports: githubImports,
  loading: importsLoading,
  fetchImports: fetchGithubImports,
  checkUpdates,
  updateImport,
  removeImport,
} = useGithubImports()
const toast = useToast()

const {
  state: checks,
  saving: checksSaving,
  load: loadChecks,
  save: saveCheckCommand,
  reset: resetCheckCommand,
} = useProjectChecks()

const {
  state: setup,
  saving: setupSaving,
  load: loadSetup,
  save: saveSetupCommand,
  reset: resetSetupCommand,
} = useProjectSetup()

const {
  state: dev,
  saving: devSaving,
  load: loadDev,
  save: saveDevCommand,
  reset: resetDevCommand,
} = useProjectDev()

const {
  state: sandbox,
  saving: sandboxSaving,
  load: loadSandbox,
  save: saveSandbox,
  reset: resetSandboxChoice,
} = useProjectSandbox()

const rawJson = ref('')
const saving = ref(false)
const viewMode = ref<'structured' | 'raw'>('structured')

/**
 * The section rail, in the order the sections appear. Naming them in a
 * different order to the page would be its own small lie — Backups moved to
 * the end of the document instead, which is where a thing you touch twice a
 * year belongs, and was the actual complaint about it being first.
 */
const sectionNav = [
  { id: 'general', label: 'General' },
  { id: 'limits', label: 'Limits' },
  { id: 'checks', label: 'Checks' },
  { id: 'setup', label: 'Workspace setup' },
  { id: 'dev', label: 'Running it' },
  { id: 'sandbox', label: 'Sandbox' },
  { id: 'statusline', label: 'Status line' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'marketplaces', label: 'Marketplaces' },
  { id: 'imports', label: 'GitHub imports' },
  { id: 'automations', label: 'Automations' },
  { id: 'backups', label: 'Backups' },
] as const

const activeSection = ref<string>('general')

/**
 * Scroll-spy, so the rail says where you are rather than where you last
 * clicked.
 *
 * Done on scroll rather than with an IntersectionObserver band: a section
 * taller than the band leaves it with nothing inside, and the observer only
 * reports entries whose state *changed*, so the rail would go blank mid-section
 * and stay wherever it was. Asking "which heading is the last one above the
 * fold" cannot have that gap.
 */
if (import.meta.client) {
  let scroller: HTMLElement | null = null

  function syncActiveSection() {
    const cutoff = 140
    let current: string = sectionNav[0].id
    for (const item of sectionNav) {
      const el = document.getElementById(`settings-${item.id}`)
      if (!el) continue
      if (el.getBoundingClientRect().top <= cutoff) current = item.id
    }
    activeSection.value = current
  }

  onMounted(async () => {
    await nextTick()
    // The page scrolls inside <main>, not the document.
    scroller = document.querySelector('main')
    scroller?.addEventListener('scroll', syncActiveSection, { passive: true })
    syncActiveSection()
  })

  onUnmounted(() => scroller?.removeEventListener('scroll', syncActiveSection))
}

/**
 * Seeded with whatever currently applies — including a detected guess, so the
 * box shows what will actually run rather than being blank while a command is
 * quietly in force.
 */
const checkCommand = ref('')
watch(checks, (next) => { checkCommand.value = next?.command ?? '' }, { immediate: true })

async function saveChecks() {
  try {
    await saveCheckCommand(checkCommand.value)
    toast.add({ title: 'Saved', description: 'Sessions in this project will run it from now on.', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Could not save that', description: errorMessage(e), color: 'error' })
  }
}

/** An empty command is remembered as an answer, so detection stops suggesting one. */
async function turnOffChecks() {
  await saveCheckCommand('')
  checkCommand.value = ''
}

async function resetChecks() {
  await resetCheckCommand()
}

/** Seeded with whatever applies, detected guess included — same as the checks. */
const setupCommand = ref('')
watch(setup, (next) => { setupCommand.value = next?.command ?? '' }, { immediate: true })

async function saveSetup() {
  try {
    await saveSetupCommand(setupCommand.value)
    toast.add({
      title: 'Saved',
      description: 'New workspaces in this project will be prepared with it.',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: 'Could not save that', description: errorMessage(e), color: 'error' })
  }
}

async function turnOffSetup() {
  await saveSetupCommand('')
  setupCommand.value = ''
}

async function resetSetup() {
  await resetSetupCommand()
}

/** Seeded with whatever applies, detected guess included — same as the others. */
const devCommand = ref('')
watch(dev, (next) => { devCommand.value = next?.command ?? '' }, { immediate: true })

async function saveDev() {
  try {
    await saveDevCommand(devCommand.value)
    toast.add({ title: 'Saved', description: 'Previews in this project will run it.', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Could not save that', description: errorMessage(e), color: 'error' })
  }
}

async function turnOffDev() {
  await saveDevCommand('')
  devCommand.value = ''
}

/**
 * Hosts, one per line — the shape people already have when they arrive here,
 * which is a failure message listing what a run was refused.
 */
const allowedDomains = ref('')
watch(sandbox, (next) => {
  allowedDomains.value = (next?.allowedDomains ?? []).join('\n')
}, { immediate: true })

const domainsChanged = computed(() => {
  const current = (sandbox.value?.allowedDomains ?? []).join('\n')
  return allowedDomains.value.trim() !== current
})

function parseDomains(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}

async function saveDomains() {
  try {
    await saveSandbox({ allowedDomains: parseDomains(allowedDomains.value) })
    toast.add({ title: 'Saved', description: 'Runs in this project may reach these.', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not save', description: e?.message ?? String(e), color: 'error' })
  }
}

async function toggleSandbox(enabled: boolean) {
  try {
    await saveSandbox({ enabled })
  } catch (e: any) {
    toast.add({ title: 'Could not save', description: e?.message ?? String(e), color: 'error' })
  }
}

type NotificationKey = 'enabled' | 'needsYou' | 'failed' | 'finished'

const NOTIFICATION_OPTIONS: { key: NotificationKey; label: string; hint: string }[] = [
  { key: 'enabled', label: 'Notify me', hint: 'Off means nothing is ever sent, whatever is set below.' },
  { key: 'needsYou', label: 'Something is blocked on me', hint: 'A run stopped waiting for a permission it does not have.' },
  { key: 'failed', label: 'Something failed', hint: 'A ritual or a session turn ended badly.' },
  { key: 'finished', label: 'Something finished', hint: 'Only for work that ran long enough that you looked away.' },
]

const notifications = ref<Record<NotificationKey, boolean>>({
  enabled: true, needsYou: true, failed: true, finished: true,
})
const summariseSessions = ref(true)
const repairAttempts = ref(0)
const maxTurns = ref('')
const maxConcurrentRuns = ref(3)
const dailyCap = ref('')
const runCap = ref('')
const spentToday = ref(0)
const pauseOnQuotaWarning = ref(false)

/**
 * What is left of the subscription. Never fetched on its own — it is collected
 * from the SDK during runs that were happening anyway — so "nothing heard yet"
 * is a normal state on a fresh install rather than a failure.
 */
const quota = ref<{
  known: boolean
  status?: 'allowed' | 'allowed_warning' | 'rejected'
  window?: string
  resetsAt?: number | null
  stale?: boolean
} | null>(null)

const quotaLabel = computed(() => {
  if (!quota.value?.known) return ''
  const window = quota.value.window ?? 'usage'
  if (quota.value.status === 'rejected') return `${window} limit used up`
  if (quota.value.status === 'allowed_warning') return `close to the ${window} limit`
  return `room on the ${window} limit`
})

/** Blank means no limit, which is what 0 means on the wire. */
function capToNumber(value: string): number {
  const parsed = Number(value.trim().replace(/^\$/, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

async function saveCaps() {
  try {
    await $fetch('/api/preferences', {
      method: 'PUT',
      body: {
        dailyCapUsd: capToNumber(dailyCap.value),
        runCapUsd: capToNumber(runCap.value),
        maxTurns: Math.max(0, Math.trunc(Number(maxTurns.value.trim()) || 0)),
        maxConcurrentRuns: maxConcurrentRuns.value,
        pauseOnQuotaWarning: pauseOnQuotaWarning.value,
      },
    })
    const anyLimit = capToNumber(dailyCap.value) || capToNumber(runCap.value) || Number(maxTurns.value.trim())
    toast.add({
      title: 'Limits saved',
      description: anyLimit
        ? 'Work that would go past them is stopped rather than allowed to run on.'
        : 'Nothing set — sessions, rituals and workflows run to the built-in defaults.',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: 'Could not save that', description: errorMessage(e), color: 'error' })
  }
}

onMounted(async () => {
  void loadChecks()
  void loadSetup()
  void loadSandbox()
  void loadDev()

  // Never worth failing the page over — it is a reading, not a setting.
  $fetch<typeof quota.value>('/api/quota')
    .then((result) => { quota.value = result })
    .catch(() => { quota.value = null })

  try {
    const prefs = await $fetch<{
      notifications: Record<NotificationKey, boolean>
      summariseSessions: boolean
      repairAttempts: number
      maxTurns: number
      maxConcurrentRuns: number
      pauseOnQuotaWarning: boolean
      dailyCapUsd: number
      runCapUsd: number
    }>('/api/preferences')
    notifications.value = prefs.notifications
    summariseSessions.value = prefs.summariseSessions
    repairAttempts.value = prefs.repairAttempts ?? 0
    maxTurns.value = prefs.maxTurns ? String(prefs.maxTurns) : ''
    maxConcurrentRuns.value = prefs.maxConcurrentRuns ?? 3
    pauseOnQuotaWarning.value = prefs.pauseOnQuotaWarning === true
    dailyCap.value = prefs.dailyCapUsd ? String(prefs.dailyCapUsd) : ''
    runCap.value = prefs.runCapUsd ? String(prefs.runCapUsd) : ''

    // What today has actually cost, so the limit is set against a real number
    // rather than a guess.
    const spend = await $fetch<{ byDay: { date: string; cost: number }[] }>('/api/spend?days=1')
    spentToday.value = spend.byDay.at(-1)?.cost ?? 0
  } catch {
    // Leaving the defaults on screen is better than an error about a toggle.
  }
})

/** Off is a real choice: this spends money on every turn that changes files. */
async function setSummarise(value: boolean) {
  const previous = summariseSessions.value
  summariseSessions.value = value
  try {
    await $fetch('/api/preferences', { method: 'PUT', body: { summariseSessions: value } })
  } catch {
    summariseSessions.value = previous
    toast.add({ title: 'Could not save that', color: 'error' })
  }
}

/**
 * How many turns a session may spend fixing itself before it stops and waits.
 * Off by default: this one spends money on work nobody watched being decided.
 */
async function setRepairAttempts(value: number) {
  const previous = repairAttempts.value
  repairAttempts.value = value
  try {
    await $fetch('/api/preferences', { method: 'PUT', body: { repairAttempts: value } })
  } catch {
    repairAttempts.value = previous
    toast.add({ title: 'Could not save that', color: 'error' })
  }
}

async function setNotification(key: NotificationKey, value: boolean) {
  const previous = notifications.value[key]
  notifications.value[key] = value
  try {
    await $fetch('/api/preferences', { method: 'PUT', body: { notifications: { [key]: value } } })
  } catch {
    notifications.value[key] = previous
    toast.add({ title: 'Could not save that', color: 'error' })
  }
}

onMounted(async () => {
  await load()
  syncRawJson()
})

onMounted(async () => {
  await fetchGithubImports()
})

async function onUpdateImport(owner: string, repo: string) {
  try {
    await updateImport(owner, repo)
    toast.add({ title: 'Import updated', color: 'success' })
  } catch {
    toast.add({ title: 'Update failed', color: 'error' })
  }
}

async function onRemoveImport(owner: string, repo: string) {
  try {
    await removeImport(owner, repo)
    toast.add({ title: 'Import removed', color: 'success' })
  } catch {
    toast.add({ title: 'Remove failed', color: 'error' })
  }
}

async function onCheckUpdates() {
  try {
    await checkUpdates()
    toast.add({ title: 'Update check complete', color: 'success' })
  } catch {
    toast.add({ title: 'Update check failed', color: 'error' })
  }
}

watch(settings, () => syncRawJson())

function syncRawJson() {
  if (settings.value) rawJson.value = JSON.stringify(settings.value, null, 2)
}

// ---- Structured field helpers ----

async function updateSetting(patch: Partial<Settings>) {
  if (!settings.value) return
  saving.value = true
  try {
    await save({ ...settings.value, ...patch })
    toast.add({ title: 'Settings saved', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Failed to save', description: e.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function toggleAlwaysThinking(enabled: boolean) {
  await updateSetting({ alwaysThinkingEnabled: enabled })
}

async function togglePlugin(name: string, enabled: boolean) {
  if (!settings.value) return
  await updateSetting({
    enabledPlugins: {
      ...settings.value.enabledPlugins,
      [name]: enabled,
    },
  })
}

async function removePlugin(name: string) {
  if (!settings.value?.enabledPlugins) return
  const { [name]: _, ...rest } = settings.value.enabledPlugins as Record<string, boolean>
  await updateSetting({ enabledPlugins: rest })
}

// ---- Status line ----

const statusLineType = ref('')
const statusLineCommand = ref('')

watch(settings, (val) => {
  if (val?.statusLine) {
    statusLineType.value = val.statusLine.type || ''
    statusLineCommand.value = val.statusLine.command || ''
  }
}, { immediate: true })

async function saveStatusLine() {
  if (!statusLineType.value && !statusLineCommand.value) {
    const { statusLine: _, ...rest } = settings.value || {}
    await updateSetting(rest as Settings)
  } else {
    await updateSetting({
      statusLine: {
        type: statusLineType.value,
        command: statusLineCommand.value,
      },
    })
  }
}

// ---- Hooks ----

const hooks = computed(() => {
  if (!settings.value?.hooks) return []
  return Object.entries(settings.value.hooks as Record<string, unknown[]>).map(([event, list]) => ({
    event,
    commands: Array.isArray(list) ? list : [],
  }))
})

/**
 * What one automation entry actually runs.
 *
 * These were rendered as `cmd.command || JSON.stringify(cmd)`, and the real
 * shape from Claude Code is `{ matcher?, hooks: [{ type, command }] }` — which
 * has no top-level `command`, so every entry fell through to the fallback and
 * the page printed `{"hooks":[{"type":"command","command":"[ -n \"$SUPER…`
 * at the reader. Six times.
 */
interface HookEntry {
  command?: string
  matcher?: string
  hooks?: { type?: string; command?: string }[]
}

function hookCommands(entry: unknown): string[] {
  if (typeof entry === 'string') return [entry]
  if (!entry || typeof entry !== 'object') return []

  const e = entry as HookEntry
  const nested = (e.hooks ?? [])
    .map(h => h.command)
    .filter((c): c is string => typeof c === 'string' && c.length > 0)

  if (nested.length) return nested
  return e.command ? [e.command] : []
}

function hookMatcher(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null
  const matcher = (entry as HookEntry).matcher
  // `*` is "anything", which is the default and not worth a line of its own.
  return matcher && matcher !== '*' ? matcher : null
}

const showAddHookModal = ref(false)
const newHookEvent = ref('')
const newHookCommand = ref('')
const newHookMatcher = ref('')

const hookEventOptions = [
  { value: 'PreToolUse', label: 'Before Claude uses a tool' },
  { value: 'PostToolUse', label: 'After Claude uses a tool' },
  { value: 'Notification', label: 'When a notification is sent' },
  { value: 'Stop', label: 'When Claude finishes' },
  { value: 'SubagentStop', label: 'When a sub-agent finishes' },
]

const hookEventLabels: Record<string, string> = {
  PreToolUse: 'Before Claude uses a tool',
  PostToolUse: 'After Claude uses a tool',
  Notification: 'When a notification is sent',
  Stop: 'When Claude finishes',
  SubagentStop: 'When a sub-agent finishes',
}

async function addHook() {
  if (!newHookEvent.value || !newHookCommand.value) return
  const currentHooks = (settings.value?.hooks || {}) as Record<string, unknown[]>
  const eventHooks = [...(currentHooks[newHookEvent.value] || [])]

  const hookEntry: Record<string, string> = { command: newHookCommand.value }
  if (newHookMatcher.value) hookEntry.matcher = newHookMatcher.value

  eventHooks.push(hookEntry)

  await updateSetting({
    hooks: { ...currentHooks, [newHookEvent.value]: eventHooks },
  })

  newHookEvent.value = ''
  newHookCommand.value = ''
  newHookMatcher.value = ''
  showAddHookModal.value = false
}

async function removeHook(event: string, index: number) {
  const currentHooks = (settings.value?.hooks || {}) as Record<string, unknown[]>
  const eventHooks = [...(currentHooks[event] || [])]
  eventHooks.splice(index, 1)

  const updatedHooks = { ...currentHooks }
  if (eventHooks.length === 0) {
    delete updatedHooks[event]
  } else {
    updatedHooks[event] = eventHooks
  }

  await updateSetting({ hooks: Object.keys(updatedHooks).length > 0 ? updatedHooks : undefined })
}

// ---- Raw JSON ----

async function saveRaw() {
  saving.value = true
  try {
    const parsed = JSON.parse(rawJson.value)
    await save(parsed)
    toast.add({ title: 'Settings saved', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Invalid JSON', description: e.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

// Cmd+S
if (import.meta.client) {
  const onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      if (viewMode.value === 'raw') saveRaw()
    }
  }
  onMounted(() => document.addEventListener('keydown', onKeydown))
  onUnmounted(() => document.removeEventListener('keydown', onKeydown))
}

const plugins = computed(() => {
  if (!settings.value?.enabledPlugins) return []
  return Object.entries(settings.value.enabledPlugins).map(([name, enabled]) => ({
    name,
    enabled: Boolean(enabled),
  }))
})

const charCount = computed(() => rawJson.value.length)
const lineCount = computed(() => rawJson.value.split('\n').length)
</script>

<template>
  <div>
    <PageHeader title="Settings">
      <template #right>
        <button
          class="fs-sm px-2 py-1 rounded focus-ring text-label"
          style="background: var(--surface-raised); border: 1px solid var(--border-default);"
          @click="viewMode = viewMode === 'structured' ? 'raw' : 'structured'"
        >
          {{ viewMode === 'structured' ? 'Raw JSON' : 'Structured' }}
        </button>
        <UButton v-if="viewMode === 'raw'" label="Save" icon="i-lucide-save" size="sm" :loading="saving" @click="saveRaw" />
      </template>
    </PageHeader>

    <div v-if="loading" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
    </div>

    <!-- Structured view -->
    <div v-else-if="viewMode === 'structured'" class="page-container py-6 flex gap-8 items-start">
      <!--
        A dozen unrelated sections used to sit in one continuous scroll with no
        way to navigate them, and Backups was the first thing on the page —
        before the project's own test and run commands. The rail names what is
        here and jumps to it; Backups moved to the end, where a thing you touch
        twice a year belongs.
      -->
      <nav class="hidden lg:block w-40 shrink-0 sticky space-y-0.5" :style="{ top: 'calc(var(--header-h) + 1.5rem)' }">
        <a
          v-for="item in sectionNav"
          :key="item.id"
          :href="`#settings-${item.id}`"
          class="block px-2.5 py-1.5 rounded-md fs-sm transition-colors focus-ring"
          :class="activeSection === item.id ? 'ink-accent' : 'text-label hover-bg'"
          :style="activeSection === item.id ? 'background: var(--accent-muted);' : undefined"
        >
          {{ item.label }}
        </a>
      </nav>

      <div class="flex-1 min-w-0 space-y-6">

      <!-- General -->
      <div
        id="settings-general"
        class="rounded-lg p-5 space-y-4 bg-card"
      >
        <h3 class="text-section-title">General</h3>

        <div class="space-y-4">
          <!-- Always Thinking toggle -->
          <div class="flex items-center justify-between">
            <div>
              <div class="type-strong">Always Thinking</div>
              <div class="fs-sm mt-0.5 text-label">
                When enabled, Claude takes more time to reason through complex problems before responding. Better answers, but slower and uses more resources.
              </div>
            </div>
            <label class="field-toggle">
              <input
                type="checkbox"
                :checked="settings?.alwaysThinkingEnabled"
                @change="toggleAlwaysThinking(($event.target as HTMLInputElement).checked)"
              />
              <span class="field-toggle__track">
                <span class="field-toggle__thumb" />
              </span>
            </label>
          </div>

          <!-- Costs money on every turn, so it says so rather than hiding it -->
          <div class="flex items-center justify-between">
            <div>
              <div class="type-strong">Say what each session did</div>
              <div class="fs-sm mt-0.5 text-label">
                After a session changes something, a small model writes one sentence describing
                it, shown on the sessions list. Just under a cent per turn that changes files —
                it appears on the spend page as "summary", so you can see what it comes to
                rather than taking that on trust.
              </div>
            </div>
            <label class="field-toggle">
              <input
                type="checkbox"
                :checked="summariseSessions"
                @change="setSummarise(($event.target as HTMLInputElement).checked)"
              />
              <span class="field-toggle__track">
                <span class="field-toggle__thumb" />
              </span>
            </label>
          </div>

          <!--
            Spends a whole turn at its own discretion, which is why it is off
            until somebody chooses it and why the ceiling is the setting rather
            than a checkbox.
          -->
          <div class="flex items-start justify-between gap-4">
            <!-- flex-1 min-w-0, or the select's width wins and the prose next
                 to it collapses to one word per line. -->
            <div class="flex-1 min-w-0">
              <div class="type-strong">Let sessions fix their own failing checks</div>
              <div class="fs-sm mt-0.5 text-label">
                When a turn leaves the checks failing, the session takes another turn at fixing
                it, carrying the failure with it, until they pass or it runs out of attempts.
                Off by default because it spends a full turn each time without being asked —
                <strong>Fix it</strong> on a failing session works either way.
              </div>
            </div>
            <!--
              Width on a wrapper, not on the control. `.field-select` sets
              `width: 100%`, which beats a `w-32` utility — and with `shrink-0`
              on top, flex could not correct it either, so the select ate the
              row and left the prose in a column one word wide.
            -->
            <div class="w-36 shrink-0">
              <select
                class="field-select"
                :value="String(repairAttempts)"
                @change="setRepairAttempts(Number(($event.target as HTMLSelectElement).value))"
              >
                <option value="0">Never</option>
                <option value="1">1 attempt</option>
                <option value="2">2 attempts</option>
                <option value="3">3 attempts</option>
                <option value="5">5 attempts</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Spending limits -->
      <div id="settings-limits" class="rounded-lg p-5 space-y-4 bg-card">
        <h3 class="text-section-title">Limits</h3>
        <p class="fs-sm text-meta">
          These stop work rather than report on it. Leave any of them blank for no limit.
          Today has cost <strong>{{ spentToday < 0.01 && spentToday > 0 ? '<$0.01' : `$${spentToday.toFixed(2)}` }}</strong> so far.
        </p>

        <div class="field-group">
          <label class="field-label">Most turns in one run</label>
          <input
            v-model="maxTurns"
            class="field-input sm:max-w-xs"
            placeholder="40"
            spellcheck="false"
          />
          <p class="field-hint">
            A turn is one exchange that used a tool, so real work spends them quickly. This is
            here to stop a loop running all night, not to say how much work is reasonable —
            a run that hits it stops unfinished and says so. Blank for the default of 40, up to 200.
          </p>
        </div>

        <div class="field-group">
          <label class="field-label">How much runs at once</label>
          <div class="w-48">
            <select v-model.number="maxConcurrentRuns" class="field-select">
              <option :value="1">One at a time</option>
              <option :value="2">2 at once</option>
              <option :value="3">3 at once</option>
              <option :value="5">5 at once</option>
              <option :value="0">No limit</option>
            </select>
          </div>
          <p class="field-hint">
            Work nobody is watching — rituals, sessions fixing their own checks, workflow
            steps — waits its turn above this. A turn you type is never queued: it starts
            immediately whatever else is going on. Five rituals due at 08:00 used to mean
            five agents at once on a sleeping laptop.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="field-group">
            <label class="field-label">Most per day</label>
            <input
              v-model="dailyCap"
              class="field-input"
              inputmode="decimal"
              placeholder="No limit"
              @keydown.enter="saveCaps"
            />
            <span class="field-hint">
              Across everything. Once reached, sessions refuse to start a turn and rituals
              are skipped until tomorrow — said out loud, never silently.
            </span>
          </div>

          <div class="field-group">
            <label class="field-label">Most per run</label>
            <input
              v-model="runCap"
              class="field-input"
              inputmode="decimal"
              placeholder="No limit"
              @keydown.enter="saveCaps"
            />
            <span class="field-hint">
              The only one that can stop a run part-way. Checked between turns, so a
              single expensive turn can overshoot it before anything notices — treat it
              as "stop after about this", not a hard ceiling.
            </span>
          </div>
        </div>

        <!--
          The limit that fits the plan most people are actually on. The two
          above are denominated in dollars, which is money a Pro or Max
          subscriber is never billed — their work stops for the rate limit
          instead, and nothing here used to mention it.
        -->
        <label
          class="flex items-start justify-between gap-4 py-2 px-3 rounded-md cursor-pointer"
          style="background: var(--input-bg);"
        >
          <span>
            <span class="type-strong text-body block">Leave room when I am near my limit</span>
            <span class="type-meta">
              Rituals and later workflow steps are skipped while Claude says you are close
              to a rate limit, so what is left goes to work you are doing yourself. A turn
              you type is never held back.
              <template v-if="quota?.known">
                Last heard: {{ quota.stale ? 'too long ago to rely on' : quotaLabel }}.
              </template>
              <template v-else>
                Nothing heard yet — it arrives during the next run.
              </template>
            </span>
          </span>
          <span class="field-toggle shrink-0 mt-0.5">
            <input
              type="checkbox"
              :checked="pauseOnQuotaWarning"
              @change="pauseOnQuotaWarning = ($event.target as HTMLInputElement).checked"
            />
            <span class="field-toggle__track">
              <span class="field-toggle__thumb" />
            </span>
          </span>
        </label>

        <UButton label="Save limits" size="sm" @click="saveCaps" />
      </div>

      <!-- Checks -->
      <div id="settings-checks" class="rounded-lg p-5 space-y-4 bg-card">
        <h3 class="text-section-title">Checks for this project</h3>
        <p class="fs-sm text-meta">
          The command that tells you whether this project works. It runs in a session's own
          workspace after any turn that changed files, and a session whose checks fail will not
          be merged without you saying so explicitly.
        </p>

        <div v-if="!checks?.dir" class="fs-sm text-label">
          Pick a project folder in the sidebar first — this is set per repository.
        </div>

        <template v-else>
          <div class="field-group">
            <label class="field-label">Command</label>
            <div class="flex gap-2">
              <input
                v-model="checkCommand"
                class="field-input flex-1 font-mono"
                placeholder="make check"
                spellcheck="false"
                @keydown.enter="saveChecks"
              />
              <UButton
                label="Save"
                size="sm"
                :loading="checksSaving"
                :disabled="checkCommand === (checks.command ?? '')"
                @click="saveChecks"
              />
            </div>
            <p v-if="checks.source === 'detected' && checks.from" class="field-hint">
              Nothing chosen yet, so this was inferred from {{ checks.from }}. Saving makes it the answer.
            </p>
            <p v-else-if="checks.configured === ''" class="field-hint">
              Turned off — this project is treated as having nothing to run, and sessions here
              merge on git's say-so alone.
            </p>
            <p v-else class="field-hint">
              Run through a shell in the session's workspace, so <span class="font-mono">&amp;&amp;</span>
              and pipes work. A non-zero exit means failed.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <UButton
              v-if="checks.configured !== ''"
              label="This project has no checks"
              size="xs"
              variant="ghost"
              color="neutral"
              :loading="checksSaving"
              @click="turnOffChecks"
            />
            <UButton
              v-if="checks.configured !== null"
              label="Reset to what's detected"
              size="xs"
              variant="ghost"
              color="neutral"
              :loading="checksSaving"
              @click="resetChecks"
            />
          </div>
        </template>
      </div>

      <!-- Preparing a workspace -->
      <div id="settings-setup" class="rounded-lg p-5 space-y-4 bg-card">
        <h3 class="text-section-title">Making a workspace runnable</h3>
        <p class="fs-sm text-meta">
          A session works in its own checkout of your repository, and a fresh checkout is only
          the tracked files — no dependencies, nothing generated. This is what makes one usable,
          run once per workspace before its first check.
        </p>

        <div v-if="!setup?.dir" class="fs-sm text-label">
          Pick a project folder in the sidebar first — this is set per repository.
        </div>

        <template v-else>
          <div class="field-group">
            <label class="field-label">Command</label>
            <div class="flex gap-2">
              <input
                v-model="setupCommand"
                class="field-input flex-1 font-mono"
                placeholder="pnpm install"
                spellcheck="false"
                @keydown.enter="saveSetup"
              />
              <UButton
                label="Save"
                size="sm"
                :loading="setupSaving"
                :disabled="setupCommand === (setup.command ?? '')"
                @click="saveSetup"
              />
            </div>
            <p v-if="setup.source === 'detected' && setup.from" class="field-hint">
              Nothing chosen yet, so this was inferred from {{ setup.from }}. Saving makes it the answer.
            </p>
            <p v-else-if="setup.configured === ''" class="field-hint">
              Turned off — a checkout of this project is treated as ready to run as it is.
            </p>
            <p v-else class="field-hint">
              A monorepo often needs more than a bare install — a build, or generated types.
              Chain them with <span class="font-mono">&amp;&amp;</span>.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <UButton
              v-if="setup.configured !== ''"
              label="Checkouts here need nothing"
              size="xs"
              variant="ghost"
              color="neutral"
              :loading="setupSaving"
              @click="turnOffSetup"
            />
            <UButton
              v-if="setup.configured !== null"
              label="Reset to what's detected"
              size="xs"
              variant="ghost"
              color="neutral"
              :loading="setupSaving"
              @click="resetSetup"
            />
          </div>
        </template>
      </div>

      <!-- Running it -->
      <div id="settings-dev" class="rounded-lg p-5 space-y-4 bg-card">
        <h3 class="text-section-title">Running this project</h3>
        <p class="fs-sm text-meta">
          What starts this project so you can look at it. Each session runs it in its own
          workspace, on a port of its own, so several can be up at once.
        </p>

        <div v-if="!dev?.dir" class="fs-sm text-label">
          Pick a project folder in the sidebar first — this is set per repository.
        </div>

        <template v-else>
          <div class="field-group">
            <label class="field-label">Command</label>
            <div class="flex gap-2">
              <input
                v-model="devCommand"
                class="field-input flex-1 font-mono"
                placeholder="npm run dev"
                spellcheck="false"
                @keydown.enter="saveDev"
              />
              <UButton
                label="Save"
                size="sm"
                :loading="devSaving"
                :disabled="devCommand === (dev.command ?? '')"
                @click="saveDev"
              />
            </div>
            <p v-if="dev.source === 'detected' && dev.from" class="field-hint">
              Nothing chosen yet, so this was inferred from {{ dev.from }}. Saving makes it the answer.
            </p>
            <p v-else-if="dev.configured === ''" class="field-hint">
              Turned off — there is nothing to preview in this project.
            </p>
            <p v-else class="field-hint">
              It is given a free port in <span class="font-mono">PORT</span>. A project that
              hardcodes one instead will have its sessions collide.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <UButton
              v-if="dev.configured !== ''"
              label="Nothing to preview here"
              size="xs"
              variant="ghost"
              color="neutral"
              :loading="devSaving"
              @click="turnOffDev"
            />
            <UButton
              v-if="dev.configured !== null"
              label="Reset to what's detected"
              size="xs"
              variant="ghost"
              color="neutral"
              :loading="devSaving"
              @click="resetDevCommand"
            />
          </div>
        </template>
      </div>

      <!-- What a run may touch -->
      <div id="settings-sandbox" class="rounded-lg p-5 space-y-4 bg-card">
        <h3 class="text-section-title flex items-center gap-2">
          What a run may touch
          <HelpTip
            title="Sandboxing"
            body="Commands a run decides to execute go through a sandbox: no network beyond the hosts you list, and no reaching outside what its permission rules already allow. It also means a sandboxed command need not stop and ask, so unattended work is interrupted less often."
          />
        </h3>
        <p class="fs-sm text-meta">
          Sessions and rituals run shell commands as you. Sandboxed, they reach only the hosts
          listed here — which is what makes leaving one running at 08:00 a reasonable thing to do.
        </p>

        <div v-if="!sandbox?.dir" class="fs-sm text-label">
          Pick a project folder in the sidebar first — this is set per repository.
        </div>

        <template v-else>
          <label
            class="flex items-start justify-between gap-4 py-2 px-3 rounded-md cursor-pointer"
            style="background: var(--input-bg);"
          >
            <span>
              <span class="type-strong text-body block">Sandbox runs in this project</span>
              <span class="type-meta">
                {{
                  sandbox.source === 'default'
                    ? 'On, because nothing has been chosen here. This is the default.'
                    : sandbox.enabled
                      ? 'On, by your choice.'
                      : 'Off — runs here reach your network and your disk as you do.'
                }}
              </span>
            </span>
            <span class="field-toggle shrink-0 mt-0.5">
              <input
                type="checkbox"
                :checked="sandbox.enabled ?? true"
                :disabled="sandboxSaving"
                @change="toggleSandbox(($event.target as HTMLInputElement).checked)"
              />
              <span class="field-toggle__track">
                <span class="field-toggle__thumb" />
              </span>
            </span>
          </label>

          <div v-if="sandbox.enabled" class="field-group">
            <label class="field-label">Hosts it may reach</label>
            <textarea
              v-model="allowedDomains"
              class="field-input w-full font-mono"
              rows="3"
              placeholder="registry.npmjs.org&#10;github.com"
              spellcheck="false"
            />
            <div class="flex">
              <UButton
                label="Save hosts"
                size="sm"
                :loading="sandboxSaving"
                :disabled="!domainsChanged"
                @click="saveDomains"
              />
            </div>
            <p class="field-hint">
              One per line, and empty means none at all. A run that needed a host it does not
              have fails on it, and the denial is in that run's output — which is usually how
              this list gets filled in: let it fail once, then paste what it asked for.
            </p>
          </div>

          <p v-else class="field-hint">
            Your own checks are unaffected either way — those are commands you configured
            yourself, and they run outside the sandbox.
          </p>

          <!-- Outside the two branches above: turning the sandbox off is exactly
               when you are most likely to want the default back. -->
          <UButton
            v-if="sandbox.source === 'configured'"
            label="Reset to the default"
            size="xs"
            variant="ghost"
            color="neutral"
            :loading="sandboxSaving"
            @click="resetSandboxChoice"
          />
        </template>
      </div>

      <!-- Status Line -->
      <div
        id="settings-statusline"
        class="rounded-lg p-5 space-y-4 bg-card"
      >
        <h3 class="text-section-title">Status Line</h3>
        <p class="fs-sm text-meta">
          Shows custom information in Claude Code's interface. Use a bash command to display dynamic content.
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="field-group">
            <label class="field-label">Type</label>
            <select v-model="statusLineType" class="field-select">
              <option value="">None</option>
              <option value="command">command</option>
            </select>
          </div>
          <div class="field-group">
            <label class="field-label">Command</label>
            <input v-model="statusLineCommand" class="field-input" placeholder="echo 'status...'" />
          </div>
        </div>

        <div class="flex justify-end">
          <UButton label="Save Status Line" size="sm" variant="soft" :loading="saving" @click="saveStatusLine" />
        </div>
      </div>

      <!-- Notifications -->
      <div id="settings-notifications" class="rounded-lg p-5 space-y-4 bg-card">
        <h3 class="text-section-label flex items-center gap-2">
          Notifications
          <HelpTip
            title="Being told things"
            body="Notifications come from your desktop rather than the browser, so they still arrive when this is closed — which is the point if you run it in the background."
          />
        </h3>
        <p class="type-body">
          Work carries on whether or not you are watching. These are how it reaches you when
          it stops being able to carry on.
        </p>

        <div class="space-y-2">
          <label
            v-for="option in NOTIFICATION_OPTIONS"
            :key="option.key"
            class="flex items-start justify-between gap-4 py-2 px-3 rounded-md cursor-pointer"
            style="background: var(--input-bg);"
            :style="{ opacity: option.key === 'enabled' || notifications.enabled ? 1 : 0.5 }"
          >
            <span>
              <span class="type-strong text-body block">{{ option.label }}</span>
              <span class="type-meta">{{ option.hint }}</span>
            </span>
            <span class="field-toggle shrink-0 mt-0.5">
              <input
                type="checkbox"
                :checked="notifications[option.key]"
                :disabled="option.key !== 'enabled' && !notifications.enabled"
                @change="setNotification(option.key, ($event.target as HTMLInputElement).checked)"
              />
              <span class="field-toggle__track">
                <span class="field-toggle__thumb" />
              </span>
            </span>
          </label>
        </div>
      </div>

      <!-- Plugins -->
      <div
        id="settings-marketplaces"
        class="rounded-lg p-5 space-y-4 bg-card"
      >
        <h3 class="text-section-label flex items-center gap-2">
          Extensions
          <HelpTip title="Managing extensions" body="Enable or disable extensions here. Install new ones via the Claude Code CLI." />
        </h3>
        <div v-if="plugins.length === 0" class="type-body">
          No plugins configured.
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="plugin in plugins"
            :key="plugin.name"
            class="flex items-center justify-between py-2 px-3 rounded-md"
            style="background: var(--input-bg);"
          >
            <span class="font-mono fs-sm text-body">{{ plugin.name }}</span>
            <div class="flex items-center gap-3">
              <label class="field-toggle">
                <input
                  type="checkbox"
                  :checked="plugin.enabled"
                  @change="togglePlugin(plugin.name, ($event.target as HTMLInputElement).checked)"
                />
                <span class="field-toggle__track">
                  <span class="field-toggle__thumb" />
                </span>
              </label>
              <button
                class="p-1.5 -m-0.5 rounded focus-ring text-meta"
                aria-label="Remove plugin from settings"
                @click="removePlugin(plugin.name)"
              >
                <UIcon name="i-lucide-x" class="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- GitHub Imports -->
      <div id="settings-imports" class="rounded-lg p-5 space-y-4 bg-card">
        <div class="flex items-center justify-between">
          <h3 class="text-section-title">GitHub Imports</h3>
          <UButton
            v-if="githubImports.length > 0"
            label="Check for updates"
            icon="i-lucide-refresh-cw"
            size="xs"
            variant="soft"
            @click="onCheckUpdates"
          />
        </div>
        <p class="fs-sm text-meta">
          Manage skill repositories imported from GitHub.
        </p>

        <div v-if="githubImports.length === 0" class="type-body">
          No GitHub imports. Use the Explore page to import skills from GitHub.
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="entry in githubImports"
            :key="`${entry.owner}/${entry.repo}`"
            class="flex items-center justify-between py-2 px-3 rounded-md"
            style="background: var(--input-bg);"
          >
            <div class="flex-1 min-w-0">
              <span class="font-mono fs-sm text-body">{{ entry.owner }}/{{ entry.repo }}</span>
              <span class="fs-micro text-meta ml-2">{{ entry.selectedSkills.length }} skills</span>
            </div>
            <div class="flex items-center gap-2">
              <span
                v-if="entry.currentSha !== entry.remoteSha"
                class="fs-micro font-medium px-2 py-0.5 rounded-full"
                style="background: var(--info-tint); color: var(--info);"
              >
                Update available
              </span>
              <UButton
                v-if="entry.currentSha !== entry.remoteSha"
                label="Update"
                size="xs"
                variant="soft"
                @click="onUpdateImport(entry.owner, entry.repo)"
              />
              <button
                class="p-1.5 -m-0.5 rounded focus-ring text-meta"
                aria-label="Remove import"
                @click="onRemoveImport(entry.owner, entry.repo)"
              >
                <UIcon name="i-lucide-x" class="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Hooks -->
      <div
        id="settings-automations"
        class="rounded-lg p-5 space-y-4 bg-card"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-section-title">Automations</h3>
          <UButton label="Add Automation" icon="i-lucide-plus" size="xs" variant="soft" @click="() => { showAddHookModal = true }" />
        </div>
        <p class="fs-sm text-meta">
          Run shell commands automatically when certain events happen in Claude Code.
        </p>

        <div v-if="hooks.length === 0" class="type-body">
          No automations configured.
        </div>

        <div v-else class="space-y-3">
          <div v-for="hook in hooks" :key="hook.event">
            <div class="flex items-center gap-2 mb-1.5">
              <UIcon name="i-lucide-webhook" class="size-3.5 text-meta" />
              <span class="fs-sm font-medium text-body">{{ hookEventLabels[hook.event] || hook.event }}</span>
              <span class="type-mono-meta">{{ hook.commands.length }}</span>
            </div>
            <div class="ml-5 space-y-1">
              <div
                v-for="(cmd, idx) in hook.commands"
                :key="idx"
                class="flex items-center justify-between py-1.5 px-3 rounded-md group"
                style="background: var(--input-bg);"
              >
                <div class="flex-1 min-w-0">
                  <span
                    v-for="(command, ci) in hookCommands(cmd)"
                    :key="ci"
                    class="font-mono fs-sm truncate block text-label"
                    :title="command"
                  >
                    {{ command }}
                  </span>
                  <span v-if="!hookCommands(cmd).length" class="fs-sm block text-meta">
                    Nothing to run — this entry has no command.
                  </span>
                  <span v-if="hookMatcher(cmd)" class="font-mono fs-micro block mt-0.5 text-meta">
                    only for {{ hookMatcher(cmd) }}
                  </span>
                </div>
                <button
                  class="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1.5 -m-0.5 rounded focus-ring"
                  style="color: var(--error);"
                  aria-label="Delete hook"
                  @click="removeHook(hook.event, idx)"
                >
                  <UIcon name="i-lucide-trash-2" class="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Last, because it is a thing you touch twice a year -->
      <div id="settings-backups">
        <BackupPanel />
      </div>
      </div>
    </div>

    <!-- Raw JSON editor -->
    <div v-else class="page-container py-6">
      <div
        class="rounded-lg overflow-hidden"
        style="border: 1px solid var(--border-subtle);"
      >
        <div class="flex items-center justify-between px-4 py-2.5" style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);">
          <h3 class="text-section-title">settings.json</h3>
          <div class="flex items-center gap-3">
            <span class="type-mono-meta">
              {{ lineCount }} lines
            </span>
            <span class="type-mono-meta">
              {{ charCount.toLocaleString() }} chars
            </span>
          </div>
        </div>
        <textarea
          v-model="rawJson"
          class="editor-textarea"
          style="min-height: 600px;"
          spellcheck="false"
        />
      </div>
    </div>

    <!-- Add Hook Modal -->
    <UModal v-model:open="showAddHookModal">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay">
          <h3 class="text-page-title">Add Automation</h3>
          <p class="fs-sm leading-relaxed text-label">
            Run a shell command automatically when a specific event happens.
          </p>

          <div class="field-group">
            <label class="field-label" data-required>When this happens</label>
            <select v-model="newHookEvent" class="field-select">
              <option value="" disabled>Select an event...</option>
              <option v-for="opt in hookEventOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>

          <div class="field-group">
            <label class="field-label" data-required>Run this command</label>
            <input v-model="newHookCommand" class="field-input" placeholder="e.g., bash -c 'echo done'" />
            <span class="field-hint">The shell command that will be executed</span>
          </div>

          <div class="field-group">
            <label class="field-label">Only for specific tools</label>
            <input v-model="newHookMatcher" class="field-input" placeholder="Leave blank for all (optional)" />
            <span class="field-hint">Only trigger when a specific tool is used (e.g., "Write" or "Bash")</span>
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="() => { showAddHookModal = false }" />
            <UButton
              label="Add"
              size="sm"
              :disabled="!newHookEvent || !newHookCommand"
              @click="addHook"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
