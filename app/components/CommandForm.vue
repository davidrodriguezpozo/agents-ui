<script setup lang="ts">
import type { Command, CommandFrontmatter } from '~/types'

const emit = defineEmits<{
  saved: [command: Command]
  cancel: []
}>()

const { create, commands } = useCommands()
const toast = useToast()
const saving = ref(false)
const submitted = ref(false)

const frontmatter = ref<CommandFrontmatter>({
  name: '',
  description: '',
})
const body = ref('')
const directory = ref('')
const allowedToolsStr = ref('')

const existingDirs = computed(() => {
  const dirs = new Set<string>()
  for (const cmd of commands.value) {
    if (cmd.directory) dirs.add(cmd.directory)
  }
  return Array.from(dirs).sort()
})

const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!frontmatter.value.name.trim()) e.name = 'Name is required'
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(frontmatter.value.name.trim()))
    e.name = 'Use lowercase letters, numbers, and hyphens only'
  if (!frontmatter.value.description.trim()) e.description = 'Description is required'
  return e
})

const isValid = computed(() => Object.keys(errors.value).length === 0)

function fieldError(field: string) {
  return submitted.value ? errors.value[field] : undefined
}

async function save() {
  submitted.value = true
  if (!isValid.value) return

  saving.value = true
  try {
    const tools = allowedToolsStr.value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const command = await create({
      frontmatter: {
        ...frontmatter.value,
        'allowed-tools': tools.length > 0 ? tools : undefined,
      },
      body: body.value,
      directory: directory.value || undefined,
    })
    toast.add({ title: 'Command created', color: 'success' })
    emit('saved', command)
  } catch (e: any) {
    toast.add({ title: 'Failed to create', description: e.data?.message || e.message, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="p-6 space-y-4" style="background: var(--surface-overlay);">
    <h3 class="text-page-title">New Command</h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="field-group">
        <label class="field-label" data-required>Name</label>
        <input
          v-model="frontmatter.name"
          class="field-input"
          :class="{ 'field-input--error': fieldError('name') }"
          placeholder="my-command"
        />
        <span v-if="fieldError('name')" class="field-error">{{ fieldError('name') }}</span>
        <span v-else class="field-hint">e.g. gsd:my-command</span>
      </div>

      <div class="field-group">
        <label class="field-label">Directory</label>
        <input v-model="directory" class="field-input" placeholder="gsd" :list="existingDirs.length > 0 ? 'dirs-list' : undefined" />
        <datalist v-if="existingDirs.length > 0" id="dirs-list">
          <option v-for="d in existingDirs" :key="d" :value="d" />
        </datalist>
        <span class="field-hint">Subdirectory inside commands/</span>
      </div>
    </div>

    <div class="field-group">
      <label class="field-label" data-required>Description</label>
      <textarea
        v-model="frontmatter.description"
        rows="2"
        class="field-textarea"
        :class="{ 'field-input--error': fieldError('description') }"
        placeholder="What this command does..."
      />
      <span v-if="fieldError('description')" class="field-error">{{ fieldError('description') }}</span>
    </div>

    <div class="field-group">
      <label class="field-label">Allowed Tools</label>
      <input v-model="allowedToolsStr" class="field-input" placeholder="Read, Write, Bash, Glob, Grep" />
      <span class="field-hint">Comma-separated list</span>
    </div>

    <div class="field-group">
      <label class="field-label">Command Body</label>
      <textarea
        v-model="body"
        class="editor-textarea editor-textarea--standalone"
        spellcheck="false"
        placeholder="<objective>..."
      />
    </div>

    <div class="flex justify-end gap-2 pt-2">
      <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="emit('cancel')" />
      <UButton label="Create" size="sm" :loading="saving" @click="save" />
    </div>
  </div>
</template>
