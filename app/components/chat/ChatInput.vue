<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  placeholder: string
  disabled: boolean
  isStreaming: boolean
  projectDisplayPath: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  send: []
  stop: []
}>()

const inputRef = ref<HTMLTextAreaElement | null>(null)

function autoResize() {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    emit('send')
  }
}

function focus() {
  inputRef.value?.focus()
}

function resetHeight() {
  if (inputRef.value) inputRef.value.style.height = 'auto'
}

defineExpose({ focus, resetHeight })
</script>

<template>
  <div class="shrink-0 px-5 pb-5 pt-2">
    <div
      class="relative rounded-2xl transition-all duration-200"
      :style="{
        background: 'var(--surface-raised)',
        border: isStreaming ? '1px solid rgba(229, 169, 62, 0.15)' : '1px solid var(--border-subtle)',
        boxShadow: isStreaming ? '0 0 20px var(--accent-glow), 0 2px 8px var(--card-shadow)' : '0 2px 8px var(--card-shadow)',
      }"
    >
      <textarea
        ref="inputRef"
        :value="modelValue"
        rows="1"
        class="w-full resize-none bg-transparent text-[13px] outline-none px-4 pt-3 pb-10"
        style="color: var(--text-primary); font-family: var(--font-sans); max-height: 120px;"
        :placeholder="placeholder"
        :disabled="disabled"
        @keydown="handleKeydown"
        @input="(e) => { emit('update:modelValue', (e.target as HTMLTextAreaElement).value); autoResize() }"
      />

      <div class="absolute bottom-2.5 left-3 right-3 flex items-center justify-between">
        <span class="text-[10px] font-mono flex items-center gap-1.5" style="color: var(--text-disabled);">
          <template v-if="projectDisplayPath">
            <UIcon name="i-lucide-folder" class="size-3" style="color: var(--accent);" />
            <span class="truncate max-w-[120px]">{{ projectDisplayPath }}</span>
            <span>&middot;</span>
          </template>
          &#x23CE; Send &middot; &#x21E7;&#x23CE; New line
        </span>

        <div class="flex items-center gap-1.5">
          <button
            v-if="isStreaming"
            class="p-1.5 rounded-lg transition-all"
            style="background: var(--error); color: white;"
            title="Stop"
            @click="emit('stop')"
          >
            <UIcon name="i-lucide-square" class="size-3" />
          </button>
          <button
            v-else
            class="p-1.5 rounded-lg transition-all duration-200"
            :style="{
              background: modelValue.trim() ? 'var(--accent)' : 'var(--badge-subtle-bg)',
              color: modelValue.trim() ? 'white' : 'var(--text-disabled)',
              boxShadow: modelValue.trim() ? '0 0 12px var(--accent-glow)' : 'none',
            }"
            :disabled="!modelValue.trim()"
            @click="emit('send')"
          >
            <UIcon name="i-lucide-arrow-up" class="size-3" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
