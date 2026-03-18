<script setup lang="ts">
const emit = defineEmits<{ complete: [] }>()

const { claudeDir, load: reloadConfig } = useClaudeDir()
const toast = useToast()

const step = ref<'welcome' | 'creating' | 'done'>('welcome')

async function createDirectory() {
  step.value = 'creating'
  try {
    await $fetch('/api/setup', { method: 'POST' })
    await reloadConfig()
    step.value = 'done'
    toast.add({ title: 'Claude directory created', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Failed to create directory', description: e.data?.message || e.message, color: 'error' })
    step.value = 'welcome'
  }
}

function finish() {
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
            <UIcon name="i-lucide-bot" class="size-7" style="color: var(--accent);" />
          </div>
        </div>

        <div class="space-y-2">
          <h2 class="text-[24px] font-semibold tracking-tight" style="font-family: var(--font-display);">
            Set up Agent Manager
          </h2>
          <p class="text-[13px] text-label leading-relaxed max-w-sm mx-auto">
            Agent Manager needs a folder to store your agents, commands, and skills. This is the same folder Claude Code uses.
          </p>
        </div>

        <div
          class="rounded-xl p-4 text-left space-y-3 mx-auto max-w-sm"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        >
          <div class="flex items-center gap-3">
            <UIcon name="i-lucide-folder" class="size-4 shrink-0 text-meta" />
            <code class="font-mono text-[12px]" style="color: var(--text-secondary);">{{ claudeDir }}</code>
          </div>
          <div class="space-y-1.5 pl-7">
            <div class="flex items-center gap-2 text-[12px] text-label">
              <UIcon name="i-lucide-cpu" class="size-3 shrink-0" style="color: var(--accent);" />
              <span><code class="font-mono text-[11px]">agents/</code> — your AI assistants</span>
            </div>
            <div class="flex items-center gap-2 text-[12px] text-label">
              <UIcon name="i-lucide-terminal" class="size-3 shrink-0" style="color: var(--accent);" />
              <span><code class="font-mono text-[11px]">commands/</code> — reusable workflows</span>
            </div>
            <div class="flex items-center gap-2 text-[12px] text-label">
              <UIcon name="i-lucide-sparkles" class="size-3 shrink-0" style="color: var(--accent);" />
              <span><code class="font-mono text-[11px]">skills/</code> — specialized capabilities</span>
            </div>
          </div>
        </div>

        <div class="flex flex-col items-center gap-3">
          <UButton label="Create folder and get started" icon="i-lucide-folder-plus" size="md" @click="createDirectory" />
          <p class="text-[11px] text-meta">
            Already have a Claude Code setup? Change the path in
            <NuxtLink to="/settings" style="color: var(--accent); text-decoration: underline; text-underline-offset: 2px;">Settings</NuxtLink>.
          </p>
        </div>
      </div>

      <!-- Step 2: Creating -->
      <div v-else-if="step === 'creating'" class="flex flex-col items-center gap-4">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin" style="color: var(--accent);" />
        <p class="text-[13px] text-label">Setting up your workspace...</p>
      </div>

      <!-- Step 3: Done -->
      <div v-else class="space-y-6 text-center">
        <div class="flex justify-center">
          <div
            class="size-16 rounded-2xl flex items-center justify-center"
            style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.15);"
          >
            <UIcon name="i-lucide-check" class="size-7" style="color: var(--success, #22c55e);" />
          </div>
        </div>

        <div class="space-y-2">
          <h2 class="text-[24px] font-semibold tracking-tight" style="font-family: var(--font-display);">
            You're all set
          </h2>
          <p class="text-[13px] text-label leading-relaxed max-w-sm mx-auto">
            Your workspace is ready. Start by creating your first agent from a template, or describe what you need to the Claude assistant.
          </p>
        </div>

        <UButton label="Go to Dashboard" icon="i-lucide-arrow-right" size="md" @click="finish" />
      </div>
    </div>
  </div>
</template>
