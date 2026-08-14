<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
const emit = defineEmits<{
  added: []
}>()

const { addSource } = useMarketplace()
const toast = useToast()

const url = ref('')
const adding = ref(false)
const error = ref('')

async function doAdd() {
  if (!url.value.trim()) return
  adding.value = true
  error.value = ''
  try {
    await addSource(url.value.trim())
    toast.add({ title: 'Marketplace added', color: 'success' })
    url.value = ''
    emit('added')
  } catch (e: any) {
    error.value = errorMessage(e, 'Failed to add marketplace')
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <div class="p-6 space-y-4 bg-overlay modal-panel">
    <h3 class="text-page-title">Add Marketplace</h3>
    <p class="type-detail leading-relaxed">
      Add a marketplace source to discover and install plugins. Provide a GitHub URL or local directory path.
    </p>

    <div class="field-group">
      <label class="field-label">Source URL</label>
      <input
        v-model="url"
        class="field-input"
        placeholder="https://github.com/owner/marketplace-repo"
        @keydown.enter="doAdd"
      />
      <span class="field-hint">GitHub repo URL, git URL, or local directory path</span>
    </div>

    <div
      v-if="error"
      class="rounded-md px-3 py-2 fs-sm"
      style="background: var(--error-wash); color: var(--error); border: 1px solid var(--error-tint);"
    >
      {{ error }}
    </div>

    <div class="flex justify-end gap-2">
      <UButton
        label="Add"
        icon="i-lucide-plus"
        size="sm"
        :loading="adding"
        :disabled="!url.trim()"
        @click="doAdd"
      />
    </div>
  </div>
</template>
