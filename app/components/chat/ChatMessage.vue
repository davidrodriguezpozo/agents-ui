<script setup lang="ts">
import type { ChatMessage, StreamActivity } from '~/types'
import { renderMarkdown } from '~/utils/markdown'

defineProps<{
  message: ChatMessage
  isStreaming: boolean
  activity: StreamActivity
  statusText: string
}>()
</script>

<template>
  <!-- User message -->
  <div v-if="message.role === 'user'" class="flex justify-end chat-msg-enter">
    <div
      class="max-w-[80%] rounded-xl rounded-br-md px-4 py-2.5 text-[13px] leading-relaxed"
      style="background: var(--accent-muted); border: 1px solid var(--accent-muted); color: var(--text-primary); font-family: var(--font-sans);"
    >
      {{ message.content }}
    </div>
  </div>

  <!-- Assistant message -->
  <div v-else class="flex gap-3 chat-msg-enter">
    <div class="shrink-0 pt-0.5">
      <div
        class="size-6 rounded-md flex items-center justify-center transition-all duration-300"
        :style="{
          background: isStreaming ? 'var(--accent-muted)' : 'var(--badge-subtle-bg)',
          border: isStreaming ? '1px solid var(--accent-muted)' : '1px solid var(--border-subtle)',
        }"
      >
        <UIcon
          name="i-lucide-zap"
          class="size-3 transition-colors duration-300"
          :style="{ color: isStreaming ? 'var(--accent)' : 'var(--text-disabled)' }"
        />
      </div>
    </div>

    <div class="flex-1 min-w-0 space-y-2">
      <!-- Thinking block (collapsible) -->
      <details
        v-if="message.thinking"
        class="chat-thinking"
        :open="isStreaming && !message.content"
      >
        <summary class="flex items-center gap-1.5 cursor-pointer select-none py-0.5">
          <UIcon
            name="i-lucide-brain"
            class="size-3 shrink-0"
            :class="{ 'chat-thinking-pulse': isStreaming && activity?.type === 'thinking' }"
            style="color: var(--text-disabled);"
          />
          <span class="text-[11px] font-mono" style="color: var(--text-disabled);">
            {{ isStreaming && activity?.type === 'thinking' ? 'Thinking...' : 'Thought process' }}
          </span>
        </summary>
        <div
          class="mt-1 text-[11px] leading-[1.6] whitespace-pre-wrap break-words pl-5"
          style="color: var(--text-tertiary); font-family: var(--font-mono); max-height: 200px; overflow-y: auto;"
        >{{ message.thinking }}</div>
      </details>

      <!-- Tool activity indicator -->
      <StreamIndicator
        v-if="isStreaming && !message.content && activity?.type === 'tool'"
        :status-text="statusText"
      />

      <!-- Initial streaming state (no tool, no thinking yet) -->
      <StreamIndicator
        v-if="!message.content && !message.thinking && isStreaming && activity?.type !== 'tool'"
        :status-text="statusText"
      />

      <!-- Rendered content -->
      <div
        v-if="message.content"
        class="markdown text-[13px] break-words"
        :class="{ 'is-streaming': isStreaming }"
        style="color: var(--text-primary); font-family: var(--font-sans);"
        v-html="renderMarkdown(message.content)"
      />
    </div>
  </div>
</template>

<style scoped>
.chat-thinking summary { list-style: none; }
.chat-thinking summary::-webkit-details-marker { display: none; }
.chat-thinking summary::before {
  content: '▸'; font-size: 9px; color: var(--text-disabled);
  margin-right: 2px; transition: transform 0.15s ease; display: inline-block;
}
.chat-thinking[open] summary::before { transform: rotate(90deg); }

@keyframes thinkingPulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
.chat-thinking-pulse { animation: thinkingPulse 1.5s ease-in-out infinite; }

.is-streaming { position: relative; }
.is-streaming::after {
  content: ''; display: inline-block; width: 2px; height: 1em;
  background: var(--accent); margin-left: 2px; vertical-align: text-bottom;
  animation: cursorBlink 0.8s step-end infinite;
}
@keyframes cursorBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }


@keyframes chatMsgEnter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.chat-msg-enter { animation: chatMsgEnter 0.25s ease both; }
</style>
