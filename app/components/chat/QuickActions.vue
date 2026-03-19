<script setup lang="ts">
defineProps<{
  actions: Array<{ label: string; icon: string; prompt: string }>
}>()

const emit = defineEmits<{
  select: [prompt: string]
}>()
</script>

<template>
  <div class="grid grid-cols-2 gap-2 w-full max-w-[320px]">
    <button
      v-for="action in actions"
      :key="action.label"
      class="chat-quick-action flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all duration-150"
      @click="emit('select', action.prompt)"
    >
      <UIcon :name="action.icon" class="size-3.5 shrink-0" style="color: var(--text-disabled);" />
      <span class="text-[11px] font-medium" style="font-family: var(--font-sans);">{{ action.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.chat-quick-action {
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}
.chat-quick-action:hover {
  border-color: var(--border-default);
  background: var(--surface-hover);
}
</style>
