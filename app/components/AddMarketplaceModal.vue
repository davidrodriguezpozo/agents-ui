<script setup lang="ts">
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
    error.value = e.data?.data?.message || e.data?.message || e.message || 'Failed to add marketplace'
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <div class="p-6 space-y-4 bg-overlay">
    <h3 class="text-page-title">Add Marketplace</h3>
    <p class="text-[12px] text-label leading-relaxed">
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
      class="rounded-lg px-3 py-2 text-[12px]"
      style="background: rgba(248, 113, 113, 0.06); color: var(--error); border: 1px solid rgba(248, 113, 113, 0.12);"
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
