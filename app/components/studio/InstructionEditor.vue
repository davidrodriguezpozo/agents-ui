<script setup lang="ts">
import { renderMarkdown } from '~/utils/markdown'
import { extractInstructionsBlock } from '~/composables/useImproveChat'
import { isSendKey } from '~/utils/keys'

const props = defineProps<{
  modelValue: string
  agentName: string
  agentDescription: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const mode = ref<'edit' | 'preview'>('edit')
const improve = useImproveChat()
const chatInput = ref('')
const chatInputRef = ref<HTMLTextAreaElement | null>(null)
const chatContainer = ref<HTMLElement | null>(null)

const wordCount = computed(() => {
  const text = props.modelValue.trim()
  return text ? text.split(/\s+/).length : 0
})

function openImproveChat() {
  improve.open()
  if (!improve.messages.value.length) {
    // Auto-send the initial message so Claude starts the conversation
    improve.sendMessage('Help me improve these instructions.', {
      name: props.agentName,
      description: props.agentDescription,
      currentInstructions: props.modelValue,
    })
  }
  nextTick(() => chatInputRef.value?.focus())
}

function closeImproveChat() {
  improve.close()
}

function resetImproveChat() {
  improve.reset()
  improve.close()
}

async function handleChatSend() {
  const text = chatInput.value.trim()
  if (!text) return
  chatInput.value = ''
  await improve.sendMessage(text, {
    name: props.agentName,
    description: props.agentDescription,
    currentInstructions: props.modelValue,
  })
}

function handleChatKeydown(e: KeyboardEvent) {
  if (isSendKey(e)) {
    e.preventDefault()
    handleChatSend()
  }
}

function applyInstructions(instructions: string) {
  emit('update:modelValue', instructions)
}

// Auto-scroll chat
watch(
  () => improve.messages.value[improve.messages.value.length - 1]?.content,
  () => {
    nextTick(() => {
      if (chatContainer.value) {
        chatContainer.value.scrollTop = chatContainer.value.scrollHeight
      }
    })
  },
)

function autoResizeChatInput() {
  const el = chatInputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 80)}px`
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center justify-between px-4 py-2 border-b" style="border-color: var(--border-subtle);">
      <div class="flex items-center gap-2">
        <div class="flex rounded-md overflow-hidden" style="border: 1px solid var(--border-subtle);">
          <button
            v-for="m in (['edit', 'preview'] as const)"
            :key="m"
            class="px-2.5 py-1 fs-mono font-medium capitalize transition-all"
            :style="{
              background: mode === m ? 'var(--accent-muted)' : 'transparent',
              color: mode === m ? 'var(--accent)' : 'var(--text-disabled)',
            }"
            @click="mode = m"
          >
            {{ m }}
          </button>
        </div>
        <span class="fs-mono font-mono ink-4">{{ wordCount }} words</span>
      </div>
      <button
        v-if="!improve.isOpen.value"
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-md fs-mono font-medium transition-all"
        :style="{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
        }"
        @click="openImproveChat"
      >
        <UIcon name="i-lucide-wand-2" class="size-3" />
        Improve with Claude
      </button>
      <button
        v-else
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-md fs-mono font-medium transition-all"
        :style="{
          background: 'var(--accent-muted)',
          border: '1px solid var(--accent-glow)',
          color: 'var(--accent)',
        }"
        @click="closeImproveChat"
      >
        <UIcon name="i-lucide-x" class="size-3" />
        Close chat
      </button>
    </div>

    <!-- Main content area: editor + optional chat panel -->
    <div class="flex-1 min-h-0 flex" :class="improve.isOpen.value ? 'flex-row' : 'flex-col'">
      <!-- Editor / Preview (takes full width when chat is closed, left half when open) -->
      <div class="flex-1 min-h-0 min-w-0 flex flex-col" :class="improve.isOpen.value ? 'border-r' : ''" :style="improve.isOpen.value ? 'border-color: var(--border-subtle);' : ''">
        <!-- Edit mode -->
        <textarea
          v-if="mode === 'edit'"
          :value="modelValue"
          class="flex-1 w-full resize-none bg-transparent fs-base leading-relaxed outline-none p-4"
          style="color: var(--text-primary); font-family: var(--font-mono);"
          placeholder="Write instructions for your agent..."
          @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        />

        <!-- Preview mode -->
        <div
          v-else
          class="flex-1 overflow-y-auto p-4 instruction-preview"
          style="color: var(--text-primary); font-family: var(--font-sans);"
        >
          <div
            v-if="modelValue.trim()"
            class="fs-base leading-[1.7]"
            v-html="renderMarkdown(modelValue)"
          />
          <p v-else class="fs-base ink-4">Nothing to preview yet.</p>
        </div>
      </div>

      <!-- Improve chat panel (right side, visible when open) -->
      <div
        v-if="improve.isOpen.value"
        class="flex flex-col"
        style="width: 340px; min-width: 280px; background: var(--surface-base);"
      >
        <!-- Chat header -->
        <div class="shrink-0 px-3 py-2 flex items-center justify-between border-b" style="border-color: var(--border-subtle);">
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-sparkles" class="size-3 ink-accent" />
            <span class="fs-mono font-medium ink">Improve</span>
            <span
              v-if="improve.isStreaming.value"
              class="fs-micro font-mono tracking-widest uppercase px-1.5 py-px rounded-full"
              style="background: var(--accent-muted); color: var(--accent);"
            >
              Thinking
            </span>
          </div>
          <button
            class="p-1 rounded-md hover-bg transition-all"
            style="color: var(--text-disabled);"
            title="Reset conversation"
            @click="resetImproveChat"
          >
            <UIcon name="i-lucide-rotate-ccw" class="size-3" />
          </button>
        </div>

        <!-- Chat messages -->
        <div ref="chatContainer" class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          <template v-for="msg in improve.messages.value" :key="msg.id">
            <!-- User message -->
            <div v-if="msg.role === 'user'" class="flex justify-end">
              <div
                class="max-w-[90%] rounded-xl rounded-br-md px-3 py-2 fs-sm leading-relaxed"
                style="background: var(--accent-muted); border: 1px solid var(--accent-muted); color: var(--text-primary);"
              >
                {{ msg.content }}
              </div>
            </div>

            <!-- Assistant message -->
            <div v-else class="space-y-2">
              <div
                class="rounded-xl rounded-bl-md px-3 py-2 fs-sm leading-relaxed improve-msg"
                :class="{ 'is-streaming': improve.isStreaming.value && msg.id === improve.messages.value[improve.messages.value.length - 1]?.id }"
                style="background: var(--surface-raised); border: 1px solid var(--border-subtle); color: var(--text-primary);"
              >
                <!-- Render the non-instructions parts as markdown, and instructions blocks as apply-able -->
                <template v-if="extractInstructionsBlock(msg.content)">
                  <div
                    class="improve-prose"
                    v-html="renderMarkdown(msg.content.replace(/```instructions\s*\n[\s\S]*?```/, '').trim())"
                  />
                  <div
                    class="mt-2 rounded-lg p-2.5 space-y-2"
                    style="background: var(--surface-base); border: 1px solid var(--accent-glow);"
                  >
                    <div class="flex items-center gap-1.5">
                      <UIcon name="i-lucide-file-text" class="size-3 ink-accent" />
                      <span class="fs-micro font-medium ink-accent">Proposed instructions</span>
                    </div>
                    <pre class="fs-mono leading-relaxed whitespace-pre-wrap max-h-[120px] overflow-y-auto" style="color: var(--text-secondary); font-family: var(--font-mono);">{{ extractInstructionsBlock(msg.content) }}</pre>
                    <button
                      class="w-full px-3 py-1.5 rounded-md fs-mono font-medium transition-all"
                      style="background: var(--accent); color: white;"
                      @click="applyInstructions(extractInstructionsBlock(msg.content)!)"
                    >
                      Apply to instructions
                    </button>
                  </div>
                </template>
                <div v-else class="improve-prose" v-html="renderMarkdown(msg.content || '...')" />
              </div>
            </div>
          </template>

          <!-- Error -->
          <div v-if="improve.error.value" class="fs-mono rounded-md px-3 py-2" style="background: var(--error-wash); color: var(--error);">
            {{ improve.error.value }}
          </div>
        </div>

        <!-- Chat input -->
        <div class="shrink-0 px-3 pb-3 pt-1">
          <div
            class="relative rounded-lg"
            :style="{
              background: 'var(--surface-raised)',
              border: improve.isStreaming.value
                ? '1px solid var(--accent-muted)'
                : '1px solid var(--border-subtle)',
            }"
          >
            <textarea
              ref="chatInputRef"
              v-model="chatInput"
              rows="1"
              class="w-full resize-none bg-transparent fs-sm outline-none px-3 pt-2.5 pb-8"
              style="color: var(--text-primary); font-family: var(--font-sans); max-height: 80px;"
              placeholder="Tell Claude what to change..."
              :disabled="improve.isStreaming.value"
              @keydown="handleChatKeydown"
              @input="autoResizeChatInput"
            />
            <div class="absolute bottom-2 right-2 flex items-center gap-1">
              <button
                v-if="improve.isStreaming.value"
                class="p-1 rounded-md transition-all"
                style="background: var(--error); color: white;"
                title="Stop"
                @click="improve.stop()"
              >
                <UIcon name="i-lucide-square" class="size-2.5" />
              </button>
              <button
                v-else
                class="p-1 rounded-md transition-all"
                :style="{
                  background: chatInput.trim() ? 'var(--accent)' : 'var(--badge-subtle-bg)',
                  color: chatInput.trim() ? 'white' : 'var(--text-disabled)',
                }"
                :disabled="!chatInput.trim()"
                @click="handleChatSend"
              >
                <UIcon name="i-lucide-arrow-up" class="size-2.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.instruction-preview :deep(h1) { font-size: 1.4em; font-weight: 700; margin: 0.8em 0 0.4em; color: var(--text-primary); font-family: var(--font-display); }
.instruction-preview :deep(h2) { font-size: 1.2em; font-weight: 600; margin: 0.7em 0 0.3em; color: var(--text-primary); font-family: var(--font-display); }
.instruction-preview :deep(h3) { font-size: 1.05em; font-weight: 600; margin: 0.6em 0 0.3em; color: var(--text-primary); }
.instruction-preview :deep(p) { margin: 0.5em 0; }
.instruction-preview :deep(ul), .instruction-preview :deep(ol) { padding-left: 1.5em; margin: 0.5em 0; }
.instruction-preview :deep(li) { margin: 0.25em 0; }
.instruction-preview :deep(code) { font-family: var(--font-mono); font-size: 0.9em; background: var(--badge-subtle-bg); padding: 0.15em 0.4em; border-radius: 4px; }
.instruction-preview :deep(pre) { background: var(--surface-base); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0.75em 1em; overflow-x: auto; margin: 0.6em 0; }
.instruction-preview :deep(pre code) { background: none; padding: 0; font-size: 0.85em; }
.instruction-preview :deep(strong) { color: var(--text-primary); font-weight: 600; }
.instruction-preview :deep(blockquote) { border-left: 2px solid var(--accent); padding-left: 0.75em; margin: 0.5em 0; color: var(--text-secondary); }
.instruction-preview :deep(hr) { border: none; border-top: 1px solid var(--border-subtle); margin: 1em 0; }
.instruction-preview :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.instruction-preview :deep(table) { width: 100%; border-collapse: collapse; font-size: 0.9em; margin: 0.6em 0; }
.instruction-preview :deep(th), .instruction-preview :deep(td) { border: 1px solid var(--border-subtle); padding: 0.4em 0.6em; text-align: left; }
.instruction-preview :deep(th) { background: var(--surface-raised); font-weight: 600; }

.improve-prose :deep(p) { margin: 0.3em 0; }
.improve-prose :deep(ul), .improve-prose :deep(ol) { padding-left: 1.2em; margin: 0.3em 0; }
.improve-prose :deep(li) { margin: 0.15em 0; }
.improve-prose :deep(code) { font-family: var(--font-mono); font-size: 0.85em; background: var(--badge-subtle-bg); padding: 0.1em 0.3em; border-radius: 3px; }
.improve-prose :deep(strong) { color: var(--text-primary); font-weight: 600; }

.is-streaming { position: relative; }
.is-streaming::after {
  content: ''; display: inline-block; width: 2px; height: 1em;
  background: var(--accent); margin-left: 2px; vertical-align: text-bottom;
  animation: cursorBlink 0.8s step-end infinite;
}
@keyframes cursorBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
</style>
