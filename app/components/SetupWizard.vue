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
            <UIcon name="i-lucide-bot" class="size-7 ink-accent" />
          </div>
        </div>

        <div class="space-y-2">
          <h2 class="fs-title font-bold" style="font-family: var(--font-display);">
            Set up Agents Studio
          </h2>
          <p class="type-body leading-relaxed max-w-sm mx-auto">
            It runs Claude Code against your own repositories — on a schedule, or when you
            ask. Everything it reads and writes is a real file or a real branch.
          </p>
        </div>

        <!--
          What the app does, not what lives in which directory.

          This used to be a legend for `agents/`, `commands/` and `skills/` —
          the three-way split the Library exists to dissolve, on the one screen
          nobody has the context to care about it yet. Whatever is in that folder
          shows up on its own; the thing worth saying first is what happens to a
          repository once you point this at one.
        -->
        <div
          class="rounded-lg p-4 text-left space-y-3 mx-auto max-w-sm"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        >
          <div class="space-y-2">
            <div class="flex items-start gap-2.5 type-detail">
              <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0 mt-px ink-accent" />
              <span>Work runs on its own copy of your repository. Nothing touches your files until you merge.</span>
            </div>
            <div class="flex items-start gap-2.5 type-detail">
              <UIcon name="i-lucide-circle-check" class="size-3.5 shrink-0 mt-px ink-accent" />
              <span>It runs your own checks, fixes what it can, and stops when it cannot.</span>
            </div>
            <div class="flex items-start gap-2.5 type-detail">
              <UIcon name="i-lucide-alarm-clock" class="size-3.5 shrink-0 mt-px ink-accent" />
              <span>It can fire on a schedule, so you come back to what it did and what it cost.</span>
            </div>
          </div>

          <!-- The folder, once, as a fact about this machine rather than a lesson. -->
          <div class="flex items-center gap-2.5 pt-3" style="border-top: 1px solid var(--border-subtle);">
            <UIcon name="i-lucide-folder" class="size-3.5 shrink-0 text-meta" />
            <code class="font-mono fs-mono ink-2 truncate">{{ claudeDir }}</code>
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
            <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0 ink-warn" />
            <span class="type-strong">
              {{ missing.length === 1 ? 'One thing is missing' : `${missing.length} things are missing` }}
            </span>
          </div>

          <div v-for="gap in missing" :key="gap.label" class="space-y-0.5">
            <div class="type-detail ink">
              <span class="font-mono">{{ gap.label }}</span> isn't installed on this machine.
            </div>
            <p class="type-meta">{{ gap.why }}</p>
            <p class="type-meta ink-2">{{ gap.fix }}</p>
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
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin ink-accent" />
        <p class="type-body">Creating the folder…</p>
      </div>

      <!-- Step 3: Done -->
      <div v-else class="space-y-6 text-center">
        <div class="flex justify-center">
          <div
            class="size-16 rounded-xl flex items-center justify-center"
            style="background: var(--success-tint); border: 1px solid var(--success-tint);"
          >
            <UIcon name="i-lucide-check" class="size-7" style="color: var(--success, #22c55e);" />
          </div>
        </div>

        <div class="space-y-2">
          <h2 class="fs-title font-bold" style="font-family: var(--font-display);">
            The folder is ready
          </h2>
          <!--
            The next move, named. This used to say "create your first agent from
            a template", which is neither the next thing that has to happen nor
            something this app can do anything with until it knows which
            repository you mean.
          -->
          <p class="type-body leading-relaxed max-w-sm mx-auto">
            Pick the repository you want Claude to work in — the folder control is at the
            bottom of the sidebar. Then start a session from Work.
          </p>
        </div>

        <UButton label="Go to Now" icon="i-lucide-arrow-right" size="md" @click="finish" />
      </div>
    </div>
  </div>
</template>
