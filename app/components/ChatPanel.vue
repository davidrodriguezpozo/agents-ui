<script setup lang="ts">
import type { ChatMessage } from '~/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { messages, isStreaming, error, activity, usedTools, sendMessage, stopStreaming, clearChat, activeAgent, pendingInput, clearAgent } = useChat()
const { displayPath: projectDisplayPath } = useWorkingDir()
const { fetchAll: fetchAgents } = useAgents()
const { fetchAll: fetchCommands } = useCommands()
const { fetchAll: fetchSkills } = useSkills()
const { fetchAll: fetchPlugins } = usePlugins()

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

watch(() => props.open, (val) => {
  if (val) nextTick(() => inputRef.value?.focus())
})

watch(pendingInput, (val) => {
  if (val) {
    input.value = val
    pendingInput.value = ''
    nextTick(() => inputRef.value?.focus())
  }
})

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('update:open', false)
}
onMounted(() => document.addEventListener('keydown', handleEscape))
onUnmounted(() => document.removeEventListener('keydown', handleEscape))

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  })
}
watch(() => messages.value.length, scrollToBottom)
watch(() => messages.value[messages.value.length - 1]?.content, scrollToBottom)

async function handleSend() {
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  inputRef.value?.resetHeight()
  await sendMessage(text)
  if (usedTools.value) {
    await Promise.all([fetchAgents(), fetchCommands(), fetchSkills(), fetchPlugins()])
  }
}

const TOOL_LABELS: Record<string, string> = {
  Read: 'Reading file', Write: 'Writing file', Edit: 'Editing file',
  Glob: 'Searching files', Grep: 'Searching code', Bash: 'Running command',
}

const statusText = computed(() => {
  if (!isStreaming.value) return messages.value.length ? 'Ready' : 'Online'
  const a = activity.value
  if (!a) return 'Starting' + '.'.repeat(streamingDots.value)
  if (a.type === 'thinking') return 'Thinking' + '.'.repeat(streamingDots.value)
  if (a.type === 'tool') return (TOOL_LABELS[a.name] || a.name) + '.'.repeat(streamingDots.value)
  if (a.type === 'writing') return 'Responding' + '.'.repeat(streamingDots.value)
  return 'Executing' + '.'.repeat(streamingDots.value)
})

function isLastAssistantStreaming(idx: number): boolean {
  return isStreaming.value && idx === messages.value.length - 1
}

const quickActions = [
  { label: 'Build me an assistant', icon: 'i-lucide-wand-2', prompt: 'I want to create a new agent. Help me figure out what it should do. Ask me a few questions about what I need help with, then create the agent for me.' },
  { label: 'What can I do here?', icon: 'i-lucide-help-circle', prompt: 'Explain what agents, commands, and skills are and how I can use them to be more productive. Keep it simple and give me practical examples.' },
  { label: 'Review my setup', icon: 'i-lucide-scan', prompt: 'Look at my current Claude Code setup — my agents, commands, and skills — and suggest improvements or things I might be missing.' },
  { label: 'Create a command', icon: 'i-lucide-terminal', prompt: 'Help me create a new slash command. Ask me what workflow I want to automate, then create it for me.' },
]

function handleQuickAction(prompt: string) {
  input.value = prompt
  nextTick(() => inputRef.value?.focus())
}
</script>

<template>
  <!-- Backdrop -->
  <Transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 z-40"
      style="background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(4px);"
      @click="emit('update:open', false)"
    />
  </Transition>

  <!-- Panel -->
  <Transition name="slide">
    <div
      v-if="open"
      class="chat-panel fixed right-0 top-0 bottom-0 z-50 w-full md:w-[640px] flex flex-col overflow-hidden"
      style="background: var(--surface-raised); border-left: 1px solid var(--border-subtle);"
    >
      <!-- Edge glow line -->
      <div class="absolute left-0 top-0 bottom-0 w-px" style="background: var(--border-subtle);">
        <div v-if="isStreaming" class="absolute top-0 left-0 w-full chat-edge-pulse" style="background: linear-gradient(180deg, transparent 0%, var(--accent) 50%, transparent 100%); height: 120px;" />
      </div>

      <!-- Header -->
      <div class="relative shrink-0 px-5 pt-4 pb-3">
        <div v-if="isStreaming" class="absolute top-0 right-1/4 w-40 h-20 pointer-events-none chat-glow-pulse" style="background: radial-gradient(ellipse, var(--accent-glow) 0%, transparent 70%);" />
        <div class="flex items-center gap-3 relative">
          <div class="relative">
            <div class="size-9 rounded-xl flex items-center justify-center transition-all duration-300" :style="{ background: isStreaming ? 'var(--accent-muted)' : 'var(--badge-subtle-bg)', border: isStreaming ? '1px solid rgba(229, 169, 62, 0.2)' : '1px solid var(--border-subtle)', boxShadow: isStreaming ? '0 0 20px var(--accent-glow)' : 'none' }">
              <UIcon name="i-lucide-zap" class="size-4 transition-colors duration-300" :style="{ color: isStreaming ? 'var(--accent)' : 'var(--text-tertiary)' }" />
            </div>
            <div class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 transition-colors duration-300" :style="{ background: isStreaming ? 'var(--accent)' : 'var(--success)', borderColor: 'var(--surface-base)', boxShadow: isStreaming ? '0 0 8px var(--accent-glow)' : '0 0 6px rgba(5, 150, 105, 0.3)' }" :class="{ 'chat-dot-pulse': isStreaming }" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-[14px] font-semibold tracking-tight" style="color: var(--text-primary); font-family: var(--font-display);">Claude</span>
              <span class="text-[9px] font-mono tracking-widest uppercase px-1.5 py-px rounded-full transition-all duration-300" :style="{ background: isStreaming ? 'var(--accent-muted)' : 'var(--badge-subtle-bg)', color: isStreaming ? 'var(--accent)' : 'var(--text-disabled)' }">{{ statusText }}</span>
            </div>
            <span class="text-[10px] font-mono" style="color: var(--text-disabled);">{{ activeAgent ? activeAgent.name : 'Agent Manager' }}</span>
          </div>
          <button v-if="messages.length" class="p-1.5 rounded-lg transition-all hover-bg" style="color: var(--text-disabled);" title="New conversation" @click="() => { clearChat(); clearAgent() }">
            <UIcon name="i-lucide-rotate-ccw" class="size-3.5" />
          </button>
          <button class="p-1.5 rounded-lg transition-all hover-bg" style="color: var(--text-tertiary);" @click="emit('update:open', false)">
            <UIcon name="i-lucide-panel-right-close" class="size-4" />
          </button>
        </div>
        <div class="mt-3 h-px" style="background: var(--border-subtle);">
          <div v-if="isStreaming" class="h-full chat-line-sweep" style="background: linear-gradient(90deg, transparent, var(--accent), transparent); width: 40%;" />
        </div>
      </div>

      <!-- Active agent banner -->
      <div v-if="activeAgent" class="shrink-0 px-5 py-2 flex items-center gap-2.5" style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);">
        <div class="size-2 rounded-full shrink-0" :style="{ background: activeAgent.color || 'var(--accent)' }" />
        <span class="text-[12px] font-medium flex-1 truncate" style="color: var(--text-primary); font-family: var(--font-sans);">Chatting with <strong>{{ activeAgent.name }}</strong></span>
        <button class="p-1 rounded-md hover-bg transition-all" style="color: var(--text-disabled);" title="Switch to generic Claude" @click="clearAgent">
          <UIcon name="i-lucide-x" class="size-3" />
        </button>
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <div v-if="!messages.length" class="flex flex-col items-center justify-center h-full gap-6">
          <FeatureCallout feature-key="chat" message="You can ask Claude anything — create agents, get help, or manage your workspace." action="Try asking 'Help me create an agent for writing emails'." />
          <div class="relative">
            <div class="size-16 rounded-2xl flex items-center justify-center" style="background: linear-gradient(135deg, var(--accent-muted) 0%, transparent 100%); border: 1px solid rgba(229, 169, 62, 0.08);">
              <UIcon name="i-lucide-zap" class="size-7" style="color: var(--accent); opacity: 0.8;" />
            </div>
          </div>
          <div class="text-center space-y-2">
            <p class="text-[18px] font-semibold tracking-tight" style="color: var(--text-primary); font-family: var(--font-display);">How can I help?</p>
            <p class="text-[12px] max-w-[280px] leading-relaxed" style="color: var(--text-tertiary);">Describe what you need in plain English. I'll create the right agents, commands, or skills for you.</p>
          </div>
          <QuickActions :actions="quickActions" @select="handleQuickAction" />
          <p class="text-[10px] font-mono leading-relaxed" style="color: var(--text-disabled);">Has read/write access to your .claude directory</p>
        </div>

        <template v-for="(msg, idx) in messages" :key="msg.id">
          <ChatMessage
            :message="(msg as ChatMessage)"
            :is-streaming="isLastAssistantStreaming(idx)"
            :activity="activity"
            :status-text="statusText"
          />
        </template>

        <div v-if="error" class="flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[12px]" style="background: rgba(248, 113, 113, 0.06); border: 1px solid rgba(248, 113, 113, 0.12); color: var(--error);">
          <UIcon name="i-lucide-alert-circle" class="size-3.5 shrink-0 mt-0.5" />
          <span>{{ error }}</span>
        </div>
      </div>

      <!-- Input -->
      <ChatInput
        ref="inputRef"
        v-model="input"
        :placeholder="activeAgent ? `Ask ${activeAgent.name} something...` : 'Tell Claude what to do...'"
        :disabled="isStreaming"
        :is-streaming="isStreaming"
        :project-display-path="projectDisplayPath"
        @send="handleSend"
        @stop="stopStreaming"
      />
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active { transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease; }
.slide-leave-active { transition: transform 0.2s cubic-bezier(0.4, 0, 1, 1), opacity 0.15s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); opacity: 0.8; }

@keyframes edgePulse {
  0%, 100% { top: -120px; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { top: calc(100% + 120px); opacity: 0; }
}
.chat-edge-pulse { animation: edgePulse 2s ease-in-out infinite; }

@keyframes glowPulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
.chat-glow-pulse { animation: glowPulse 2s ease-in-out infinite; }

@keyframes lineSweep { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
.chat-line-sweep { animation: lineSweep 1.5s ease-in-out infinite; }

@keyframes dotPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.4); } }
.chat-dot-pulse { animation: dotPulse 1.2s ease-in-out infinite; }
</style>
