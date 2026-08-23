<script setup lang="ts">
import type { ChatMessage, StreamActivity } from '~/types'
import { renderMarkdown } from '~/utils/markdown'
import { attachmentSrc } from '~/utils/imageAttachments'

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
      class="max-w-[80%] rounded-xl rounded-br-md px-4 py-2.5 fs-base leading-relaxed space-y-2"
      style="background: var(--accent-muted); border: 1px solid var(--accent-muted); color: var(--text-primary); font-family: var(--font-sans);"
    >
      <!--
        The images this turn carried. A conversation read back from history has
        their names but not their bytes — see `ChatAttachment.data` — so it
        names them instead of showing a broken thumbnail.
      -->
      <div v-if="message.attachments?.length" class="flex flex-wrap gap-2">
        <template v-for="attachment in message.attachments" :key="attachment.id">
          <img
            v-if="attachmentSrc(attachment)"
            :src="attachmentSrc(attachment)!"
            :alt="attachment.name"
            :title="attachment.name"
            class="rounded-lg max-h-40 max-w-full object-contain"
            style="border: 1px solid var(--border-subtle);"
          >
          <span
            v-else
            class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 fs-micro font-mono"
            style="background: var(--badge-subtle-bg); color: var(--text-tertiary);"
          >
            <UIcon name="i-lucide-image" class="size-3" />
            {{ attachment.name }}
          </span>
        </template>
      </div>

      <div v-if="message.content">{{ message.content }}</div>
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
          <span class="fs-mono font-mono ink-4">
            {{ isStreaming && activity?.type === 'thinking' ? 'Thinking...' : 'Thought process' }}
          </span>
        </summary>
        <div
          class="mt-1 fs-mono leading-[1.6] whitespace-pre-wrap break-words pl-5"
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
        class="markdown fs-base break-words"
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
