<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import type { SkillFile } from '~/types'

/**
 * The rest of the skill.
 *
 * SKILL.md is meant to stay short and defer to what sits beside it —
 * `references/` for detail read only when needed, `scripts/` for things run
 * rather than read. This app used to show only SKILL.md, so a skill written the
 * way the format intends appeared here with its instructions referring to files
 * that, as far as anything on screen was concerned, did not exist.
 *
 * A tree on the left, one file open on the right. Deliberately not a general
 * file browser: a skill is a handful of files and a picker with breadcrumbs
 * would be more chrome than content.
 */

const props = defineProps<{
  slug: string
  files: SkillFile[]
  /** Plugin and GitHub skills are shown, never written to. */
  readOnly?: boolean
}>()

const emit = defineEmits<{ 'update:files': [SkillFile[]] }>()

const { readFile, saveFile, removeFile } = useSkills()
const toast = useToast()

const selected = ref<string | null>(null)
const content = ref('')
const original = ref('')
const loadingFile = ref(false)
const savingFile = ref(false)
const loadError = ref<string | null>(null)

const showNewFile = ref(false)
const newPath = ref('')
const creating = ref(false)

const pendingDelete = ref<SkillFile | null>(null)

const editableFiles = computed(() => props.files.filter(f => f.kind === 'file' && !f.binary))
const isDirty = computed(() => selected.value !== null && content.value !== original.value)

/**
 * Indentation comes from the path, not from a nested data structure: the server
 * sends a flat sorted list, and turning it back into a tree only to render it
 * one level deep each time would be work for nothing.
 */
function depthOf(path: string): number {
  return path.split('/').length - 1
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024)} KB`
}

async function open(file: SkillFile) {
  if (file.kind === 'directory') return

  if (file.binary) {
    toast.add({ title: `${file.name} is not a text file`, color: 'warning' })
    return
  }

  if (isDirty.value && !confirm('Discard unsaved changes to the open file?')) return

  selected.value = file.path
  loadingFile.value = true
  loadError.value = null

  try {
    const result = await readFile(props.slug, file.path)
    content.value = result.content
    original.value = result.content
  } catch (e: unknown) {
    loadError.value = errorMessage(e)
    content.value = ''
    original.value = ''
  } finally {
    loadingFile.value = false
  }
}

async function save() {
  if (!selected.value) return

  savingFile.value = true
  try {
    const result = await saveFile(props.slug, selected.value, content.value)
    original.value = content.value
    emit('update:files', result.files)
    toast.add({ title: 'Saved', color: 'success' })
  } catch (e: unknown) {
    toast.add({ title: 'Failed to save', description: errorMessage(e), color: 'error' })
  } finally {
    savingFile.value = false
  }
}

async function create() {
  const path = newPath.value.trim()
  if (!path) return

  creating.value = true
  try {
    // Empty rather than a placeholder: a new reference file with boilerplate in
    // it reads as content the author wrote and then has to delete.
    const result = await saveFile(props.slug, path, '')
    emit('update:files', result.files)
    showNewFile.value = false
    newPath.value = ''

    const created = result.files.find(f => f.path === path)
    if (created) await open(created)
  } catch (e: unknown) {
    toast.add({ title: 'Could not create that file', description: errorMessage(e), color: 'error' })
  } finally {
    creating.value = false
  }
}

async function confirmDelete() {
  const file = pendingDelete.value
  if (!file) return

  try {
    const result = await removeFile(props.slug, file.path)
    emit('update:files', result.files)

    // The open file may have been what was just deleted, or may have been
    // inside the directory that was.
    if (selected.value === file.path || selected.value?.startsWith(`${file.path}/`)) {
      selected.value = null
      content.value = ''
      original.value = ''
    }

    toast.add({ title: `Deleted ${file.name}`, color: 'success' })
  } catch (e: unknown) {
    toast.add({ title: 'Failed to delete', description: errorMessage(e), color: 'error' })
  } finally {
    pendingDelete.value = null
  }
}
</script>

<template>
  <div class="rounded-lg overflow-hidden" style="border: 1px solid var(--border-subtle);">
    <div
      class="flex items-center justify-between px-4 py-2.5"
      style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);"
    >
      <div class="flex items-center gap-2">
        <h3 class="text-section-label">Supporting files</h3>
        <span class="type-mono-meta">{{ files.length }}</span>
      </div>
      <UButton
        v-if="!readOnly"
        label="New file"
        icon="i-lucide-file-plus"
        size="xs"
        variant="soft"
        @click="() => { showNewFile = true }"
      />
    </div>

    <!-- Nothing beside SKILL.md yet -->
    <div v-if="!files.length" class="px-5 py-8 flex flex-col items-center text-center gap-3">
      <UIcon name="i-lucide-folder-open" class="size-5 text-meta" />
      <p class="type-body max-w-md leading-relaxed">
        Just <span class="font-mono fs-mono">SKILL.md</span> so far. Put detail Claude
        should read only when it needs it in
        <span class="font-mono fs-mono">references/</span>, and anything meant to be run
        rather than read in <span class="font-mono fs-mono">scripts/</span>.
      </p>
      <UButton
        v-if="!readOnly"
        label="Add references/overview.md"
        size="xs"
        variant="outline"
        @click="() => { newPath = 'references/overview.md'; showNewFile = true }"
      />
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-[240px_1fr]">
      <!-- Tree -->
      <div
        class="py-2 lg:border-r"
        style="border-color: var(--border-subtle); background: var(--surface-base);"
      >
        <div
          v-for="file in files"
          :key="file.path"
          class="group flex items-center gap-2 pr-2 py-1"
          :style="{ paddingLeft: `${12 + depthOf(file.path) * 14}px` }"
        >
          <button
            class="flex items-center gap-2 min-w-0 flex-1 text-left rounded px-1 py-0.5 focus-ring"
            :class="file.kind === 'file' && !file.binary ? 'hover-bg' : 'cursor-default'"
            :style="{
              background: selected === file.path ? 'var(--accent-muted)' : 'transparent',
              color: selected === file.path ? 'var(--accent)' : undefined,
            }"
            @click="open(file)"
          >
            <UIcon
              :name="file.kind === 'directory'
                ? 'i-lucide-folder'
                : file.binary ? 'i-lucide-file-lock-2' : 'i-lucide-file-text'"
              class="size-3.5 shrink-0"
              :style="{ color: selected === file.path ? 'var(--accent)' : 'var(--text-tertiary)' }"
            />
            <span class="fs-sm truncate font-mono">{{ file.name }}</span>
            <span v-if="file.kind === 'file'" class="type-mono-meta shrink-0 ml-auto">
              {{ formatSize(file.size) }}
            </span>
          </button>
          <button
            v-if="!readOnly"
            class="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 focus-ring"
            :title="`Delete ${file.name}`"
            :aria-label="`Delete ${file.name}`"
            @click="() => { pendingDelete = file }"
          >
            <UIcon name="i-lucide-trash-2" class="size-3 text-meta" />
          </button>
        </div>
      </div>

      <!-- Open file -->
      <div class="min-w-0">
        <div
          v-if="!selected"
          class="h-full min-h-[220px] flex items-center justify-center px-6 text-center"
        >
          <p class="type-detail max-w-xs leading-relaxed">
            {{ editableFiles.length ? 'Pick a file to read or edit it.' : 'None of these are text files.' }}
          </p>
        </div>

        <template v-else>
          <div
            class="flex items-center justify-between gap-3 px-4 py-2"
            style="border-bottom: 1px solid var(--border-subtle);"
          >
            <span class="font-mono fs-mono truncate text-label">{{ selected }}</span>
            <div class="flex items-center gap-2 shrink-0">
              <span v-if="isDirty" class="fs-micro font-mono unsaved-pulse ink-warn">
                unsaved
              </span>
              <UButton
                v-if="!readOnly"
                label="Save"
                size="xs"
                :loading="savingFile"
                :disabled="!isDirty"
                @click="save"
              />
            </div>
          </div>

          <div v-if="loadError" class="px-4 py-3 fs-sm ink-error">
            {{ loadError }}
          </div>
          <div v-else-if="loadingFile" class="flex justify-center py-12">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-meta" />
          </div>
          <CodeEditor
            v-else
            v-model="content"
            :path="selected"
            :disabled="readOnly"
          />
        </template>
      </div>
    </div>

    <!-- New file -->
    <UModal v-model:open="showNewFile">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay modal-panel">
          <h3 class="text-page-title">New supporting file</h3>
          <div class="field-group">
            <label class="field-label">Path</label>
            <input
              v-model="newPath"
              class="field-input font-mono"
              placeholder="references/api.md"
              @keydown.enter="create"
            />
            <span class="field-hint">
              Relative to the skill. Directories in the path are created as needed.
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              variant="ghost"
              color="neutral"
              size="sm"
              @click="() => { showNewFile = false }"
            />
            <UButton label="Create" size="sm" :loading="creating" :disabled="!newPath.trim()" @click="create" />
          </div>
        </div>
      </template>
    </UModal>

    <!-- Delete -->
    <UModal :open="Boolean(pendingDelete)" @update:open="(v) => { if (!v) pendingDelete = null }">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay modal-panel">
          <h3 class="text-page-title">
            Delete {{ pendingDelete?.kind === 'directory' ? 'directory' : 'file' }}
          </h3>
          <p class="type-body">
            Permanently delete <strong class="font-mono">{{ pendingDelete?.path }}</strong>?
            <template v-if="pendingDelete?.kind === 'directory'">
              Everything inside it goes too.
            </template>
            This cannot be undone.
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="() => { pendingDelete = null }" />
            <UButton label="Delete" color="error" size="sm" @click="confirmDelete" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
