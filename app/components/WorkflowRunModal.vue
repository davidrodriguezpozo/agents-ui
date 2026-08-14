<script setup lang="ts">
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  start: [prompt: string, projectDir?: string]
}>()

const { workingDir } = useWorkingDir()
const prompt = ref('')
const projectDir = ref(workingDir.value)

function onStart() {
  if (!prompt.value.trim()) return
  emit('start', prompt.value.trim(), projectDir.value.trim() || undefined)
  prompt.value = ''
  projectDir.value = ''
}

function onCancel() {
  emit('update:open', false)
  prompt.value = ''
  projectDir.value = workingDir.value
}

// Sync project dir from global working dir when modal opens
watch(() => props.open, (val) => {
  if (val) projectDir.value = workingDir.value
})
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)">
    <template #content>
      <div class="p-6 space-y-4 bg-overlay modal-panel">
        <h3 class="text-page-title">Run Workflow</h3>
        <p class="type-detail">
          What should this workflow process? The output of each step becomes the input for the next.
        </p>
        <form @submit.prevent="onStart">
          <div class="space-y-4">
            <div class="field-group">
              <label class="field-label">Initial prompt</label>
              <textarea
                v-model="prompt"
                placeholder="e.g., Review the authentication module in src/auth/"
                rows="4"
                class="field-input w-full resize-none"
              />
            </div>
            <div class="field-group">
              <label class="field-label">
                Project folder
                <span class="fs-micro font-normal ml-1 ink-4">optional</span>
              </label>
              <input
                v-model="projectDir"
                placeholder="/Users/you/projects/my-app"
                class="field-input w-full"
              />
              <span class="field-hint">
                Agents will read and write files in this directory. Defaults to your global working directory, or the Claude config folder if unset.
              </span>
            </div>
          </div>
          <div class="flex justify-end gap-2 pt-3">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="onCancel" />
            <UButton type="submit" label="Start" icon="i-lucide-play" size="sm" :disabled="!prompt.trim()" />
          </div>
        </form>
      </div>
    </template>
  </UModal>
</template>
