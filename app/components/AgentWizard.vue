<script setup lang="ts">
import type { Agent, AgentFrontmatter, AgentModel, AgentMemory } from '~/types'

const emit = defineEmits<{
  saved: [agent: Agent]
  cancel: []
}>()

const { create } = useAgents()
const toast = useToast()

const step = ref(1)
const saving = ref(false)
const totalSteps = 3

const frontmatter = ref<AgentFrontmatter>({
  name: '',
  description: '',
  model: 'sonnet',
})
const body = ref('')

// Validation
const nameError = computed(() => {
  const name = frontmatter.value.name.trim()
  if (!name) return 'Give your agent a name'
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return 'Use lowercase letters, numbers, and hyphens (e.g., email-helper)'
  return null
})

const descError = computed(() => {
  if (!frontmatter.value.description.trim()) return 'Describe what this agent does'
  return null
})

const canProceed = computed(() => {
  if (step.value === 1) return !nameError.value && !descError.value
  return true
})

function next() {
  if (!canProceed.value) return
  if (step.value < totalSteps) step.value++
}

function back() {
  if (step.value > 1) step.value--
}

async function finish() {
  saving.value = true
  try {
    const agent = await create({ frontmatter: frontmatter.value, body: body.value })
    toast.add({ title: `${frontmatter.value.name} created`, color: 'success' })
    emit('saved', agent)
  } catch (e: any) {
    toast.add({ title: 'Failed to create agent', description: e.data?.message || e.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

const modelOptions: { value: AgentModel | undefined; label: string; desc: string }[] = [
  { value: 'sonnet', label: 'Sonnet', desc: 'Best balance of speed and quality. Good for most tasks.' },
  { value: 'opus', label: 'Opus', desc: 'Most capable. Best for complex reasoning and nuanced tasks.' },
  { value: 'haiku', label: 'Haiku', desc: 'Fastest and cheapest. Great for simple, repetitive tasks.' },
  { value: undefined, label: 'Default', desc: 'Uses whatever model is set in your Claude Code config.' },
]

const memoryOptions: { value: AgentMemory | undefined; label: string; desc: string }[] = [
  { value: undefined, label: 'No memory', desc: 'Starts fresh every conversation. Good for stateless tasks.' },
  { value: 'user', label: 'Per person', desc: 'Remembers your preferences and style across conversations.' },
  { value: 'project', label: 'Per project', desc: 'Remembers context about the project it\'s working on.' },
]
</script>

<template>
  <div class="p-6 space-y-5 bg-overlay w-[480px] max-w-full">
    <!-- Header with step indicator -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-page-title">New Agent</h3>
        <span class="text-[11px] font-mono text-meta">{{ step }}/{{ totalSteps }}</span>
      </div>
      <!-- Progress bar -->
      <div class="h-1 rounded-full overflow-hidden" style="background: var(--badge-subtle-bg);">
        <div
          class="h-full rounded-full transition-all duration-300"
          style="background: var(--accent);"
          :style="{ width: `${(step / totalSteps) * 100}%` }"
        />
      </div>
    </div>

    <!-- Step 1: Name & Purpose -->
    <div v-if="step === 1" class="space-y-4">
      <p class="text-[12px] text-label leading-relaxed">
        What should this agent be called, and what will it help you with?
      </p>

      <div class="field-group">
        <label class="field-label" data-required>Name</label>
        <input
          v-model="frontmatter.name"
          class="field-input"
          :class="{ 'field-input--error': frontmatter.name && nameError }"
          placeholder="email-helper"
        />
        <span v-if="frontmatter.name && nameError" class="field-error">{{ nameError }}</span>
        <span v-else class="field-hint">A short identifier. You'll use this to call the agent.</span>
      </div>

      <div class="field-group">
        <label class="field-label" data-required>
          What does it do?
          <HelpTip title="Good descriptions" body="A good description helps you remember what this agent does, and helps Claude know when to use it." />
        </label>
        <textarea
          v-model="frontmatter.description"
          rows="2"
          class="field-textarea"
          placeholder="Helps me draft and polish professional emails..."
        />
        <span v-if="frontmatter.description && descError" class="field-error">{{ descError }}</span>
        <span v-else class="field-hint">This helps you (and Claude) know when to use this agent.</span>
      </div>
    </div>

    <!-- Step 2: Model & Memory -->
    <div v-else-if="step === 2" class="space-y-5">
      <div class="space-y-3">
        <label class="field-label">
          Which AI model should it use?
          <HelpTip title="Which model?" body="'Fast & efficient' is great for simple tasks. 'Balanced' works for most things. 'Most capable' handles complex reasoning." />
        </label>
        <div class="space-y-1.5">
          <button
            v-for="opt in modelOptions"
            :key="opt.label"
            type="button"
            class="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150"
            :style="{
              background: frontmatter.model === opt.value ? 'var(--accent-muted)' : 'transparent',
              border: frontmatter.model === opt.value ? '1px solid rgba(229, 169, 62, 0.15)' : '1px solid var(--border-subtle)',
            }"
            @click="frontmatter.model = opt.value"
          >
            <div
              class="size-4 rounded-full shrink-0 mt-0.5 flex items-center justify-center"
              :style="{
                border: frontmatter.model === opt.value ? '2px solid var(--accent)' : '2px solid var(--border-default)',
              }"
            >
              <div
                v-if="frontmatter.model === opt.value"
                class="size-2 rounded-full"
                style="background: var(--accent);"
              />
            </div>
            <div>
              <span class="text-[13px] font-medium">{{ opt.label }}</span>
              <p class="text-[11px] text-label mt-0.5">{{ opt.desc }}</p>
            </div>
          </button>
        </div>
      </div>

      <ExampleBlock title="See what a good agent looks like">
        <div class="space-y-1.5 text-[11px]" style="color: var(--text-secondary);">
          <p><strong>Name:</strong> email-drafter</p>
          <p><strong>Instructions:</strong> "You are an email drafting assistant. Help the user write clear, professional emails. Before drafting, ask about the recipient, goal, and tone..."</p>
          <p class="text-[10px]" style="color: var(--text-tertiary);">Good instructions are specific about behavior, tone, and rules.</p>
        </div>
      </ExampleBlock>

      <div class="space-y-3">
        <label class="field-label">Should it remember things?</label>
        <div class="space-y-1.5">
          <button
            v-for="opt in memoryOptions"
            :key="opt.label"
            type="button"
            class="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150"
            :style="{
              background: frontmatter.memory === opt.value ? 'var(--accent-muted)' : 'transparent',
              border: frontmatter.memory === opt.value ? '1px solid rgba(229, 169, 62, 0.15)' : '1px solid var(--border-subtle)',
            }"
            @click="frontmatter.memory = opt.value"
          >
            <div
              class="size-4 rounded-full shrink-0 mt-0.5 flex items-center justify-center"
              :style="{
                border: frontmatter.memory === opt.value ? '2px solid var(--accent)' : '2px solid var(--border-default)',
              }"
            >
              <div
                v-if="frontmatter.memory === opt.value"
                class="size-2 rounded-full"
                style="background: var(--accent);"
              />
            </div>
            <div>
              <span class="text-[13px] font-medium">{{ opt.label }}</span>
              <p class="text-[11px] text-label mt-0.5">{{ opt.desc }}</p>
            </div>
          </button>
        </div>
      </div>
    </div>

    <!-- Step 3: Instructions -->
    <div v-else-if="step === 3" class="space-y-4">
      <p class="text-[12px] text-label leading-relaxed">
        Tell <strong class="text-body">{{ frontmatter.name }}</strong> how to behave. What tone should it use? What rules should it follow? You can always edit this later.
      </p>

      <div class="field-group">
        <textarea
          v-model="body"
          class="editor-textarea editor-textarea--standalone"
          style="min-height: 200px;"
          spellcheck="false"
          :placeholder="`You are ${frontmatter.name}. ${frontmatter.description}\n\nGuidelines:\n- ...\n- ...`"
        />
        <span class="field-hint">
          Tip: Be specific about what the agent should and shouldn't do. You can leave this blank and fill it in later.
        </span>
      </div>
    </div>

    <!-- Navigation -->
    <div class="flex items-center justify-between pt-2">
      <div>
        <UButton
          v-if="step > 1"
          label="Back"
          variant="ghost"
          color="neutral"
          size="sm"
          icon="i-lucide-arrow-left"
          @click="back"
        />
      </div>
      <div class="flex items-center gap-2">
        <UButton
          label="Cancel"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="emit('cancel')"
        />
        <UButton
          v-if="step < totalSteps"
          label="Next"
          size="sm"
          :disabled="!canProceed"
          @click="next"
        />
        <UButton
          v-else
          label="Create Agent"
          size="sm"
          :loading="saving"
          icon="i-lucide-sparkles"
          @click="finish"
        />
      </div>
    </div>
  </div>
</template>
