# Agent Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the agent detail page into an integrated Agent Studio with live testing, instruction improvement, and execution observability — while cleaning up foundational tech debt.

**Architecture:** Multi-panel studio layout (editor + live chat + inspector) built on decomposed chat components and a generic CRUD composable. The studio chat uses isolated state (`useStudioChat`) independent from the global chat panel. New server endpoints handle instruction improvement and conversation history.

**Tech Stack:** Nuxt 3, Vue 3, TypeScript, @anthropic-ai/claude-agent-sdk, @nuxt/ui, Tailwind CSS

---

## File Structure

### New Files
```
app/composables/useCrud.ts                          # Generic CRUD composable
app/composables/useStudioChat.ts                     # Isolated chat state for studio
app/composables/useAgentHistory.ts                   # Conversation history management
app/components/chat/ChatMessage.vue                  # Single message bubble
app/components/chat/ChatInput.vue                    # Chat textarea + send
app/components/chat/StreamIndicator.vue              # Streaming status animations
app/components/chat/QuickActions.vue                 # Suggestion chips grid
app/components/studio/EditorPanel.vue                # Tabbed editor (Instructions/Settings/Skills)
app/components/studio/InstructionEditor.vue          # Instructions textarea + improve button
app/components/studio/TestPanel.vue                  # Live agent chat in studio
app/components/studio/ExecutionInspector.vue         # Tool calls, thinking, tokens panel
server/api/agents/improve-instructions.post.ts       # Instruction improvement endpoint
server/api/agents/[slug]/history.get.ts              # List conversation history
server/api/agents/[slug]/history/[id].get.ts         # Get single conversation
server/api/agents/[slug]/history/[id].delete.ts      # Delete conversation
```

### Modified Files
```
app/composables/useAgents.ts                         # Thin wrapper over useCrud
app/composables/useCommands.ts                       # Thin wrapper + extras
app/composables/useSkills.ts                         # Thin wrapper over useCrud
app/composables/useWorkflows.ts                      # Thin wrapper over useCrud
app/types/index.ts                                   # Add ChatMessage, StreamActivity, history types
app/components/ChatPanel.vue                         # Slim orchestrator using chat/* sub-components
app/pages/agents/[slug].vue                          # Studio layout shell
app/app.vue                                          # Update nav (templates -> explore)
nuxt.config.ts                                       # Add /templates -> /explore redirect
```

### Deleted Files
```
app/pages/templates.vue                              # Replaced by explore.vue
```

---

## Task 1: Generic CRUD Composable

**Files:**
- Create: `app/composables/useCrud.ts`
- Modify: `app/composables/useAgents.ts`
- Modify: `app/composables/useSkills.ts`
- Modify: `app/composables/useCommands.ts`
- Modify: `app/composables/useWorkflows.ts`

- [ ] **Step 1: Create `useCrud.ts`**

```typescript
// app/composables/useCrud.ts

interface CrudOptions {
  stateKey: string
  label?: string
}

export function useCrud<T extends { slug: string }, P = unknown>(basePath: string, opts: CrudOptions) {
  const items = useState<T[]>(opts.stateKey, () => [])
  const loading = useState(`${opts.stateKey}Loading`, () => false)
  const error = useState<string | null>(`${opts.stateKey}Error`, () => null)

  const label = opts.label || opts.stateKey

  async function fetchAll() {
    loading.value = true
    error.value = null
    try {
      items.value = await $fetch<T[]>(basePath)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : `Failed to load ${label}`
      error.value = msg
      console.error(`[useCrud:${label}] fetchAll:`, msg)
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(slug: string) {
    return await $fetch<T>(`${basePath}/${slug}`)
  }

  async function create(payload: P) {
    const item = await $fetch<T>(basePath, { method: 'POST', body: payload })
    items.value.push(item)
    return item
  }

  async function update(slug: string, payload: P) {
    const item = await $fetch<T>(`${basePath}/${slug}`, { method: 'PUT', body: payload })
    const idx = items.value.findIndex(i => i.slug === slug)
    if (idx >= 0) items.value[idx] = item
    else items.value.push(item)
    return item
  }

  async function remove(slug: string) {
    await $fetch(`${basePath}/${slug}`, { method: 'DELETE' as const })
    items.value = items.value.filter(i => i.slug !== slug)
  }

  return { items, loading, error, fetchAll, fetchOne, create, update, remove }
}
```

- [ ] **Step 2: Rewrite `useAgents.ts` as thin wrapper**

Replace the entire file with:

```typescript
// app/composables/useAgents.ts
import type { Agent, AgentPayload } from '~/types'

export function useAgents() {
  const crud = useCrud<Agent, AgentPayload>('/api/agents', { stateKey: 'agents', label: 'agents' })

  return {
    agents: crud.items,
    loading: crud.loading,
    error: crud.error,
    fetchAll: crud.fetchAll,
    fetchOne: crud.fetchOne,
    create: crud.create,
    update: crud.update,
    remove: crud.remove,
  }
}
```

- [ ] **Step 3: Rewrite `useSkills.ts` as thin wrapper**

Replace the entire file with:

```typescript
// app/composables/useSkills.ts
import type { Skill, SkillPayload } from '~/types'

export function useSkills() {
  const crud = useCrud<Skill, SkillPayload>('/api/skills', { stateKey: 'skills', label: 'skills' })

  return {
    skills: crud.items,
    loading: crud.loading,
    error: crud.error,
    fetchAll: crud.fetchAll,
    fetchOne: crud.fetchOne,
    create: crud.create,
    update: crud.update,
    remove: crud.remove,
  }
}
```

- [ ] **Step 4: Rewrite `useWorkflows.ts` as thin wrapper**

Replace the entire file with:

```typescript
// app/composables/useWorkflows.ts
import type { Workflow, WorkflowPayload } from '~/types'

export function useWorkflows() {
  const crud = useCrud<Workflow, Partial<WorkflowPayload & { lastRunAt?: string }>>('/api/workflows', { stateKey: 'workflows', label: 'workflows' })

  return {
    workflows: crud.items,
    loading: crud.loading,
    error: crud.error,
    fetchAll: crud.fetchAll,
    fetchOne: crud.fetchOne,
    create: (payload: WorkflowPayload) => crud.create(payload),
    update: crud.update,
    remove: crud.remove,
  }
}
```

- [ ] **Step 5: Rewrite `useCommands.ts` as wrapper with extras**

Replace the entire file with:

```typescript
// app/composables/useCommands.ts
import type { Command, CommandPayload } from '~/types'

export function useCommands() {
  const crud = useCrud<Command, CommandPayload>('/api/commands', { stateKey: 'commands', label: 'commands' })

  const groupedByDirectory = computed(() => {
    const groups: Record<string, Command[]> = {}
    for (const cmd of crud.items.value) {
      const dir = cmd.directory || 'root'
      if (!groups[dir]) groups[dir] = []
      groups[dir].push(cmd)
    }
    return groups
  })

  function getCommandsForAgent(agentSlug: string, agentName: string, allCommands: Command[]): Command[] {
    const slugLower = agentSlug.toLowerCase()
    const nameLower = agentName.toLowerCase()
    return allCommands.filter(cmd => {
      const bodyLower = cmd.body.toLowerCase()
      return bodyLower.includes(`/${slugLower}`) || bodyLower.includes(slugLower) || bodyLower.includes(nameLower)
    })
  }

  return {
    commands: crud.items,
    loading: crud.loading,
    error: crud.error,
    fetchAll: crud.fetchAll,
    fetchOne: crud.fetchOne,
    create: crud.create,
    update: crud.update,
    remove: crud.remove,
    groupedByDirectory,
    getCommandsForAgent,
  }
}
```

- [ ] **Step 6: Verify the app still works**

Run: `cd /Users/davidrodriguezpozo/workspaces/agents-ui && npx nuxi typecheck`

Then: `npm run dev` and verify the dashboard, agent list, commands list, skills list, and workflows list all load correctly.

- [ ] **Step 7: Commit**

```bash
git add app/composables/useCrud.ts app/composables/useAgents.ts app/composables/useCommands.ts app/composables/useSkills.ts app/composables/useWorkflows.ts
git commit -m "refactor: extract generic useCrud composable from duplicate CRUD composables"
```

---

## Task 2: Type Consolidation

**Files:**
- Modify: `app/types/index.ts`
- Modify: `app/composables/useChat.ts`

- [ ] **Step 1: Add chat and history types to `app/types/index.ts`**

Add these at the end of the file (after the existing `StepExecution` interface):

```typescript
// ── Chat ──────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  timestamp: number
}

export type StreamActivity =
  | { type: 'thinking' }
  | { type: 'tool'; name: string; elapsed: number }
  | { type: 'writing' }
  | null

// ── History ───────────────────────────────────────

export interface ToolCallRecord {
  toolName: string
  elapsed: number
  timestamp: number
}

export interface ConversationSession {
  id: string
  agentSlug: string
  messages: ChatMessage[]
  toolCalls: ToolCallRecord[]
  tokenUsage: { input: number; output: number }
  duration: number
  createdAt: string
}

export interface ConversationSummary {
  id: string
  agentSlug: string
  messageCount: number
  firstUserMessage: string
  createdAt: string
}
```

- [ ] **Step 2: Update `useChat.ts` to import types from `~/types`**

In `app/composables/useChat.ts`, remove lines 1-15 (the local `ChatMessage` interface and `StreamActivity` type) and replace the import line with:

```typescript
import type { SkillInvocation, ChatMessage, StreamActivity } from '~/types'
```

- [ ] **Step 3: Verify types**

Run: `cd /Users/davidrodriguezpozo/workspaces/agents-ui && npx nuxi typecheck`

- [ ] **Step 4: Commit**

```bash
git add app/types/index.ts app/composables/useChat.ts
git commit -m "refactor: consolidate ChatMessage, StreamActivity, and history types into types/index.ts"
```

---

## Task 3: Remove templates.vue and Update Nav

**Files:**
- Delete: `app/pages/templates.vue`
- Modify: `app/app.vue:120-121`
- Modify: `nuxt.config.ts`

- [ ] **Step 1: Delete `templates.vue`**

```bash
rm app/pages/templates.vue
```

- [ ] **Step 2: Update nav link in `app.vue`**

In `app/app.vue`, change line 121 from:

```typescript
  { label: 'Templates', icon: 'i-lucide-layout-template', to: '/templates' },
```

to:

```typescript
  { label: 'Explore', icon: 'i-lucide-compass', to: '/explore' },
```

- [ ] **Step 3: Add route redirect in `nuxt.config.ts`**

Add a `routeRules` section to `nuxt.config.ts`:

```typescript
  routeRules: {
    '/templates': { redirect: '/explore' },
  },
```

Place it after the `colorMode` block (after line 43).

- [ ] **Step 4: Verify**

Run the dev server and confirm:
1. `/templates` redirects to `/explore`
2. The nav sidebar shows "Explore" instead of "Templates"
3. The explore page loads correctly

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove duplicate templates.vue, redirect to explore"
```

---

## Task 4: Decompose ChatPanel into Sub-Components

**Files:**
- Create: `app/components/chat/ChatMessage.vue`
- Create: `app/components/chat/ChatInput.vue`
- Create: `app/components/chat/StreamIndicator.vue`
- Create: `app/components/chat/QuickActions.vue`
- Modify: `app/components/ChatPanel.vue`

- [ ] **Step 0: Create directory**

```bash
mkdir -p app/components/chat
```

- [ ] **Step 1: Create `chat/ChatMessage.vue`**

```vue
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
    <!-- Avatar -->
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
.chat-prose :deep(p) { margin: 0.4em 0; }
.chat-prose :deep(p:first-child) { margin-top: 0; }
.chat-prose :deep(p:last-child) { margin-bottom: 0; }
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
.chat-prose :deep(pre code) { background: none; padding: 0; font-size: 0.85em; }
.chat-prose :deep(ul), .chat-prose :deep(ol) { padding-left: 1.5em; margin: 0.4em 0; }
.chat-prose :deep(li) { margin: 0.2em 0; }
.chat-prose :deep(strong) { color: var(--text-primary); font-weight: 600; }
.chat-prose :deep(a) { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.chat-prose :deep(blockquote) {
  border-left: 2px solid var(--border-subtle);
  padding-left: 0.75em;
  margin: 0.4em 0;
  color: var(--text-secondary);
}
.chat-prose :deep(hr) { border: none; border-top: 1px solid var(--border-subtle); margin: 0.8em 0; }
.chat-prose :deep(table) { width: 100%; border-collapse: collapse; font-size: 0.9em; margin: 0.6em 0; }
.chat-prose :deep(th), .chat-prose :deep(td) { border: 1px solid var(--border-subtle); padding: 0.35em 0.6em; text-align: left; }
.chat-prose :deep(th) { background: var(--surface-raised); font-weight: 600; font-size: 0.9em; }
.chat-prose :deep(tr:nth-child(even)) { background: var(--surface-raised); }

/* Message slide-in animation */
@keyframes chatMsgEnter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.chat-msg-enter {
  animation: chatMsgEnter 0.25s ease both;
}
</style>
```

- [ ] **Step 2: Create `chat/StreamIndicator.vue`**

```vue
<script setup lang="ts">
defineProps<{
  statusText: string
}>()
</script>

<template>
  <div class="flex items-center gap-2 py-0.5">
    <div class="chat-wave">
      <span /><span /><span /><span /><span />
    </div>
    <span class="text-[11px] font-mono" style="color: var(--text-disabled);">
      {{ statusText }}
    </span>
  </div>
</template>

<style scoped>
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
</style>
```

- [ ] **Step 3: Create `chat/ChatInput.vue`**

```vue
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
```

- [ ] **Step 4: Create `chat/QuickActions.vue`**

```vue
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
```

- [ ] **Step 5: Rewrite `ChatPanel.vue` as slim orchestrator**

Replace the entire file with a version that uses the new sub-components. The logic stays the same, but the template delegates to `ChatMessage`, `ChatInput`, `StreamIndicator`, and `QuickActions`:

```vue
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
const inputRef = ref<InstanceType<typeof import('./chat/ChatInput.vue').default> | null>(null)
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
        <!-- Empty state -->
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

        <!-- Message bubbles -->
        <template v-for="(msg, idx) in messages" :key="msg.id">
          <ChatMessage
            :message="(msg as ChatMessage)"
            :is-streaming="isLastAssistantStreaming(idx)"
            :activity="activity"
            :status-text="statusText"
          />
        </template>

        <!-- Error -->
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
```

- [ ] **Step 6: Verify ChatPanel works identically**

Run dev server. Open the chat panel with Cmd+J. Test:
1. Quick actions display
2. Sending a message shows streaming indicators
3. Thinking blocks collapse/expand
4. Escape closes panel
5. Agent banner shows when chatting with specific agent

- [ ] **Step 7: Commit**

```bash
git add app/components/chat/ app/components/ChatPanel.vue
git commit -m "refactor: decompose ChatPanel into chat/ChatMessage, ChatInput, StreamIndicator, QuickActions"
```

---

## Task 5: Studio Chat Composable

**Files:**
- Create: `app/composables/useStudioChat.ts`

- [ ] **Step 1: Create `useStudioChat.ts`**

This is an isolated version of the chat logic for the studio, using separate `useState` keys so it never collides with the global `useChat`:

```typescript
// app/composables/useStudioChat.ts
import type { ChatMessage, StreamActivity, ToolCallRecord } from '~/types'

export function useStudioChat() {
  const messages = useState<ChatMessage[]>('studio-chat-messages', () => [])
  const isStreaming = ref(false)
  const sessionId = useState<string | null>('studio-chat-session', () => null)
  const error = ref<string | null>(null)
  const activity = ref<StreamActivity>(null)
  const toolCalls = ref<ToolCallRecord[]>([])
  const tokenUsage = ref<{ input: number; output: number }>({ input: 0, output: 0 })

  let abortController: AbortController | null = null

  function addMessage(role: 'user' | 'assistant', content: string): ChatMessage {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: Date.now(),
    }
    messages.value.push(msg)
    return msg
  }

  function updateMessage(id: string, updates: Partial<ChatMessage>) {
    const idx = messages.value.findIndex(m => m.id === id)
    if (idx !== -1) {
      messages.value[idx] = Object.assign({}, messages.value[idx], updates)
    }
  }

  async function sendMessage(content: string, opts: {
    agentSlug: string
    systemPromptOverride?: string
    projectDir?: string
  }) {
    if (!content.trim() || isStreaming.value) return

    error.value = null
    addMessage('user', content)

    const assistantMsg = addMessage('assistant', '')
    isStreaming.value = true
    activity.value = null

    abortController = new AbortController()

    try {
      const response = await $fetch<ReadableStream>('/api/chat', {
        method: 'POST',
        body: {
          messages: messages.value
            .filter(m => m.content)
            .map(m => ({ role: m.role, content: m.content })),
          sessionId: sessionId.value,
          agentSlug: opts.agentSlug,
          ...(opts.systemPromptOverride ? { systemPromptOverride: opts.systemPromptOverride } : {}),
          ...(opts.projectDir ? { projectDir: opts.projectDir } : {}),
        },
        signal: abortController.signal,
        responseType: 'stream',
      })

      const reader = (response as unknown as ReadableStream).getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamedText = ''
      let streamedThinking = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'session') {
              sessionId.value = data.sessionId
            } else if (data.type === 'thinking_start') {
              activity.value = { type: 'thinking' }
              streamedThinking = ''
            } else if (data.type === 'thinking_delta') {
              streamedThinking += data.text
              activity.value = { type: 'thinking' }
              updateMessage(assistantMsg.id, { thinking: streamedThinking })
            } else if (data.type === 'text_delta') {
              streamedText += data.text
              activity.value = { type: 'writing' }
              updateMessage(assistantMsg.id, { content: streamedText })
            } else if (data.type === 'tool_progress') {
              activity.value = { type: 'tool', name: data.toolName, elapsed: data.elapsed }
              toolCalls.value.push({
                toolName: data.toolName,
                elapsed: data.elapsed,
                timestamp: Date.now(),
              })
            } else if (data.type === 'result') {
              updateMessage(assistantMsg.id, { content: data.text })
            } else if (data.type === 'error') {
              error.value = data.message
            } else if (data.type === 'done') {
              sessionId.value = data.sessionId
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      error.value = err instanceof Error ? err.message : 'Failed to send message'
    } finally {
      isStreaming.value = false
      activity.value = null
      abortController = null
    }
  }

  function stopStreaming() {
    abortController?.abort()
    isStreaming.value = false
    activity.value = null
  }

  function clearChat() {
    messages.value = []
    sessionId.value = null
    error.value = null
    activity.value = null
    toolCalls.value = []
  }

  return {
    messages: readonly(messages),
    isStreaming: readonly(isStreaming),
    error: readonly(error),
    activity: readonly(activity),
    toolCalls: readonly(toolCalls),
    tokenUsage: readonly(tokenUsage),
    sendMessage,
    stopStreaming,
    clearChat,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/composables/useStudioChat.ts
git commit -m "feat: add useStudioChat composable with isolated state for agent studio"
```

---

## Task 6: Studio Components

**Files:**
- Create: `app/components/studio/ExecutionInspector.vue`
- Create: `app/components/studio/InstructionEditor.vue`
- Create: `app/components/studio/TestPanel.vue`
- Create: `app/components/studio/EditorPanel.vue`

- [ ] **Step 1: Create `studio/ExecutionInspector.vue`**

```vue
<script setup lang="ts">
import type { ToolCallRecord } from '~/types'

defineProps<{
  toolCalls: readonly ToolCallRecord[]
  isStreaming: boolean
}>()

const isExpanded = ref(false)
</script>

<template>
  <div
    class="border-t transition-all"
    style="border-color: var(--border-subtle); background: var(--surface-base);"
  >
    <!-- Toggle bar -->
    <button
      class="w-full flex items-center gap-2 px-4 py-2 text-left hover-bg transition-all"
      @click="isExpanded = !isExpanded"
    >
      <UIcon
        :name="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        class="size-3"
        style="color: var(--text-disabled);"
      />
      <span class="text-[11px] font-mono" style="color: var(--text-tertiary);">
        Execution Inspector
      </span>
      <span
        v-if="toolCalls.length"
        class="text-[9px] font-mono px-1.5 py-px rounded-full"
        style="background: var(--badge-subtle-bg); color: var(--text-disabled);"
      >
        {{ toolCalls.length }} tool{{ toolCalls.length !== 1 ? 's' : '' }}
      </span>
      <div v-if="isStreaming" class="ml-auto size-1.5 rounded-full bg-amber-400 animate-pulse" />
    </button>

    <!-- Content -->
    <div v-if="isExpanded" class="px-4 pb-3 space-y-1.5 max-h-[200px] overflow-y-auto">
      <div v-if="!toolCalls.length" class="text-[11px] font-mono py-2" style="color: var(--text-disabled);">
        No tool calls yet. Start a conversation to see execution details.
      </div>

      <div
        v-for="(call, idx) in toolCalls"
        :key="idx"
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-mono"
        style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
      >
        <UIcon name="i-lucide-wrench" class="size-3 shrink-0" style="color: var(--text-disabled);" />
        <span class="flex-1 truncate" style="color: var(--text-secondary);">{{ call.toolName }}</span>
        <span class="shrink-0" style="color: var(--text-disabled);">{{ call.elapsed.toFixed(1) }}s</span>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create `studio/InstructionEditor.vue`**

```vue
<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  agentName: string
  agentDescription: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const isImproving = ref(false)
const improveError = ref<string | null>(null)
const suggestion = ref<string | null>(null)

const wordCount = computed(() => {
  const text = props.modelValue.trim()
  return text ? text.split(/\s+/).length : 0
})

// NOTE: The spec defines per-suggestion diff UI (original vs suggested).
// This initial implementation shows the full improved text as accept/dismiss.
// Per-suggestion granularity is deferred to a follow-up iteration.

async function improveInstructions() {
  isImproving.value = true
  improveError.value = null
  suggestion.value = null

  try {
    const response = await $fetch<{ suggestions: unknown[]; improvedInstructions: string }>('/api/agents/improve-instructions', {
      method: 'POST',
      body: {
        name: props.agentName,
        description: props.agentDescription,
        currentInstructions: props.modelValue,
      },
      timeout: 30000,
    })
    suggestion.value = response.improvedInstructions
  } catch (e: unknown) {
    improveError.value = e instanceof Error ? e.message : 'Failed to improve instructions'
  } finally {
    isImproving.value = false
  }
}

function acceptSuggestion() {
  if (suggestion.value) {
    emit('update:modelValue', suggestion.value)
    suggestion.value = null
  }
}

function dismissSuggestion() {
  suggestion.value = null
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Toolbar -->
    <div class="flex items-center justify-between px-4 py-2 border-b" style="border-color: var(--border-subtle);">
      <span class="text-[11px] font-mono" style="color: var(--text-disabled);">
        {{ wordCount }} words
      </span>
      <button
        class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
        :style="{
          background: isImproving ? 'var(--accent-muted)' : 'var(--surface-raised)',
          border: '1px solid ' + (isImproving ? 'rgba(229, 169, 62, 0.2)' : 'var(--border-subtle)'),
          color: isImproving ? 'var(--accent)' : 'var(--text-secondary)',
        }"
        :disabled="isImproving"
        @click="improveInstructions"
      >
        <UIcon :name="isImproving ? 'i-lucide-loader-2' : 'i-lucide-wand-2'" class="size-3" :class="{ 'animate-spin': isImproving }" />
        {{ isImproving ? 'Improving...' : 'Improve with Claude' }}
      </button>
    </div>

    <!-- Suggestion banner -->
    <div
      v-if="suggestion"
      class="mx-4 mt-3 rounded-xl p-3 space-y-2"
      style="background: var(--accent-muted); border: 1px solid rgba(229, 169, 62, 0.15);"
    >
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-sparkles" class="size-3.5" style="color: var(--accent);" />
        <span class="text-[12px] font-medium" style="color: var(--text-primary);">Suggested improvement</span>
      </div>
      <pre class="text-[12px] leading-relaxed whitespace-pre-wrap max-h-[150px] overflow-y-auto" style="color: var(--text-secondary); font-family: var(--font-mono);">{{ suggestion }}</pre>
      <div class="flex gap-2">
        <button
          class="px-3 py-1 rounded-lg text-[11px] font-medium transition-all"
          style="background: var(--accent); color: white;"
          @click="acceptSuggestion"
        >
          Accept
        </button>
        <button
          class="px-3 py-1 rounded-lg text-[11px] font-medium transition-all hover-bg"
          style="color: var(--text-tertiary);"
          @click="dismissSuggestion"
        >
          Dismiss
        </button>
      </div>
    </div>

    <!-- Error -->
    <div v-if="improveError" class="mx-4 mt-2 text-[11px] rounded-lg px-3 py-2" style="background: rgba(248, 113, 113, 0.06); color: var(--error);">
      {{ improveError }}
    </div>

    <!-- Editor -->
    <textarea
      :value="modelValue"
      class="flex-1 w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none p-4"
      style="color: var(--text-primary); font-family: var(--font-mono);"
      placeholder="Write instructions for your agent..."
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
  </div>
</template>
```

- [ ] **Step 3: Create `studio/TestPanel.vue`**

```vue
<script setup lang="ts">
import type { ChatMessage, StreamActivity } from '~/types'

const props = defineProps<{
  agentSlug: string
  agentName: string
  isDraft: boolean
}>()

const { messages, isStreaming, error, activity, toolCalls, sendMessage, stopStreaming, clearChat } = useStudioChat()
const { displayPath: projectDisplayPath } = useWorkingDir()

const input = ref('')
const inputRef = ref<InstanceType<typeof import('../chat/ChatInput.vue').default> | null>(null)
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

async function handleSend() {
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  inputRef.value?.resetHeight()
  await sendMessage(text, { agentSlug: props.agentSlug })
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="shrink-0 px-4 py-2.5 flex items-center justify-between border-b" style="border-color: var(--border-subtle);">
      <div class="flex items-center gap-2">
        <span class="text-[12px] font-medium" style="color: var(--text-primary);">Test</span>
        <span
          v-if="isDraft"
          class="text-[9px] font-mono px-1.5 py-px rounded-full"
          style="background: rgba(229, 169, 62, 0.1); color: var(--accent);"
        >
          Draft
        </span>
        <span
          class="text-[9px] font-mono tracking-widest uppercase px-1.5 py-px rounded-full transition-all"
          :style="{
            background: isStreaming ? 'var(--accent-muted)' : 'var(--badge-subtle-bg)',
            color: isStreaming ? 'var(--accent)' : 'var(--text-disabled)',
          }"
        >
          {{ statusText }}
        </span>
      </div>
      <button
        v-if="messages.length"
        class="p-1 rounded-md hover-bg transition-all"
        style="color: var(--text-disabled);"
        title="Clear conversation"
        @click="clearChat"
      >
        <UIcon name="i-lucide-rotate-ccw" class="size-3" />
      </button>
    </div>

    <!-- Messages -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      <div v-if="!messages.length" class="flex flex-col items-center justify-center h-full gap-3">
        <UIcon name="i-lucide-message-square" class="size-8" style="color: var(--text-disabled); opacity: 0.5;" />
        <p class="text-[12px] text-center max-w-[200px]" style="color: var(--text-tertiary);">
          Test your agent here. Changes to instructions are reflected immediately.
        </p>
      </div>

      <template v-for="(msg, idx) in messages" :key="msg.id">
        <ChatMessage
          :message="(msg as ChatMessage)"
          :is-streaming="isLastAssistantStreaming(idx)"
          :activity="activity"
          :status-text="statusText"
        />
      </template>

      <div v-if="error" class="text-[11px] rounded-lg px-3 py-2" style="background: rgba(248, 113, 113, 0.06); color: var(--error);">
        {{ error }}
      </div>
    </div>

    <!-- Input -->
    <ChatInput
      ref="inputRef"
      v-model="input"
      :placeholder="`Ask ${agentName} something...`"
      :disabled="isStreaming"
      :is-streaming="isStreaming"
      :project-display-path="projectDisplayPath"
      @send="handleSend"
      @stop="stopStreaming"
    />
  </div>
</template>
```

- [ ] **Step 4: Create `studio/EditorPanel.vue`**

```vue
<script setup lang="ts">
import type { AgentFrontmatter, AgentModel, AgentMemory, AgentSkill } from '~/types'

const props = defineProps<{
  frontmatter: AgentFrontmatter
  body: string
  skills: AgentSkill[]
  loadingSkills: boolean
}>()

const emit = defineEmits<{
  'update:frontmatter': [value: AgentFrontmatter]
  'update:body': [value: string]
}>()

const activeTab = ref<'instructions' | 'settings' | 'skills'>('instructions')

const modelOptions: { label: string; value: AgentModel }[] = [
  { label: 'Opus', value: 'opus' },
  { label: 'Sonnet', value: 'sonnet' },
  { label: 'Haiku', value: 'haiku' },
]

const memoryOptions: { label: string; value: AgentMemory }[] = [
  { label: 'User', value: 'user' },
  { label: 'Project', value: 'project' },
  { label: 'None', value: 'none' },
]

function updateFrontmatter(key: keyof AgentFrontmatter, value: unknown) {
  emit('update:frontmatter', { ...props.frontmatter, [key]: value })
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Tabs -->
    <div class="shrink-0 flex border-b" style="border-color: var(--border-subtle);">
      <button
        v-for="tab in (['instructions', 'settings', 'skills'] as const)"
        :key="tab"
        class="px-4 py-2.5 text-[12px] font-medium capitalize transition-all relative"
        :style="{
          color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-tertiary)',
        }"
        @click="activeTab = tab"
      >
        {{ tab }}
        <div
          v-if="activeTab === tab"
          class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
          style="background: var(--accent);"
        />
      </button>
    </div>

    <!-- Instructions tab -->
    <div v-if="activeTab === 'instructions'" class="flex-1 min-h-0">
      <InstructionEditor
        :model-value="body"
        :agent-name="frontmatter.name"
        :agent-description="frontmatter.description"
        @update:model-value="emit('update:body', $event)"
      />
    </div>

    <!-- Settings tab -->
    <div v-if="activeTab === 'settings'" class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Name -->
      <div class="space-y-1">
        <label class="text-[11px] font-medium" style="color: var(--text-tertiary);">Name</label>
        <input
          :value="frontmatter.name"
          class="field-input w-full"
          placeholder="Agent name"
          @input="updateFrontmatter('name', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- Description -->
      <div class="space-y-1">
        <label class="text-[11px] font-medium" style="color: var(--text-tertiary);">Description</label>
        <input
          :value="frontmatter.description"
          class="field-input w-full"
          placeholder="What does this agent do?"
          @input="updateFrontmatter('description', ($event.target as HTMLInputElement).value)"
        />
      </div>

      <!-- Model -->
      <div class="space-y-1">
        <label class="text-[11px] font-medium" style="color: var(--text-tertiary);">Model</label>
        <div class="flex gap-2">
          <button
            v-for="opt in modelOptions"
            :key="opt.value"
            class="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all"
            :style="{
              background: frontmatter.model === opt.value ? 'var(--accent-muted)' : 'var(--surface-raised)',
              border: '1px solid ' + (frontmatter.model === opt.value ? 'rgba(229, 169, 62, 0.2)' : 'var(--border-subtle)'),
              color: frontmatter.model === opt.value ? 'var(--accent)' : 'var(--text-secondary)',
            }"
            @click="updateFrontmatter('model', opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- Memory -->
      <div class="space-y-1">
        <label class="text-[11px] font-medium" style="color: var(--text-tertiary);">Memory</label>
        <div class="flex gap-2">
          <button
            v-for="opt in memoryOptions"
            :key="opt.value"
            class="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all"
            :style="{
              background: frontmatter.memory === opt.value ? 'var(--accent-muted)' : 'var(--surface-raised)',
              border: '1px solid ' + (frontmatter.memory === opt.value ? 'rgba(229, 169, 62, 0.2)' : 'var(--border-subtle)'),
              color: frontmatter.memory === opt.value ? 'var(--accent)' : 'var(--text-secondary)',
            }"
            @click="updateFrontmatter('memory', opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- Color -->
      <div class="space-y-1">
        <label class="text-[11px] font-medium" style="color: var(--text-tertiary);">Color</label>
        <input
          type="color"
          :value="frontmatter.color || '#e5a93e'"
          class="w-8 h-8 rounded-lg cursor-pointer border"
          style="border-color: var(--border-subtle);"
          @input="updateFrontmatter('color', ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <!-- Skills tab -->
    <div v-if="activeTab === 'skills'" class="flex-1 overflow-y-auto p-4">
      <div v-if="loadingSkills" class="text-[11px] font-mono py-4 text-center" style="color: var(--text-disabled);">
        Loading skills...
      </div>
      <div v-else-if="!skills.length" class="text-[12px] py-4 text-center" style="color: var(--text-tertiary);">
        No skills attached to this agent yet.
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="skill in skills"
          :key="skill.slug"
          class="flex items-center gap-2 px-3 py-2 rounded-lg"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        >
          <UIcon name="i-lucide-sparkles" class="size-3.5 shrink-0" style="color: var(--accent);" />
          <div class="flex-1 min-w-0">
            <div class="text-[12px] font-medium truncate" style="color: var(--text-primary);">{{ skill.frontmatter.name }}</div>
            <div class="text-[10px] truncate" style="color: var(--text-tertiary);">{{ skill.frontmatter.description }}</div>
          </div>
          <span
            class="text-[9px] font-mono px-1.5 py-px rounded-full shrink-0"
            style="background: var(--badge-subtle-bg); color: var(--text-disabled);"
          >
            {{ skill.source }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Commit**

```bash
git add app/components/studio/
git commit -m "feat: add studio components — EditorPanel, InstructionEditor, TestPanel, ExecutionInspector"
```

---

## Task 7: Improve Instructions Endpoint

**Files:**
- Create: `server/api/agents/improve-instructions.post.ts`

- [ ] **Step 1: Create the endpoint**

```typescript
// server/api/agents/improve-instructions.post.ts
import { query } from '@anthropic-ai/claude-agent-sdk'

interface ImproveRequest {
  name: string
  description: string
  currentInstructions: string
}

interface Suggestion {
  type: string
  description: string
  original: string
  suggested: string
}

interface ImproveResponse {
  suggestions: Suggestion[]
  improvedInstructions: string
}

export default defineEventHandler(async (event): Promise<ImproveResponse> => {
  const body = await readBody<ImproveRequest>(event)

  if (!body.name) {
    throw createError({ statusCode: 400, message: 'name is required' })
  }

  const isGeneration = !body.currentInstructions?.trim()

  const prompt = isGeneration
    ? `Generate instructions for an AI agent named "${body.name}" described as: "${body.description}". Write clear, specific instructions that tell the agent what to do, how to behave, and what constraints to follow. Return ONLY the instructions text, no JSON or metadata.`
    : `Review and improve these instructions for an AI agent named "${body.name}" (${body.description}):\n\n${body.currentInstructions}\n\nReturn a JSON object with this exact shape:\n{"suggestions": [{"type": "specificity|clarity|completeness|tone", "description": "what to improve", "original": "original text", "suggested": "improved text"}], "improvedInstructions": "full improved instructions"}\n\nReturn ONLY valid JSON, nothing else.`

  let resultText = ''

  try {
    for await (const message of query({
      prompt,
      options: {
        maxTurns: 1,
        allowedTools: [],
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: 'You are helping improve agent instructions. Be concise and actionable.',
        },
      },
    })) {
      if ('result' in message) {
        resultText = message.result
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to call Claude'
    throw createError({ statusCode: 500, message: msg })
  }

  if (!resultText) {
    throw createError({ statusCode: 500, message: 'No response from Claude' })
  }

  // For generation mode, return raw text
  if (isGeneration) {
    return { suggestions: [], improvedInstructions: resultText.trim() }
  }

  // For improvement mode, try to parse JSON
  try {
    const parsed = JSON.parse(resultText) as ImproveResponse
    if (parsed.improvedInstructions && Array.isArray(parsed.suggestions)) {
      return parsed
    }
  } catch {
    // Malformed JSON fallback: return raw text
  }

  return { suggestions: [], improvedInstructions: resultText.trim() }
})
```

- [ ] **Step 2: Verify endpoint loads**

Run dev server, then:

```bash
curl -X POST http://localhost:3000/api/agents/improve-instructions \
  -H 'Content-Type: application/json' \
  -d '{"name":"test","description":"test agent","currentInstructions":"You are a test agent."}'
```

Expected: JSON response with `suggestions` and `improvedInstructions`.

- [ ] **Step 3: Commit**

```bash
git add server/api/agents/improve-instructions.post.ts
git commit -m "feat: add /api/agents/improve-instructions endpoint"
```

---

## Task 8: Agent Studio Page

**Files:**
- Modify: `app/pages/agents/[slug].vue`

- [ ] **Step 1: Rewrite `agents/[slug].vue` as studio layout**

Replace the entire file. This is the core of the studio — a slim shell that composes EditorPanel, TestPanel, and ExecutionInspector:

```vue
<script setup lang="ts">
import type { AgentFrontmatter, AgentSkill } from '~/types'

const route = useRoute()
const router = useRouter()
const slug = route.params.slug as string

const { fetchOne, update, remove } = useAgents()
const { clearChat: clearStudioChat, toolCalls, isStreaming: studioStreaming } = useStudioChat()

const frontmatter = ref<AgentFrontmatter>({ name: '', description: '' })
const body = ref('')
const savedBody = ref('')
const savedFrontmatter = ref<AgentFrontmatter>({ name: '', description: '' })
const loading = ref(true)
const saving = ref(false)
const lastModified = ref<number | null>(null)
const skills = ref<AgentSkill[]>([])
const loadingSkills = ref(false)

const isDirty = computed(() => {
  return body.value !== savedBody.value ||
    JSON.stringify(frontmatter.value) !== JSON.stringify(savedFrontmatter.value)
})

const isDraft = computed(() => body.value !== savedBody.value)

// Load agent
async function loadAgent() {
  loading.value = true
  try {
    const agent = await fetchOne(slug) as Record<string, unknown>
    const fm = agent.frontmatter as AgentFrontmatter
    frontmatter.value = { ...fm }
    savedFrontmatter.value = { ...fm }
    body.value = agent.body as string
    savedBody.value = agent.body as string
    lastModified.value = (agent.lastModified as number) || null
  } catch {
    router.push('/agents')
  } finally {
    loading.value = false
  }
}

async function loadSkills() {
  loadingSkills.value = true
  try {
    skills.value = await $fetch<AgentSkill[]>(`/api/agents/${slug}/skills`)
  } catch {
    skills.value = []
  } finally {
    loadingSkills.value = false
  }
}

onMounted(() => {
  loadAgent()
  loadSkills()
  clearStudioChat()
})

// Save
async function save() {
  saving.value = true
  try {
    const result = await $fetch<{ slug: string; lastModified?: number }>(`/api/agents/${slug}`, {
      method: 'PUT',
      body: {
        frontmatter: frontmatter.value,
        body: body.value,
        ...(lastModified.value ? { lastModified: lastModified.value } : {}),
      },
    })

    savedFrontmatter.value = { ...frontmatter.value }
    savedBody.value = body.value
    lastModified.value = result.lastModified || null

    // If slug changed (due to name change), redirect to new slug
    if (result.slug !== slug) {
      router.push(`/agents/${result.slug}`)
    }
  } catch (e: unknown) {
    console.error('Failed to save:', e)
  } finally {
    saving.value = false
  }
}

// Delete
const showDeleteConfirm = ref(false)
async function handleDelete() {
  await remove(slug)
  router.push('/agents')
}

// Cmd+S
function handleKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault()
    if (isDirty.value && !saving.value) save()
  }
}
onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))

useUnsavedChanges(isDirty)
</script>

<template>
  <div class="h-[calc(100vh-4rem)] flex flex-col">
    <!-- Top bar -->
    <div class="shrink-0 flex items-center justify-between px-6 py-3 border-b" style="border-color: var(--border-subtle);">
      <div class="flex items-center gap-3">
        <NuxtLink to="/agents" class="p-1 rounded-md hover-bg" style="color: var(--text-tertiary);">
          <UIcon name="i-lucide-arrow-left" class="size-4" />
        </NuxtLink>
        <div
          class="size-3 rounded-full"
          :style="{ background: frontmatter.color || 'var(--accent)' }"
        />
        <h1 class="text-[16px] font-semibold tracking-tight" style="color: var(--text-primary); font-family: var(--font-display);">
          {{ frontmatter.name || 'Agent' }}
        </h1>
        <span
          v-if="isDirty"
          class="text-[9px] font-mono px-1.5 py-px rounded-full"
          style="background: rgba(229, 169, 62, 0.1); color: var(--accent);"
        >
          Unsaved
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all"
          :style="{
            background: isDirty ? 'var(--accent)' : 'var(--surface-raised)',
            color: isDirty ? 'white' : 'var(--text-disabled)',
            border: isDirty ? 'none' : '1px solid var(--border-subtle)',
          }"
          :disabled="!isDirty || saving"
          @click="save"
        >
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
        <button
          class="p-1.5 rounded-lg hover-bg transition-all"
          style="color: var(--text-disabled);"
          title="Delete agent"
          @click="showDeleteConfirm = true"
        >
          <UIcon name="i-lucide-trash-2" class="size-4" />
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" style="color: var(--text-disabled);" />
    </div>

    <!-- Studio panels -->
    <div v-else class="flex-1 flex min-h-0">
      <!-- Left: Editor -->
      <div class="w-[60%] flex flex-col border-r" style="border-color: var(--border-subtle);">
        <EditorPanel
          :frontmatter="frontmatter"
          :body="body"
          :skills="skills"
          :loading-skills="loadingSkills"
          @update:frontmatter="frontmatter = $event"
          @update:body="body = $event"
        />
      </div>

      <!-- Right: Test + Inspector -->
      <div class="w-[40%] flex flex-col">
        <div class="flex-1 min-h-0">
          <TestPanel
            :agent-slug="slug"
            :agent-name="frontmatter.name"
            :is-draft="isDraft"
          />
        </div>
        <ExecutionInspector
          :tool-calls="toolCalls"
          :is-streaming="studioStreaming"
        />
      </div>
    </div>

    <!-- Delete confirmation -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 flex items-center justify-center" style="background: rgba(0,0,0,0.4);">
        <div class="rounded-2xl p-6 max-w-sm w-full mx-4 space-y-4" style="background: var(--surface-raised); border: 1px solid var(--border-subtle);">
          <h3 class="text-[15px] font-semibold" style="color: var(--text-primary);">Delete {{ frontmatter.name }}?</h3>
          <p class="text-[13px]" style="color: var(--text-secondary);">This will permanently delete this agent and cannot be undone.</p>
          <div class="flex gap-2 justify-end">
            <button class="px-3 py-1.5 rounded-lg text-[12px] font-medium hover-bg" style="color: var(--text-tertiary);" @click="showDeleteConfirm = false">Cancel</button>
            <button class="px-3 py-1.5 rounded-lg text-[12px] font-medium" style="background: var(--error); color: white;" @click="handleDelete">Delete</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
```

- [ ] **Step 2: Verify the studio layout**

Run dev server and navigate to an existing agent. Verify:
1. Left panel shows instruction editor with tabs (Instructions, Settings, Skills)
2. Right panel shows the test chat
3. Bottom of right panel has the execution inspector (collapsed by default)
4. Save button works
5. Cmd+S works
6. Back arrow navigates to /agents
7. Delete confirmation works

- [ ] **Step 3: Commit**

```bash
git add app/pages/agents/\\[slug\\].vue
git commit -m "feat: rewrite agent detail as Agent Studio with editor, live test, and execution inspector"
```

---

## Task 9: Conversation History Backend

**Files:**
- Create: `app/composables/useAgentHistory.ts`
- Create: `server/api/agents/[slug]/history.get.ts`
- Create: `server/api/agents/[slug]/history/[id].get.ts`
- Create: `server/api/agents/[slug]/history/[id].delete.ts`

- [ ] **Step 1: Create history list endpoint**

```typescript
// server/api/agents/[slug]/history.get.ts
// NOTE: resolveClaudePath is auto-imported by Nitro from server/utils/
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

interface ConversationSummary {
  id: string
  agentSlug: string
  messageCount: number
  firstUserMessage: string
  createdAt: string
}

export default defineEventHandler(async (event): Promise<ConversationSummary[]> => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, message: 'slug is required' })

  const historyDir = resolveClaudePath('agent-history', slug)
  if (!existsSync(historyDir)) return []

  const files = await readdir(historyDir)
  const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse()

  const summaries: ConversationSummary[] = []

  for (const file of jsonFiles.slice(0, 50)) {
    try {
      const raw = await readFile(join(historyDir, file), 'utf-8')
      const session = JSON.parse(raw)
      const userMessages = (session.messages || []).filter((m: { role: string }) => m.role === 'user')
      summaries.push({
        id: session.id || file.replace('.json', ''),
        agentSlug: slug,
        messageCount: (session.messages || []).length,
        firstUserMessage: userMessages[0]?.content || '',
        createdAt: session.createdAt || file.replace('.json', ''),
      })
    } catch {
      // Skip malformed files
    }
  }

  return summaries
})
```

- [ ] **Step 2: Create history detail endpoint**

```typescript
// server/api/agents/[slug]/history/[id].get.ts
// NOTE: resolveClaudePath is auto-imported by Nitro from server/utils/
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const id = getRouterParam(event, 'id')
  if (!slug || !id) throw createError({ statusCode: 400, message: 'slug and id are required' })

  const filePath = resolveClaudePath('agent-history', slug, `${id}.json`)
  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw)
})
```

- [ ] **Step 3: Create history delete endpoint**

```typescript
// server/api/agents/[slug]/history/[id].delete.ts
// NOTE: resolveClaudePath is auto-imported by Nitro from server/utils/
import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const id = getRouterParam(event, 'id')
  if (!slug || !id) throw createError({ statusCode: 400, message: 'slug and id are required' })

  const filePath = resolveClaudePath('agent-history', slug, `${id}.json`)
  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  await unlink(filePath)
  return { deleted: true, id }
})
```

- [ ] **Step 4: Create `useAgentHistory.ts` composable**

```typescript
// app/composables/useAgentHistory.ts
import type { ConversationSummary, ConversationSession } from '~/types'

export function useAgentHistory(agentSlug: string) {
  const sessions = ref<ConversationSummary[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchHistory() {
    loading.value = true
    error.value = null
    try {
      sessions.value = await $fetch<ConversationSummary[]>(`/api/agents/${agentSlug}/history`)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to load history'
    } finally {
      loading.value = false
    }
  }

  async function fetchSession(id: string) {
    return await $fetch<ConversationSession>(`/api/agents/${agentSlug}/history/${id}`)
  }

  async function deleteSession(id: string) {
    await $fetch(`/api/agents/${agentSlug}/history/${id}`, { method: 'DELETE' })
    sessions.value = sessions.value.filter(s => s.id !== id)
  }

  return {
    sessions: readonly(sessions),
    loading: readonly(loading),
    error: readonly(error),
    fetchHistory,
    fetchSession,
    deleteSession,
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add app/composables/useAgentHistory.ts server/api/agents/\\[slug\\]/history.get.ts server/api/agents/\\[slug\\]/history/
git commit -m "feat: add conversation history API and composable"
```

---

## Task 10: Page Parity Lift

**Files:**
- Modify: `app/pages/skills/index.vue`
- Modify: `app/pages/plugins/index.vue`
- Modify: `app/pages/workflows/index.vue`

This task brings the three index pages up to the same standard as the agents list — consistent search, cards, and empty states. Since these are full-page rewrites with visual polish, the implementer should:

- [ ] **Step 1: Add search to skills/index.vue**

At the top of the `<script setup>`, add a `search` ref and computed `filteredSkills`:

```typescript
const search = ref('')
const filteredSkills = computed(() => {
  if (!search.value.trim()) return skills.value
  const q = search.value.toLowerCase()
  return skills.value.filter(s =>
    s.frontmatter.name.toLowerCase().includes(q) ||
    s.frontmatter.description.toLowerCase().includes(q)
  )
})
```

Then in the template, add a search input before the skills grid and use `filteredSkills` instead of `skills` for the `v-for`.

- [ ] **Step 2: Add search to plugins/index.vue**

Same pattern — add `search` ref, `filteredPlugins` computed, search input in template.

- [ ] **Step 3: Add search to workflows/index.vue**

Same pattern — add `search` ref, `filteredWorkflows` computed, search input in template.

- [ ] **Step 4: Verify all three pages**

Run dev server and check:
1. Skills page has working search
2. Plugins page has working search
3. Workflows page has working search
4. Empty states still display correctly when no items exist

- [ ] **Step 5: Commit**

```bash
git add app/pages/skills/index.vue app/pages/plugins/index.vue app/pages/workflows/index.vue
git commit -m "feat: add search filtering to skills, plugins, and workflows pages"
```

---

## Verification Checklist

After all tasks are complete, verify end-to-end:

- [ ] Dashboard loads with stats
- [ ] Agent list page works
- [ ] Clicking an agent opens the Studio layout
- [ ] Studio: Instructions tab edits agent body
- [ ] Studio: Settings tab edits frontmatter fields
- [ ] Studio: Skills tab shows agent skills
- [ ] Studio: Test panel sends messages and shows responses
- [ ] Studio: Execution inspector shows tool calls
- [ ] Studio: "Improve with Claude" button works
- [ ] Studio: Save button persists changes
- [ ] Studio: Cmd+S shortcut works
- [ ] Studio: Delete agent works
- [ ] Global chat panel (Cmd+J) works independently from studio chat
- [ ] Explore page loads (templates tab + extensions tab)
- [ ] `/templates` redirects to `/explore`
- [ ] Skills, plugins, workflows pages have search
- [ ] History endpoints respond correctly
