<script setup lang="ts">
import type { ChatMessage, PermissionRequest } from '~/types'

const props = defineProps<{
  agentSlug: string
  agentName: string
  isDraft: boolean
}>()

const { messages, isStreaming, error, activity, toolCalls, sendMessage, stopStreaming, clearChat, pendingPermissions, isAnsweringPermission, answerPermission } = useStudioChat()
const { workingDir, displayPath: projectDisplayPath } = useWorkingDir()
const { attachments, dropZone, dragOver, attach, remove: removeAttachment, clear: clearAttachments, take: takeAttachments, onDragOver, onDragLeave, onDrop } = useChatAttachments()

const input = ref('')
const inputRef = ref<{ focus: () => void; resetHeight: () => void } | null>(null)
const messagesContainer = ref<HTMLElement | null>(null)
const streamingDots = ref(0)

let dotsInterval: ReturnType<typeof setInterval> | null = null
watch(isStreaming, (val) => {
  if (val) {
    dotsInterval = setInterval(() => { streamingDots.value = (streamingDots.value + 1) % 4 }, 400)
  } else {
    if (dotsInterval) clearInterval(dotsInterval)
    streamingDots.value = 0
  }
})
onUnmounted(() => { if (dotsInterval) clearInterval(dotsInterval) })

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  })
}
watch(() => messages.value.length, scrollToBottom)
watch(() => messages.value[messages.value.length - 1]?.content, scrollToBottom)

const TOOL_LABELS: Record<string, string> = {
  Read: 'Reading file', Write: 'Writing file', Edit: 'Editing file',
  Glob: 'Searching files', Grep: 'Searching code', Bash: 'Running command',
}

const statusText = computed(() => {
  if (pendingPermissions.value.length) return 'Needs your OK'
  if (!isStreaming.value) return messages.value.length ? 'Ready' : 'Online'
  const a = activity.value
  if (!a) return 'Starting' + '.'.repeat(streamingDots.value)
  if (a.type === 'permission') return 'Needs your OK'
  if (a.type === 'thinking') return 'Thinking' + '.'.repeat(streamingDots.value)
  if (a.type === 'tool') return (TOOL_LABELS[a.name] || a.name) + '.'.repeat(streamingDots.value)
  if (a.type === 'writing') return 'Responding' + '.'.repeat(streamingDots.value)
  return 'Executing' + '.'.repeat(streamingDots.value)
})

function isLastAssistantStreaming(idx: number): boolean {
  return isStreaming.value && idx === messages.value.length - 1
}

async function handleSend() {
  const text = input.value.trim()
  if (!text && !attachments.value.length) return
  input.value = ''
  const images = takeAttachments()
  inputRef.value?.resetHeight()
  await sendMessage(text, {
    agentSlug: props.agentSlug,
    projectDir: workingDir.value || undefined,
    attachments: images,
  })
}
</script>

<template>
  <div
    ref="dropZone"
    class="relative flex flex-col h-full"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Dropped anywhere in the panel, not only on the composer: a file dropped
         on the rest of the page is the browser navigating away from the app. -->
    <div
      v-if="dragOver"
      class="absolute inset-3 z-30 pointer-events-none rounded-xl flex items-center justify-center fs-sm font-medium"
      style="background: var(--accent-muted); border: 2px dashed var(--accent); color: var(--text-primary);"
    >
      Drop an image to attach it
    </div>
    <div class="shrink-0 px-4 py-2.5 flex items-center justify-between border-b" style="border-color: var(--border-subtle);">
      <div class="flex items-center gap-2">
        <span class="fs-sm font-medium ink">Test</span>
        <span v-if="isDraft" class="fs-micro font-mono px-1.5 py-px rounded-full" style="background: var(--accent-muted); color: var(--accent);">Draft</span>
        <span class="fs-micro font-mono tracking-widest uppercase px-1.5 py-px rounded-full transition-all" :style="{ background: isStreaming ? 'var(--accent-muted)' : 'var(--badge-subtle-bg)', color: isStreaming ? 'var(--accent)' : 'var(--text-disabled)' }">{{ statusText }}</span>
      </div>
      <button v-if="messages.length" class="p-1 rounded-md hover-bg transition-all ink-4" title="New conversation" @click="() => { clearChat(); clearAttachments() }">
        <UIcon name="i-lucide-rotate-ccw" class="size-3" />
      </button>
    </div>

    <RunSettings />
    <ConversationHistory :agent-slug="agentSlug" />

    <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      <div v-if="!messages.length" class="flex flex-col items-center justify-center h-full gap-3">
        <UIcon name="i-lucide-message-square" class="size-8" style="color: var(--text-disabled); opacity: 0.5;" />
        <p class="fs-sm text-center max-w-[200px] ink-3">Test your agent here. Changes to instructions are reflected immediately.</p>
      </div>

      <template v-for="(msg, idx) in messages" :key="msg.id">
        <ChatMessage :message="(msg as ChatMessage)" :is-streaming="isLastAssistantStreaming(idx)" :activity="activity" :status-text="statusText" />
      </template>

      <div v-if="error" class="fs-mono rounded-md px-3 py-2" style="background: var(--error-wash); color: var(--error);">{{ error }}</div>
    </div>

    <!-- Blocked on you: the agent cannot move until these are answered -->
    <div v-if="pendingPermissions.length" class="shrink-0 px-5 pb-1 pt-2 space-y-2">
      <PermissionPrompt
        v-for="request in pendingPermissions"
        :key="request.id"
        :request="(request as PermissionRequest)"
        :busy="isAnsweringPermission(request.id)"
        @answer="answerPermission(request.id, $event)"
      />
    </div>

    <ChatInput ref="inputRef" v-model="input" :placeholder="`Ask ${agentName} something...`" :disabled="isStreaming" :is-streaming="isStreaming" :project-display-path="projectDisplayPath" :attachments="attachments" @send="handleSend" @stop="stopStreaming" @attach="attach" @remove="removeAttachment" />
  </div>
</template>
