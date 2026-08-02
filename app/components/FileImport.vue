<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
const props = defineProps<{
  type: 'agents' | 'skills'
}>()

const emit = defineEmits<{
  imported: [item: { slug: string }]
}>()

const toast = useToast()
const importing = ref(false)
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function onDrop(e: DragEvent) {
  dragOver.value = false
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
    const result = await $fetch<{ slug: string }>(`/api/${props.type}/import`, {
      method: 'POST',
      body: { content },
    })
    toast.add({ title: `${props.type === 'agents' ? 'Agent' : 'Skill'} imported`, color: 'success' })
    emit('imported', result)
  } catch (e: any) {
    toast.add({ title: 'Import failed', description: errorMessage(e), color: 'error' })
  } finally {
    importing.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}
</script>

<template>
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
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" style="color: var(--accent);" />
      <span class="text-[12px] text-label">Importing...</span>
    </div>

    <div v-else class="flex flex-col items-center gap-2">
      <UIcon name="i-lucide-upload" class="size-6" style="color: var(--text-disabled);" />
      <p class="text-[13px] text-label">
        Drop a <code class="font-mono text-[11px] px-1 py-px rounded" style="background: var(--badge-subtle-bg);">.md</code> file here or click to browse
      </p>
      <p class="text-[11px] text-meta">
        Import an {{ type === 'agents' ? 'agent' : 'skill' }} exported from another setup
      </p>
    </div>
  </div>
</template>
