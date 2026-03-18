<script setup lang="ts">
const emit = defineEmits<{ complete: [] }>()

const { claudeDir, exists: claudeDirExists, load: reloadConfig } = useClaudeDir()
const { settings, save: saveSettings, load: loadSettings } = useSettings()
const { fetchAll: fetchAgents, agents } = useAgents()
const { fetchAll: fetchCommands } = useCommands()
const { fetchAll: fetchPlugins } = usePlugins()
const { fetchAll: fetchSkills } = useSkills()
const toast = useToast()
const router = useRouter()

const step = ref<'welcome' | 'setup' | 'creating-dir' | 'first-agent' | 'done'>('welcome')
const chatOpen = useState('chatOpen', () => false)

onMounted(async () => {
  await loadSettings()
  // Auto-advance past setup if directory already exists
  if (claudeDirExists.value) {
    step.value = 'welcome'
  }
})

function skip() {
  finishOnboarding()
}

async function startSetup() {
  if (claudeDirExists.value) {
    step.value = 'first-agent'
  } else {
    step.value = 'setup'
  }
}

async function createDirectory() {
  step.value = 'creating-dir'
  try {
    await $fetch('/api/setup', { method: 'POST' })
    await reloadConfig()
    await Promise.all([fetchAgents(), fetchCommands(), fetchPlugins(), fetchSkills()])
    step.value = 'first-agent'
  } catch (e: any) {
    toast.add({ title: 'Failed to create directory', description: e.data?.message || e.message, color: 'error' })
    step.value = 'setup'
  }
}

function onAgentCreated() {
  step.value = 'done'
}

async function finishOnboarding() {
  try {
    await saveSettings({ ...settings.value, onboardingCompleted: true })
  } catch {
    // Non-critical
  }
  emit('complete')
}
</script>

<template>
  <div class="flex items-center justify-center min-h-[60vh]">
    <div class="max-w-lg w-full mx-auto px-6">

      <!-- Step 1: Welcome -->
      <div v-if="step === 'welcome'" class="space-y-6 text-center">
        <div class="flex justify-center">
          <div
            class="size-16 rounded-2xl flex items-center justify-center"
            style="background: linear-gradient(135deg, rgba(229, 169, 62, 0.15) 0%, rgba(229, 169, 62, 0.05) 100%); border: 1px solid rgba(229, 169, 62, 0.12);"
          >
            <UIcon name="i-lucide-sparkles" class="size-7" style="color: var(--accent);" />
          </div>
        </div>

        <div class="space-y-2">
          <h2 class="text-[20px] font-semibold tracking-tight" style="font-family: var(--font-sans);">
            Welcome to Agent Manager
          </h2>
          <p class="text-[13px] text-label leading-relaxed max-w-sm mx-auto">
            Create AI assistants that work for you. We'll help you get set up in just a minute.
          </p>
        </div>

        <div class="flex flex-col items-center gap-3">
          <UButton label="Get Started" icon="i-lucide-arrow-right" size="md" @click="startSetup" />
          <button class="text-[12px] text-meta hover:text-label transition-colors" @click="skip">
            Skip for now
          </button>
        </div>
      </div>

      <!-- Step 2: Setup Check -->
      <div v-else-if="step === 'setup'" class="space-y-6 text-center">
        <div class="flex justify-center">
          <div
            class="size-16 rounded-2xl flex items-center justify-center"
            style="background: linear-gradient(135deg, rgba(229, 169, 62, 0.15) 0%, rgba(229, 169, 62, 0.05) 100%); border: 1px solid rgba(229, 169, 62, 0.12);"
          >
            <UIcon name="i-lucide-folder-plus" class="size-7" style="color: var(--accent);" />
          </div>
        </div>

        <div class="space-y-2">
          <h2 class="text-[18px] font-semibold tracking-tight" style="font-family: var(--font-sans);">
            Set up your workspace
          </h2>
          <p class="text-[13px] text-label leading-relaxed max-w-sm mx-auto">
            We need to create a folder to store your agents and settings. This is the same folder Claude Code uses.
          </p>
        </div>

        <div
          class="rounded-xl p-4 text-left mx-auto max-w-sm"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        >
          <div class="flex items-center gap-3">
            <UIcon name="i-lucide-folder" class="size-4 shrink-0 text-meta" />
            <code class="font-mono text-[12px]" style="color: var(--text-secondary);">{{ claudeDir }}</code>
          </div>
        </div>

        <div class="flex flex-col items-center gap-3">
          <UButton label="Create folder" icon="i-lucide-folder-plus" size="md" @click="createDirectory" />
          <button class="text-[12px] text-meta hover:text-label transition-colors" @click="skip">
            Skip
          </button>
        </div>
      </div>

      <!-- Creating directory -->
      <div v-else-if="step === 'creating-dir'" class="flex flex-col items-center gap-4">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin" style="color: var(--accent);" />
        <p class="text-[13px] text-label">Setting up your workspace...</p>
      </div>

      <!-- Step 3: Create first agent -->
      <div v-else-if="step === 'first-agent'" class="space-y-4">
        <div class="text-center space-y-2 mb-4">
          <h2 class="text-[18px] font-semibold tracking-tight" style="font-family: var(--font-sans);">
            Create your first agent
          </h2>
          <p class="text-[13px] text-label">
            Pick a template or describe what you need.
          </p>
        </div>
        <AgentWizard
          @saved="onAgentCreated"
          @cancel="finishOnboarding"
        />
      </div>

      <!-- Step 4: Done -->
      <div v-else-if="step === 'done'" class="space-y-6 text-center">
        <div class="flex justify-center">
          <div
            class="size-16 rounded-2xl flex items-center justify-center"
            style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.15);"
          >
            <UIcon name="i-lucide-check" class="size-7" style="color: var(--success, #22c55e);" />
          </div>
        </div>

        <div class="space-y-2">
          <h2 class="text-[20px] font-semibold tracking-tight" style="font-family: var(--font-sans);">
            You're all set!
          </h2>
          <p class="text-[13px] text-label leading-relaxed max-w-sm mx-auto">
            Your first agent is ready. You can find it in My Agents, or chat with Claude anytime by pressing <kbd class="text-[10px] font-mono px-1 py-px rounded" style="background: var(--badge-subtle-bg);">&#x2318;J</kbd>.
          </p>
        </div>

        <UButton label="Go to Home" icon="i-lucide-arrow-right" size="md" @click="finishOnboarding" />
      </div>
    </div>
  </div>
</template>
