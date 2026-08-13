<script setup lang="ts">
import type { Command, CommandFrontmatter } from '~/types'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { fetchOne, update, remove } = useCommands()
const { runCommand } = useChat()

const showRun = ref(false)

const slug = route.params.slug as string
const command = ref<Command | null>(null)
const saving = ref(false)

const frontmatter = ref<CommandFrontmatter>({
  name: '',
  description: '',
})
const body = ref('')
const allowedToolsStr = ref('')

const { hasDraft, draftAge, loadDraft, clearDraft, scheduleSave } = useDraftRecovery(`command:${slug}`)

watch([frontmatter, body], () => {
  if (command.value && command.value.source !== 'plugin') {
    scheduleSave(frontmatter.value, body.value)
  }
}, { deep: true })

function restoreDraft() {
  const draft = loadDraft()
  if (draft) {
    // A draft is whatever was in localStorage, so nothing about its shape is
    // guaranteed — the double step is the honest way to say that.
    frontmatter.value = draft.frontmatter as unknown as CommandFrontmatter
    body.value = draft.body
    clearDraft()
    toast.add({ title: 'Draft restored', color: 'success' })
  }
}

onMounted(async () => {
  try {
    command.value = await fetchOne(slug)
    frontmatter.value = { ...command.value.frontmatter }
    body.value = command.value.body
    allowedToolsStr.value = (command.value.frontmatter['allowed-tools'] || []).join(', ')
  } catch {
    toast.add({ title: 'Command not found', color: 'error' })
    router.push('/commands')
  }
})

async function save() {
  if (command.value?.source === 'plugin') return
  if (!frontmatter.value.name.trim()) {
    toast.add({ title: 'Name is required', color: 'error' })
    return
  }
  saving.value = true
  try {
    const tools = allowedToolsStr.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const payload = {
      frontmatter: {
        ...frontmatter.value,
        'allowed-tools': tools.length > 0 ? tools : undefined,
      },
      body: body.value,
    }
    const updated = await update(slug, payload)
    command.value = updated
    clearDraft()
    toast.add({ title: 'Saved', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Failed to save', description: e.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

const showDeleteConfirm = ref(false)

async function deleteCommand() {
  try {
    await remove(slug)
    toast.add({ title: 'Deleted', color: 'success' })
    router.push('/commands')
  } catch {
    toast.add({ title: 'Failed to delete', color: 'error' })
  }
}

// Cmd+S to save
if (import.meta.client) {
  const onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      save()
    }
  }
  onMounted(() => document.addEventListener('keydown', onKeydown))
  onUnmounted(() => document.removeEventListener('keydown', onKeydown))
}

const charCount = computed(() => body.value.length)
const lineCount = computed(() => body.value.split('\n').length)

/** Plugin commands live inside an installed package — editing them here would
 * be silently reverted on the next plugin update. */
const readOnly = computed(() => command.value?.source === 'plugin')

const isDirty = computed(() => {
  if (!command.value || readOnly.value) return false
  return JSON.stringify(frontmatter.value) !== JSON.stringify(command.value.frontmatter)
    || body.value !== command.value.body
    || allowedToolsStr.value !== (command.value.frontmatter['allowed-tools'] || []).join(', ')
})

useUnsavedChanges(isDirty)
</script>

<template>
  <div>
    <PageHeader :title="command?.frontmatter.name || slug">
      <template #leading>
        <NuxtLink :to="{ path: '/library', query: { type: 'commands' } }" class="focus-ring rounded p-1.5 -m-1.5" aria-label="Back to the library">
          <UIcon name="i-lucide-arrow-left" class="size-4 text-label" />
        </NuxtLink>
      </template>
      <template #trailing>
        <span v-if="command" class="font-mono fs-sm ink-accent">
          {{ command.invocation }}
        </span>
        <SourceBadge
          v-if="command"
          :scope="command.scope"
          :source="command.source"
          :plugin-name="command.pluginName"
          :project-dir="command.projectDir"
        />
      </template>
      <template #right>
        <UButton
          v-if="command"
          label="Run"
          icon="i-lucide-play"
          size="sm"
          variant="soft"
          @click="() => { showRun = true }"
        />
        <NuxtLink
          v-if="readOnly && command?.pluginId"
          :to="`/plugins/${encodeURIComponent(command.pluginId)}?tab=commands`"
          class="fs-sm px-2 py-1 rounded focus-ring text-label"
        >
          View in plugin
        </NuxtLink>
        <template v-else>
          <button
            class="fs-sm px-2 py-1 rounded focus-ring text-label"
            @click="showDeleteConfirm = true"
          >
            Delete
          </button>
          <span v-if="isDirty" class="fs-micro font-mono unsaved-pulse ink-warn">unsaved</span>
          <UButton label="Save" icon="i-lucide-save" size="sm" :loading="saving" @click="save" />
        </template>
      </template>
    </PageHeader>

    <div v-if="command" class="page-container py-6 space-y-6">
      <!-- Read-only notice for plugin-provided commands -->
      <div
        v-if="readOnly"
        class="rounded-lg px-4 py-3 flex items-center gap-3"
        style="background: var(--plugin-wash); border: 1px solid var(--plugin-tint);"
      >
        <UIcon name="i-lucide-puzzle" class="size-4 shrink-0" style="color: var(--plugin);" />
        <span class="fs-sm flex-1 text-body">
          <strong>{{ command.invocation }}</strong> comes from the
          <strong>{{ command.pluginName }}</strong> plugin. It's shown read-only here — edits would be
          overwritten the next time the plugin updates.
        </span>
      </div>

      <!-- Draft recovery banner -->
      <div
        v-if="hasDraft && !readOnly"
        class="rounded-lg px-4 py-3 flex items-center gap-3"
        style="background: var(--info-wash); border: 1px solid var(--info-tint);"
      >
        <UIcon name="i-lucide-archive-restore" class="size-4 shrink-0" style="color: var(--info);" />
        <span class="fs-sm flex-1 ink-2">
          You have an unsaved draft from {{ draftAge }}.
        </span>
        <button class="fs-sm font-medium px-2 py-1 rounded hover-bg" style="color: var(--info);" @click="restoreDraft">Restore</button>
        <button class="fs-sm px-2 py-1 rounded hover-bg text-meta" @click="clearDraft">Dismiss</button>
      </div>

      <!-- Configuration -->
      <div
        class="rounded-lg p-5 space-y-4 bg-card"
      >
        <h3 class="text-section-label">Configuration</h3>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="field-group">
            <label class="field-label">Name</label>
            <input v-model="frontmatter.name" class="field-input" :disabled="readOnly" />
            <span class="field-hint">The slash command name (e.g., "deploy" becomes /deploy)</span>
          </div>
          <div class="field-group">
            <label class="field-label">Expected Input</label>
            <input v-model="frontmatter['argument-hint']" class="field-input" :disabled="readOnly" placeholder="file name or topic" />
            <span class="field-hint">Shown as a hint when users type this command</span>
          </div>
        </div>

        <div class="field-group">
          <label class="field-label">Description</label>
          <textarea v-model="frontmatter.description" rows="2" class="field-textarea" :disabled="readOnly" />
          <span class="field-hint">Helps Claude understand when to suggest this command</span>
        </div>

        <div class="field-group">
          <label class="field-label">Tool Permissions</label>
          <input v-model="allowedToolsStr" class="field-input" :disabled="readOnly" placeholder="Read, Write, Bash" />
          <span class="field-hint">Restrict what Claude can do. Leave blank to allow all. Options: Read, Write, Edit, Bash, Glob, Grep</span>
        </div>
      </div>

      <!-- Command Body Editor -->
      <div
        class="rounded-lg overflow-hidden"
        style="border: 1px solid var(--border-subtle);"
      >
        <div class="flex items-center justify-between px-4 py-2.5" style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);">
          <h3 class="text-section-label">Instructions</h3>
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
          v-model="body"
          class="editor-textarea"
          style="min-height: 500px;"
          :readonly="readOnly"
          spellcheck="false"
          placeholder="Command instructions..."
        />
      </div>

      <!-- File location (collapsed) -->
      <details class="group">
        <summary class="fs-micro cursor-pointer list-none flex items-center gap-1.5 text-meta">
          <UIcon name="i-lucide-file" class="size-3" />
          Show file location
        </summary>
        <div class="mt-1 font-mono fs-micro pl-4.5 text-meta">
          {{ command.filePath }}
        </div>
      </details>
    </div>

    <div v-else class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
    </div>

    <!-- Run -->
    <UModal v-model:open="showRun">
      <template #content>
        <RunModal :command="command" @close="showRun = false" />
      </template>
    </UModal>

    <!-- Delete confirmation -->
    <UModal v-model:open="showDeleteConfirm">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay">
          <h3 class="text-page-title">Delete Command</h3>
          <p class="fs-base text-body">
            Permanently delete <strong>/{{ command?.frontmatter.name }}</strong>? This action cannot be undone.
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="() => { showDeleteConfirm = false }" />
            <UButton label="Delete" color="error" size="sm" @click="deleteCommand" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
