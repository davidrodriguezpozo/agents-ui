<script setup lang="ts">
import { renderMarkdown } from '~/utils/markdown'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { messages, isStreaming, error, activity, usedTools, sendMessage, stopStreaming, clearChat, activeAgent, pendingInput, clearAgent } = useChat()
const { displayPath: projectDisplayPath } = useWorkingDir()
const { fetchAll: fetchAgents } = useAgents()
const { fetchAll: fetchCommands } = useCommands()
const { fetchAll: fetchSkills } = useSkills()
const { fetchAll: fetchPlugins } = usePlugins()

const input = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const messagesContainer = ref<HTMLElement | null>(null)
const streamingDots = ref(0)

// Animated dots for streaming state
let dotsInterval: ReturnType<typeof setInterval> | null = null
watch(isStreaming, (val) => {
  if (val) {
    dotsInterval = setInterval(() => { streamingDots.value = (streamingDots.value + 1) % 4 }, 400)
  } else {
    if (dotsInterval) clearInterval(dotsInterval)
    streamingDots.value = 0
  }
})

onUnmounted(() => {
  if (dotsInterval) clearInterval(dotsInterval)
})

// Focus input when panel opens
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

// Escape to dismiss
function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) {
    emit('update:open', false)
  }
}
onMounted(() => document.addEventListener('keydown', handleEscape))
onUnmounted(() => document.removeEventListener('keydown', handleEscape))

// Auto-scroll
function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}
watch(() => messages.value.length, scrollToBottom)
watch(() => messages.value[messages.value.length - 1]?.content, scrollToBottom)

// Textarea auto-resize
function autoResize() {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
}

async function handleSend() {
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  if (inputRef.value) inputRef.value.style.height = 'auto'
  await sendMessage(text)
  if (usedTools.value) {
    await Promise.all([fetchAgents(), fetchCommands(), fetchSkills(), fetchPlugins()])
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

const quickActions = [
  { label: 'Build me an assistant', icon: 'i-lucide-wand-2', prompt: 'I want to create a new agent. Help me figure out what it should do. Ask me a few questions about what I need help with, then create the agent for me.' },
  { label: 'What can I do here?', icon: 'i-lucide-help-circle', prompt: 'Explain what agents, commands, and skills are and how I can use them to be more productive. Keep it simple and give me practical examples.' },
  { label: 'Review my setup', icon: 'i-lucide-scan', prompt: 'Look at my current Claude Code setup — my agents, commands, and skills — and suggest improvements or things I might be missing.' },
  { label: 'Create a command', icon: 'i-lucide-terminal', prompt: 'Help me create a new slash command. Ask me what workflow I want to automate, then create it for me.' },
]

function useQuickAction(prompt: string) {
  input.value = prompt
  nextTick(() => inputRef.value?.focus())
}

const TOOL_LABELS: Record<string, string> = {
  Read: 'Reading file',
  Write: 'Writing file',
  Edit: 'Editing file',
  Glob: 'Searching files',
  Grep: 'Searching code',
  Bash: 'Running command',
}

const statusText = computed(() => {
  if (!isStreaming.value) {
    return messages.value.length ? 'Ready' : 'Online'
  }
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
        <div
          v-if="isStreaming"
          class="absolute top-0 left-0 w-full chat-edge-pulse"
          style="background: linear-gradient(180deg, transparent 0%, var(--accent) 50%, transparent 100%); height: 120px;"
        />
      </div>

      <!-- Header -->
      <div class="relative shrink-0 px-5 pt-4 pb-3">
        <!-- Ambient glow behind status -->
        <div
          v-if="isStreaming"
          class="absolute top-0 right-1/4 w-40 h-20 pointer-events-none chat-glow-pulse"
          style="background: radial-gradient(ellipse, var(--accent-glow) 0%, transparent 70%);"
        />

        <div class="flex items-center gap-3 relative">
          <!-- Status orb -->
          <div class="relative">
            <div
              class="size-9 rounded-xl flex items-center justify-center transition-all duration-300"
              :style="{
                background: isStreaming ? 'var(--accent-muted)' : 'var(--badge-subtle-bg)',
                border: isStreaming ? '1px solid rgba(229, 169, 62, 0.2)' : '1px solid var(--border-subtle)',
                boxShadow: isStreaming ? '0 0 20px var(--accent-glow)' : 'none',
              }"
            >
              <UIcon name="i-lucide-zap" class="size-4 transition-colors duration-300" :style="{ color: isStreaming ? 'var(--accent)' : 'var(--text-tertiary)' }" />
            </div>
            <!-- Live indicator dot -->
            <div
              class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 transition-colors duration-300"
              :style="{
                background: isStreaming ? 'var(--accent)' : 'var(--success)',
                borderColor: 'var(--surface-base)',
                boxShadow: isStreaming ? '0 0 8px var(--accent-glow)' : '0 0 6px rgba(5, 150, 105, 0.3)',
              }"
              :class="{ 'chat-dot-pulse': isStreaming }"
            />
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-[14px] font-semibold tracking-tight" style="color: var(--text-primary); font-family: var(--font-display);">
                Claude
              </span>
              <span
                class="text-[9px] font-mono tracking-widest uppercase px-1.5 py-px rounded-full transition-all duration-300"
                :style="{
                  background: isStreaming ? 'var(--accent-muted)' : 'var(--badge-subtle-bg)',
                  color: isStreaming ? 'var(--accent)' : 'var(--text-disabled)',
                }"
              >
                {{ statusText }}
              </span>
            </div>
            <span class="text-[10px] font-mono" style="color: var(--text-disabled);">
              {{ activeAgent ? activeAgent.name : 'Agent Manager' }}
            </span>
          </div>

          <button
            v-if="messages.length"
            class="p-1.5 rounded-lg transition-all hover-bg"
            style="color: var(--text-disabled);"
            title="New conversation"
            @click="() => { clearChat(); clearAgent() }"
          >
            <UIcon name="i-lucide-rotate-ccw" class="size-3.5" />
          </button>
          <button
            class="p-1.5 rounded-lg transition-all hover-bg"
            style="color: var(--text-tertiary);"
            @click="emit('update:open', false)"
          >
            <UIcon name="i-lucide-panel-right-close" class="size-4" />
          </button>
        </div>

        <!-- Separator with glow -->
        <div class="mt-3 h-px" style="background: var(--border-subtle);">
          <div
            v-if="isStreaming"
            class="h-full chat-line-sweep"
            style="background: linear-gradient(90deg, transparent, var(--accent), transparent); width: 40%;"
          />
        </div>
      </div>

      <!-- Active agent banner -->
      <div
        v-if="activeAgent"
        class="shrink-0 px-5 py-2 flex items-center gap-2.5"
        style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);"
      >
        <div
          class="size-2 rounded-full shrink-0"
          :style="{ background: activeAgent.color || 'var(--accent)' }"
        />
        <span class="text-[12px] font-medium flex-1 truncate" style="color: var(--text-primary); font-family: var(--font-sans);">
          Chatting with <strong>{{ activeAgent.name }}</strong>
        </span>
        <button
          class="p-1 rounded-md hover-bg transition-all"
          style="color: var(--text-disabled);"
          title="Switch to generic Claude"
          @click="clearAgent"
        >
          <UIcon name="i-lucide-x" class="size-3" />
        </button>
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <!-- Empty state -->
        <div v-if="!messages.length" class="flex flex-col items-center justify-center h-full gap-6">
          <FeatureCallout
            feature-key="chat"
            message="You can ask Claude anything — create agents, get help, or manage your workspace."
            action="Try asking 'Help me create an agent for writing emails'."
          />

          <!-- Orb -->
          <div class="relative">
            <div
              class="size-16 rounded-2xl flex items-center justify-center"
              style="background: linear-gradient(135deg, var(--accent-muted) 0%, transparent 100%); border: 1px solid rgba(229, 169, 62, 0.08);"
            >
              <UIcon name="i-lucide-zap" class="size-7" style="color: var(--accent); opacity: 0.8;" />
            </div>
            <div class="absolute inset-0 rounded-2xl" style="background: radial-gradient(circle at 30% 30%, rgba(229, 169, 62, 0.06) 0%, transparent 60%);" />
          </div>

          <div class="text-center space-y-2">
            <p class="text-[18px] font-semibold tracking-tight" style="color: var(--text-primary); font-family: var(--font-display);">
              How can I help?
            </p>
            <p class="text-[12px] max-w-[280px] leading-relaxed" style="color: var(--text-tertiary);">
              Describe what you need in plain English. I'll create the right agents, commands, or skills for you.
            </p>
          </div>

          <!-- Quick actions grid -->
          <div class="grid grid-cols-2 gap-2 w-full max-w-[320px]">
            <button
              v-for="action in quickActions"
              :key="action.label"
              class="chat-quick-action flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all duration-150"
              @click="useQuickAction(action.prompt)"
            >
              <UIcon :name="action.icon" class="size-3.5 shrink-0" style="color: var(--text-disabled);" />
              <span class="text-[11px] font-medium" style="font-family: var(--font-sans);">{{ action.label }}</span>
            </button>
          </div>

          <p class="text-[10px] font-mono leading-relaxed" style="color: var(--text-disabled);">
            Has read/write access to your .claude directory
          </p>
        </div>

        <!-- Message bubbles -->
        <template v-for="(msg, idx) in messages" :key="msg.id">
          <!-- User message -->
          <div v-if="msg.role === 'user'" class="flex justify-end chat-msg-enter">
            <div
              class="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-[13px] leading-relaxed"
              style="background: var(--accent-muted); border: 1px solid rgba(229, 169, 62, 0.1); color: var(--text-primary); font-family: var(--font-sans);"
            >
              {{ msg.content }}
            </div>
          </div>

          <!-- Assistant message -->
          <div v-else class="flex gap-3 chat-msg-enter">
            <!-- Avatar -->
            <div class="shrink-0 pt-0.5">
              <div
                class="size-6 rounded-lg flex items-center justify-center transition-all duration-300"
                :style="{
                  background: isLastAssistantStreaming(idx) ? 'var(--accent-muted)' : 'var(--badge-subtle-bg)',
                  border: isLastAssistantStreaming(idx) ? '1px solid rgba(229, 169, 62, 0.15)' : '1px solid var(--border-subtle)',
                }"
              >
                <UIcon
                  name="i-lucide-zap"
                  class="size-3 transition-colors duration-300"
                  :style="{ color: isLastAssistantStreaming(idx) ? 'var(--accent)' : 'var(--text-disabled)' }"
                />
              </div>
            </div>

            <div class="flex-1 min-w-0 space-y-2">
              <!-- Thinking block (collapsible) -->
              <details
                v-if="msg.thinking"
                class="chat-thinking"
                :open="isLastAssistantStreaming(idx) && !msg.content"
              >
                <summary class="flex items-center gap-1.5 cursor-pointer select-none py-0.5">
                  <UIcon
                    name="i-lucide-brain"
                    class="size-3 shrink-0"
                    :class="{ 'chat-thinking-pulse': isLastAssistantStreaming(idx) && activity?.type === 'thinking' }"
                    style="color: var(--text-disabled);"
                  />
                  <span class="text-[11px] font-mono" style="color: var(--text-disabled);">
                    {{ isLastAssistantStreaming(idx) && activity?.type === 'thinking' ? 'Thinking...' : 'Thought process' }}
                  </span>
                </summary>
                <div
                  class="mt-1 text-[11px] leading-[1.6] whitespace-pre-wrap break-words pl-5"
                  style="color: var(--text-tertiary); font-family: var(--font-mono); max-height: 200px; overflow-y: auto;"
                >{{ msg.thinking }}</div>
              </details>

              <!-- Tool activity indicator (during streaming, no content yet) -->
              <div
                v-if="isLastAssistantStreaming(idx) && !msg.content && activity?.type === 'tool'"
                class="flex items-center gap-2 py-0.5"
              >
                <div class="chat-wave">
                  <span /><span /><span /><span /><span />
                </div>
                <span class="text-[11px] font-mono" style="color: var(--text-disabled);">
                  {{ statusText }}
                </span>
              </div>

              <!-- Wave bars: initial state, no content, no thinking yet -->
              <div
                v-if="!msg.content && !msg.thinking && isLastAssistantStreaming(idx)"
                class="flex items-center gap-2 py-1"
              >
                <div class="chat-wave">
                  <span /><span /><span /><span /><span />
                </div>
                <span class="text-[11px] font-mono" style="color: var(--text-disabled);">
                  {{ statusText }}
                </span>
              </div>

              <!-- Rendered content (streaming with cursor or done) -->
              <div
                v-if="msg.content"
                class="chat-prose text-[13px] leading-[1.7] break-words"
                :class="{ 'is-streaming': isLastAssistantStreaming(idx) }"
                style="color: var(--text-primary); font-family: var(--font-sans);"
                v-html="renderMarkdown(msg.content)"
              />
            </div>
          </div>
        </template>

        <!-- Error -->
        <div
          v-if="error"
          class="flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[12px]"
          style="background: rgba(248, 113, 113, 0.06); border: 1px solid rgba(248, 113, 113, 0.12); color: var(--error);"
        >
          <UIcon name="i-lucide-alert-circle" class="size-3.5 shrink-0 mt-0.5" />
          <span>{{ error }}</span>
        </div>
      </div>

      <!-- Input area -->
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
            v-model="input"
            rows="1"
            class="w-full resize-none bg-transparent text-[13px] outline-none px-4 pt-3 pb-10"
            style="color: var(--text-primary); font-family: var(--font-sans); max-height: 120px;"
            :placeholder="activeAgent ? `Ask ${activeAgent.name} something...` : 'Tell Claude what to do...'"
            :disabled="isStreaming"
            @keydown="handleKeydown"
            @input="autoResize"
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
                @click="stopStreaming"
              >
                <UIcon name="i-lucide-square" class="size-3" />
              </button>
              <button
                v-else
                class="p-1.5 rounded-lg transition-all duration-200"
                :style="{
                  background: input.trim() ? 'var(--accent)' : 'var(--badge-subtle-bg)',
                  color: input.trim() ? 'white' : 'var(--text-disabled)',
                  boxShadow: input.trim() ? '0 0 12px var(--accent-glow)' : 'none',
                }"
                :disabled="!input.trim()"
                @click="handleSend"
              >
                <UIcon name="i-lucide-arrow-up" class="size-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.slide-enter-active {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}
.slide-leave-active {
  transition: transform 0.2s cubic-bezier(0.4, 0, 1, 1), opacity 0.15s ease;
}
.slide-enter-from, .slide-leave-to {
  transform: translateX(100%);
  opacity: 0.8;
}

/* Pulsing edge glow during streaming */
@keyframes edgePulse {
  0%, 100% { top: -120px; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { top: calc(100% + 120px); opacity: 0; }
}
.chat-edge-pulse {
  animation: edgePulse 2s ease-in-out infinite;
}

/* Ambient header glow pulse */
@keyframes glowPulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.chat-glow-pulse {
  animation: glowPulse 2s ease-in-out infinite;
}

/* Sweeping line in separator */
@keyframes lineSweep {
  0% { margin-left: -40%; }
  100% { margin-left: 100%; }
}
.chat-line-sweep {
  animation: lineSweep 1.5s ease-in-out infinite;
}

/* Dot pulse on status indicator */
@keyframes dotPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.4); }
}
.chat-dot-pulse {
  animation: dotPulse 1.2s ease-in-out infinite;
}

/* Audio wave bars for streaming (5 bars) */
.chat-wave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 14px;
}
.chat-wave span {
  display: block;
  width: 2px;
  border-radius: 1px;
  background: var(--accent);
}
.chat-wave span:nth-child(1) { animation: waveBar 0.8s ease-in-out 0s infinite; }
.chat-wave span:nth-child(2) { animation: waveBar 0.8s ease-in-out 0.15s infinite; }
.chat-wave span:nth-child(3) { animation: waveBar 0.8s ease-in-out 0.3s infinite; }
.chat-wave span:nth-child(4) { animation: waveBar 0.8s ease-in-out 0.45s infinite; }
.chat-wave span:nth-child(5) { animation: waveBar 0.8s ease-in-out 0.6s infinite; }

@keyframes waveBar {
  0%, 100% { height: 4px; opacity: 0.4; }
  50% { height: 12px; opacity: 1; }
}

/* Thinking block */
.chat-thinking summary {
  list-style: none;
}
.chat-thinking summary::-webkit-details-marker {
  display: none;
}
.chat-thinking summary::before {
  content: '▸';
  font-size: 9px;
  color: var(--text-disabled);
  margin-right: 2px;
  transition: transform 0.15s ease;
  display: inline-block;
}
.chat-thinking[open] summary::before {
  transform: rotate(90deg);
}

@keyframes thinkingPulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.chat-thinking-pulse {
  animation: thinkingPulse 1.5s ease-in-out infinite;
}

/* Quick action buttons — CSS-only hover */
.chat-quick-action {
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}
.chat-quick-action:hover {
  border-color: var(--border-default);
  background: var(--surface-hover);
}

/* Blinking cursor during streaming */
.is-streaming {
  position: relative;
}
.is-streaming::after {
  content: '';
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--accent);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: cursorBlink 0.8s step-end infinite;
}

@keyframes cursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* Markdown prose styles */
.chat-prose :deep(p) {
  margin: 0.4em 0;
}
.chat-prose :deep(p:first-child) {
  margin-top: 0;
}
.chat-prose :deep(p:last-child) {
  margin-bottom: 0;
}
.chat-prose :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--badge-subtle-bg);
  padding: 0.15em 0.4em;
  border-radius: 4px;
}
.chat-prose :deep(pre) {
  background: var(--surface-base);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm, 8px);
  padding: 0.75em 1em;
  overflow-x: auto;
  margin: 0.6em 0;
}
.chat-prose :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.85em;
}
.chat-prose :deep(ul),
.chat-prose :deep(ol) {
  padding-left: 1.5em;
  margin: 0.4em 0;
}
.chat-prose :deep(li) {
  margin: 0.2em 0;
}
.chat-prose :deep(strong) {
  color: var(--text-primary);
  font-weight: 600;
}
.chat-prose :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.chat-prose :deep(blockquote) {
  border-left: 2px solid var(--border-subtle);
  padding-left: 0.75em;
  margin: 0.4em 0;
  color: var(--text-secondary);
}
.chat-prose :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 0.8em 0;
}
.chat-prose :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
  margin: 0.6em 0;
}
.chat-prose :deep(th),
.chat-prose :deep(td) {
  border: 1px solid var(--border-subtle);
  padding: 0.35em 0.6em;
  text-align: left;
}
.chat-prose :deep(th) {
  background: var(--surface-raised);
  font-weight: 600;
  font-size: 0.9em;
}
.chat-prose :deep(tr:nth-child(even)) {
  background: var(--surface-raised);
}

/* Message slide-in animation */
@keyframes chatMsgEnter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.chat-msg-enter {
  animation: chatMsgEnter 0.25s ease both;
}
</style>
