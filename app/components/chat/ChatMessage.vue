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
      class="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-[13px] leading-relaxed"
      style="background: var(--accent-muted); border: 1px solid rgba(229, 169, 62, 0.1); color: var(--text-primary); font-family: var(--font-sans);"
    >
      {{ message.content }}
    </div>
  </div>

  <!-- Assistant message -->
  <div v-else class="flex gap-3 chat-msg-enter">
    <div class="shrink-0 pt-0.5">
      <div
        class="size-6 rounded-lg flex items-center justify-center transition-all duration-300"
        :style="{
          background: isStreaming ? 'var(--accent-muted)' : 'var(--badge-subtle-bg)',
          border: isStreaming ? '1px solid rgba(229, 169, 62, 0.15)' : '1px solid var(--border-subtle)',
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
        class="chat-prose text-[13px] leading-[1.7] break-words"
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

.chat-prose :deep(p) { margin: 0.4em 0; }
.chat-prose :deep(p:first-child) { margin-top: 0; }
.chat-prose :deep(p:last-child) { margin-bottom: 0; }
.chat-prose :deep(code) { font-family: var(--font-mono); font-size: 0.9em; background: var(--badge-subtle-bg); padding: 0.15em 0.4em; border-radius: 4px; }
.chat-prose :deep(pre) { background: var(--surface-base); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm, 8px); padding: 0.75em 1em; overflow-x: auto; margin: 0.6em 0; }
.chat-prose :deep(pre code) { background: none; padding: 0; font-size: 0.85em; }
.chat-prose :deep(ul), .chat-prose :deep(ol) { padding-left: 1.5em; margin: 0.4em 0; }
.chat-prose :deep(li) { margin: 0.2em 0; }
.chat-prose :deep(strong) { color: var(--text-primary); font-weight: 600; }
.chat-prose :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.chat-prose :deep(blockquote) { border-left: 2px solid var(--border-subtle); padding-left: 0.75em; margin: 0.4em 0; color: var(--text-secondary); }
.chat-prose :deep(hr) { border: none; border-top: 1px solid var(--border-subtle); margin: 0.8em 0; }
.chat-prose :deep(table) { width: 100%; border-collapse: collapse; font-size: 0.9em; margin: 0.6em 0; }
.chat-prose :deep(th), .chat-prose :deep(td) { border: 1px solid var(--border-subtle); padding: 0.35em 0.6em; text-align: left; }
.chat-prose :deep(th) { background: var(--surface-raised); font-weight: 600; font-size: 0.9em; }
.chat-prose :deep(tr:nth-child(even)) { background: var(--surface-raised); }

@keyframes chatMsgEnter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.chat-msg-enter { animation: chatMsgEnter 0.25s ease both; }
</style>
