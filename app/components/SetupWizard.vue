<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
const emit = defineEmits<{ complete: [] }>()

const { claudeDir, load: reloadConfig } = useClaudeDir()
const toast = useToast()

const step = ref<'welcome' | 'creating' | 'done'>('welcome')

/**
 * What this machine is missing, said on the first screen rather than at the
 * moment something fails.
 *
 * Both of these were already checked by `/api/system/health` and neither was
 * read here, so the one screen a brand-new user sees was the one place that
 * never mentioned them. Somebody who installs this without Claude Code gets an
 * interface that looks complete and runs nothing, with nothing anywhere saying
 * why — the same silent-cliff shape as the welcome that could not appear.
 *
 * Reported, not enforced. The folder is still worth creating, the settings are
 * still worth a look, and refusing to continue over a missing tool would be a
 * worse first five minutes than saying what to install.
 */
const health = ref<{ git: boolean; gitVersion: string; claudeCli: boolean } | null>(null)
const checked = ref(false)

onMounted(async () => {
  health.value = await $fetch<{ git: boolean; gitVersion: string; claudeCli: boolean }>(
    '/api/system/health',
  ).catch(() => null)
  checked.value = true
})

/**
 * Deliberately only listed when something is actually absent.
 *
 * A checklist of green ticks on a machine that is fine is noise on the one
 * screen that should be about getting started.
 */
const missing = computed(() => {
  if (!health.value) return []

  const gaps: { label: string; why: string; fix: string }[] = []

  if (!health.value.claudeCli) {
    gaps.push({
      label: 'Claude Code',
      // `findClaude` proves the command runs, which is not the same as being
      // signed in — so this says installed, and mentions the rest as a check
      // rather than claiming to have verified it.
      why: 'Everything here runs through your Claude Code login. Without it, nothing you start will run.',
      fix: 'Install Claude Code and sign in, then reload this page.',
    })
  }

  if (!health.value.git) {
    gaps.push({
      label: 'git',
      why: 'Sessions work on a copy of your repository, and installing your team\'s tools clones them.',
      fix: 'Install git, then reload this page.',
    })
  }

  return gaps
})

async function createDirectory() {
  step.value = 'creating'
  try {
    await $fetch('/api/setup', { method: 'POST' })
    await reloadConfig()
    step.value = 'done'
    toast.add({ title: 'Claude directory created', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Failed to create directory', description: errorMessage(e), color: 'error' })
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
            class="size-16 rounded-xl flex items-center justify-center"
            style="background: linear-gradient(135deg, var(--accent-muted) 0%, var(--accent-muted) 100%); border: 1px solid var(--accent-muted);"
          >
            <UIcon name="i-lucide-bot" class="size-7" style="color: var(--accent);" />
          </div>
        </div>

        <div class="space-y-2">
          <h2 class="text-[24px] font-semibold tracking-tight" style="font-family: var(--font-display);">
            Set up Agents Studio
          </h2>
          <p class="type-body leading-relaxed max-w-sm mx-auto">
            Agents Studio reads the folder Claude Code already keeps your configuration in. Point it at that one and everything you have shows up.
          </p>
        </div>

        <div
          class="rounded-lg p-4 text-left space-y-3 mx-auto max-w-sm"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        >
          <div class="flex items-center gap-3">
            <UIcon name="i-lucide-folder" class="size-4 shrink-0 text-meta" />
            <code class="font-mono text-[12px]" style="color: var(--text-secondary);">{{ claudeDir }}</code>
          </div>
          <div class="space-y-1.5 pl-7">
            <div class="flex items-center gap-2 type-detail">
              <UIcon name="i-lucide-cpu" class="size-3 shrink-0" style="color: var(--accent);" />
              <span><code class="font-mono text-[11px]">agents/</code> — your AI assistants</span>
            </div>
            <div class="flex items-center gap-2 type-detail">
              <UIcon name="i-lucide-terminal" class="size-3 shrink-0" style="color: var(--accent);" />
              <span><code class="font-mono text-[11px]">commands/</code> — reusable workflows</span>
            </div>
            <div class="flex items-center gap-2 type-detail">
              <UIcon name="i-lucide-sparkles" class="size-3 shrink-0" style="color: var(--accent);" />
              <span><code class="font-mono text-[11px]">skills/</code> — specialized capabilities</span>
            </div>
          </div>
        </div>

        <!--
          Said here because here is the only screen a brand-new person sees.
          Not a blocker: the folder is still worth making, and refusing to go on
          over a missing tool is a worse first five minutes than being told what
          to install.
        -->
        <div
          v-if="checked && missing.length"
          class="rounded-lg p-4 text-left space-y-3 mx-auto max-w-sm"
          style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
        >
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0" style="color: var(--warning);" />
            <span class="type-strong">
              {{ missing.length === 1 ? 'One thing is missing' : `${missing.length} things are missing` }}
            </span>
          </div>

          <div v-for="gap in missing" :key="gap.label" class="space-y-0.5">
            <div class="type-detail" style="color: var(--text-primary);">
              <span class="font-mono">{{ gap.label }}</span> isn't installed on this machine.
            </div>
            <p class="type-meta">{{ gap.why }}</p>
            <p class="type-meta" style="color: var(--text-secondary);">{{ gap.fix }}</p>
          </div>
        </div>

        <div class="flex flex-col items-center gap-3">
          <UButton label="Create folder and get started" icon="i-lucide-folder-plus" size="md" @click="createDirectory" />
          <p class="type-meta">
            Already have a Claude Code setup? Change the path in
            <NuxtLink to="/settings" style="color: var(--accent); text-decoration: underline; text-underline-offset: 2px;">Settings</NuxtLink>.
          </p>
        </div>
      </div>

      <!-- Step 2: Creating -->
      <div v-else-if="step === 'creating'" class="flex flex-col items-center gap-4">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin" style="color: var(--accent);" />
        <p class="type-body">Setting up your workspace...</p>
      </div>

      <!-- Step 3: Done -->
      <div v-else class="space-y-6 text-center">
        <div class="flex justify-center">
          <div
            class="size-16 rounded-xl flex items-center justify-center"
            style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.15);"
          >
            <UIcon name="i-lucide-check" class="size-7" style="color: var(--success, #22c55e);" />
          </div>
        </div>

        <div class="space-y-2">
          <h2 class="text-[24px] font-semibold tracking-tight" style="font-family: var(--font-display);">
            You're all set
          </h2>
          <p class="type-body leading-relaxed max-w-sm mx-auto">
            Your workspace is ready. Start by creating your first agent from a template, or describe what you need to the Claude assistant.
          </p>
        </div>

        <UButton label="Go to Dashboard" icon="i-lucide-arrow-right" size="md" @click="finish" />
      </div>
    </div>
  </div>
</template>
