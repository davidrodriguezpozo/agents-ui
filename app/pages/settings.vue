<script setup lang="ts">
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

const rawJson = ref('')
const saving = ref(false)
const viewMode = ref<'structured' | 'raw'>('structured')

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

onMounted(async () => {
  try {
    const prefs = await $fetch<{ notifications: Record<NotificationKey, boolean> }>('/api/preferences')
    notifications.value = prefs.notifications
  } catch {
    // Leaving the defaults on screen is better than an error about a toggle.
  }
})

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
          class="text-[12px] px-2 py-1 rounded focus-ring text-label"
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
    <div v-else-if="viewMode === 'structured'" class="px-6 py-4 space-y-6">

      <BackupPanel />

      <!-- General -->
      <div
        class="rounded-lg p-5 space-y-4 bg-card"
      >
        <h3 class="text-section-title">General</h3>

        <div class="space-y-4">
          <!-- Always Thinking toggle -->
          <div class="flex items-center justify-between">
            <div>
              <div class="type-strong">Always Thinking</div>
              <div class="text-[12px] mt-0.5 text-label">
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
        </div>
      </div>

      <!-- Status Line -->
      <div
        class="rounded-lg p-5 space-y-4 bg-card"
      >
        <h3 class="text-section-title">Status Line</h3>
        <p class="text-[12px] text-meta">
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
      <div class="rounded-lg p-5 space-y-4 bg-card">
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
            <span class="font-mono text-[12px] text-body">{{ plugin.name }}</span>
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
      <div class="rounded-lg p-5 space-y-4 bg-card">
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
        <p class="text-[12px] text-meta">
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
              <span class="font-mono text-[12px] text-body">{{ entry.owner }}/{{ entry.repo }}</span>
              <span class="text-[10px] text-meta ml-2">{{ entry.selectedSkills.length }} skills</span>
            </div>
            <div class="flex items-center gap-2">
              <span
                v-if="entry.currentSha !== entry.remoteSha"
                class="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style="background: rgba(59, 130, 246, 0.1); color: var(--info, #3b82f6);"
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
        class="rounded-lg p-5 space-y-4 bg-card"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-section-title">Automations</h3>
          <UButton label="Add Automation" icon="i-lucide-plus" size="xs" variant="soft" @click="() => { showAddHookModal = true }" />
        </div>
        <p class="text-[12px] text-meta">
          Run shell commands automatically when certain events happen in Claude Code.
        </p>

        <div v-if="hooks.length === 0" class="type-body">
          No automations configured.
        </div>

        <div v-else class="space-y-3">
          <div v-for="hook in hooks" :key="hook.event">
            <div class="flex items-center gap-2 mb-1.5">
              <UIcon name="i-lucide-webhook" class="size-3.5 text-meta" />
              <span class="text-[12px] font-medium text-body">{{ hookEventLabels[hook.event] || hook.event }}</span>
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
                  <span class="font-mono text-[12px] truncate block text-label">
                    {{ typeof cmd === 'string' ? cmd : (cmd as any).command || JSON.stringify(cmd) }}
                  </span>
                  <span
                    v-if="typeof cmd === 'object' && (cmd as any).matcher"
                    class="font-mono text-[10px] block mt-0.5 text-meta"
                  >
                    matcher: {{ (cmd as any).matcher }}
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
    </div>

    <!-- Raw JSON editor -->
    <div v-else class="px-6 py-4">
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
          <p class="text-[12px] leading-relaxed text-label">
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
