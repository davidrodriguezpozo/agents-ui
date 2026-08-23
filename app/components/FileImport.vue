<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { toBase64 } from '~/utils/base64'
import type { SkillImportFile } from '~/composables/useSkills'

const props = defineProps<{
  type: 'agents' | 'skills'
}>()

const emit = defineEmits<{
  imported: [item: { slug: string }]
}>()

const toast = useToast()
const { importSkill } = useSkills()
const importing = ref(false)
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)

/**
 * An agent is one file. A skill is a directory, so it gets both: a single
 * SKILL.md for the quick case, and the whole folder for skills that defer to
 * `references/` or `scripts/` — which arrive broken if only their SKILL.md
 * comes across.
 */
const isSkill = computed(() => props.type === 'skills')

/** Past this it is not a file that belongs in a skill. Matches the server. */
const MAX_BYTES = 2 * 1024 * 1024

function onDrop(e: DragEvent) {
  dragOver.value = false

  // A dropped folder arrives as an entry with no `File` behind it, so the
  // single-file path below would report "not a .md file" about a directory.
  const entry = e.dataTransfer?.items?.[0]?.webkitGetAsEntry?.()
  if (entry?.isDirectory) {
    toast.add({
      title: 'Use "Choose a folder" for a directory',
      description: 'Dropping folders is not supported — the button below reads the whole skill.',
      color: 'warning',
    })
    return
  }

  const file = e.dataTransfer?.files[0]
  if (file) handleFile(file)
}

function onFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) handleFile(file)
}

async function handleFile(file: File) {
  if (!file.name.endsWith('.md')) {
    toast.add({ title: 'Invalid file', description: 'Please upload a .md file', color: 'error' })
    return
  }

  importing.value = true
  try {
    const content = await file.text()
    const result = isSkill.value
      ? await importSkill({ content })
      : await $fetch<{ slug: string }>(`/api/${props.type}/import`, {
        method: 'POST',
        body: { content },
      })
    toast.add({ title: `${isSkill.value ? 'Skill' : 'Agent'} imported`, color: 'success' })
    emit('imported', result)
  } catch (e: any) {
    toast.add({ title: 'Import failed', description: errorMessage(e), color: 'error' })
  } finally {
    importing.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function onFolderSelect(e: Event) {
  const picked = (e.target as HTMLInputElement).files
  if (!picked?.length) return

  importing.value = true
  try {
    const files: SkillImportFile[] = []
    const skipped: string[] = []

    for (const file of Array.from(picked)) {
      // `webkitRelativePath` is the only place the folder structure survives —
      // `name` is just the basename, so without it every file would land flat.
      const path = file.webkitRelativePath || file.name

      if (file.size > MAX_BYTES) {
        skipped.push(path)
        continue
      }

      files.push(await readImportFile(file, path))
    }

    const result = await importSkill({ files })
    toast.add({
      title: 'Skill imported',
      description: skipped.length ? `Too large to include: ${skipped.join(', ')}` : undefined,
      color: skipped.length ? 'warning' : 'success',
    })
    emit('imported', result)
  } catch (e: any) {
    toast.add({ title: 'Import failed', description: errorMessage(e), color: 'error' })
  } finally {
    importing.value = false
    if (folderInput.value) folderInput.value.value = ''
  }
}

/**
 * Text as text, everything else base64.
 *
 * Decided on the bytes rather than the extension, which is the same call
 * `looksBinary` makes on the server: a NUL in the first few KB. An extension
 * list would send an extensionless script as base64 and, worse, a mislabelled
 * `.md` as UTF-8, which corrupts it on the way in.
 */
async function readImportFile(file: File, path: string): Promise<SkillImportFile> {
  const buffer = new Uint8Array(await file.arrayBuffer())

  if (!buffer.subarray(0, 8000).includes(0)) {
    return { path, content: new TextDecoder().decode(buffer) }
  }

  return { path, content: toBase64(buffer), encoding: 'base64' }
}
</script>

<template>
  <div class="space-y-2">
    <div
      class="rounded-lg p-6 text-center transition-all duration-150 cursor-pointer"
      :style="{
        background: dragOver ? 'var(--accent-muted)' : 'var(--surface-raised)',
        border: dragOver ? '2px dashed var(--accent)' : '2px dashed var(--border-subtle)',
      }"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
      @click="fileInput?.click()"
    >
      <input
        ref="fileInput"
        type="file"
        accept=".md"
        class="hidden"
        @change="onFileSelect"
      />

      <div v-if="importing" class="flex flex-col items-center gap-2">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin ink-accent" />
        <span class="type-detail">Importing...</span>
      </div>

      <div v-else class="flex flex-col items-center gap-2">
        <UIcon name="i-lucide-upload" class="size-6 ink-4" />
        <p class="type-body">
          Drop a <code class="font-mono fs-mono px-1 py-px rounded" style="background: var(--badge-subtle-bg);">.md</code> file here or click to browse
        </p>
        <p class="type-meta">
          Import an {{ type === 'agents' ? 'agent' : 'skill' }} exported from another setup
        </p>
      </div>
    </div>

    <!-- Skills are directories, so importing one whole is the honest option -->
    <div v-if="isSkill && !importing" class="flex items-center justify-center gap-2">
      <span class="type-meta">Has a references/ or scripts/ folder?</span>
      <input
        ref="folderInput"
        type="file"
        webkitdirectory
        multiple
        class="hidden"
        @change="onFolderSelect"
      />
      <button
        class="fs-sm font-medium rounded px-2 py-1 focus-ring hover-bg"
        style="color: var(--accent);"
        @click="folderInput?.click()"
      >
        Choose a folder
      </button>
    </div>
  </div>
</template>
