<script setup lang="ts">
import type { Command, CommandFrontmatter } from '~/types'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { fetchOne, update, remove } = useCommands()

const slug = route.params.slug as string
const command = ref<Command | null>(null)
const saving = ref(false)

const frontmatter = ref<CommandFrontmatter>({
  name: '',
  description: '',
})
const body = ref('')
const allowedToolsStr = ref('')

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

const isDirty = computed(() => {
  if (!command.value) return false
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
        <NuxtLink to="/commands" class="focus-ring rounded">
          <UIcon name="i-lucide-arrow-left" class="size-4" style="color: var(--text-tertiary);" />
        </NuxtLink>
      </template>
      <template #trailing>
        <span
          v-if="command"
          class="font-mono text-[10px] font-medium px-1.5 py-px rounded-full"
          style="background: rgba(255,255,255,0.06); color: var(--text-disabled);"
        >
          {{ command.directory }}
        </span>
      </template>
      <template #right>
        <button
          class="text-[12px] px-2 py-1 rounded focus-ring"
          style="color: var(--text-tertiary);"
          @click="showDeleteConfirm = true"
        >
          Delete
        </button>
        <span v-if="isDirty" class="text-[10px] font-mono" style="color: var(--warning);">unsaved</span>
        <UButton label="Save" icon="i-lucide-save" size="sm" :loading="saving" @click="save" />
      </template>
    </PageHeader>

    <!-- Breadcrumb -->
    <div class="px-6 pt-3 pb-1">
      <span class="text-[11px]" style="color: var(--text-disabled);">
        Commands &rsaquo; {{ command?.directory }} &rsaquo; {{ command?.frontmatter.name || slug }}
      </span>
    </div>

    <div v-if="command" class="px-6 py-4 space-y-6">
      <!-- Configuration -->
      <div
        class="rounded-xl p-5 space-y-4"
        style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
      >
        <h3 class="text-section-label">Configuration</h3>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="field-group">
            <label class="field-label">Name</label>
            <input v-model="frontmatter.name" class="field-input" />
          </div>
          <div class="field-group">
            <label class="field-label">Argument Hint</label>
            <input v-model="frontmatter['argument-hint']" class="field-input" placeholder="<phase-number>" />
          </div>
        </div>

        <div class="field-group">
          <label class="field-label">Description</label>
          <textarea v-model="frontmatter.description" rows="2" class="field-textarea" />
        </div>

        <div class="field-group">
          <label class="field-label">Allowed Tools</label>
          <input v-model="allowedToolsStr" class="field-input" placeholder="Read, Write, Bash, Glob, Grep" />
          <span class="field-hint">Comma-separated list</span>
        </div>
      </div>

      <!-- Command Body Editor -->
      <div
        class="rounded-xl overflow-hidden"
        style="border: 1px solid var(--border-subtle);"
      >
        <div class="flex items-center justify-between px-4 py-2.5" style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);">
          <h3 class="text-section-label">Command Body</h3>
          <div class="flex items-center gap-3">
            <span class="font-mono text-[10px]" style="color: var(--text-disabled);">
              {{ lineCount }} lines
            </span>
            <span class="font-mono text-[10px]" style="color: var(--text-disabled);">
              {{ charCount.toLocaleString() }} chars
            </span>
          </div>
        </div>
        <textarea
          v-model="body"
          class="editor-textarea"
          style="min-height: 500px;"
          spellcheck="false"
          placeholder="Command instructions..."
        />
      </div>

      <!-- File info -->
      <div class="flex items-center gap-3 font-mono text-[10px]" style="color: var(--text-disabled);">
        <span>{{ command.filePath }}</span>
      </div>
    </div>

    <div v-else class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" style="color: var(--text-disabled);" />
    </div>

    <!-- Delete confirmation -->
    <UModal v-model:open="showDeleteConfirm">
      <template #content>
        <div class="p-6 space-y-4" style="background: var(--surface-overlay);">
          <h3 class="text-page-title">Delete Command</h3>
          <p class="text-[13px]" style="color: var(--text-secondary);">
            Delete <strong class="font-mono">/{{ command?.frontmatter.name }}</strong>? This removes the file from disk.
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="showDeleteConfirm = false" />
            <UButton label="Delete" color="error" size="sm" @click="deleteCommand" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
