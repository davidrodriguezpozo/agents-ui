<script setup lang="ts">
import type { PermissionMode } from '~/types'
import { AVAILABLE_TOOLS } from '~/types'

/**
 * Controls that decide how faithfully a test run matches the real CLI: which
 * tools are on the table, how permissions are handled, how many turns it gets,
 * and whether settings/CLAUDE.md on disk are loaded.
 */
const { runConfig } = useStudioChat()

const open = ref(false)

const PERMISSION_MODES: { value: PermissionMode; label: string; hint: string }[] = [
  { value: 'default', label: 'Ask', hint: 'Stops on anything that needs approval — closest to a fresh CLI session.' },
  { value: 'acceptEdits', label: 'Accept edits', hint: 'Auto-approves file edits, still stops for riskier tools.' },
  { value: 'plan', label: 'Plan only', hint: 'Read-only: the agent plans but changes nothing.' },
  { value: 'bypassPermissions', label: 'Bypass all', hint: 'Approves everything, including Bash. Use with care.' },
]

const allTools = [...AVAILABLE_TOOLS]

const restrictTools = computed({
  get: () => Boolean(runConfig.value.allowedTools?.length),
  set: (value: boolean) => {
    runConfig.value = {
      ...runConfig.value,
      allowedTools: value ? [...allTools] : undefined,
    }
  },
})

function toggleTool(tool: string) {
  const current = runConfig.value.allowedTools ?? [...allTools]
  const next = current.includes(tool)
    ? current.filter(t => t !== tool)
    : [...current, tool]
  runConfig.value = { ...runConfig.value, allowedTools: next }
}

function isToolEnabled(tool: string): boolean {
  const allowed = runConfig.value.allowedTools
  return !allowed?.length || allowed.includes(tool)
}

const summary = computed(() => {
  const mode = PERMISSION_MODES.find(m => m.value === runConfig.value.permissionMode)?.label ?? 'Ask'
  const tools = runConfig.value.allowedTools?.length
    ? `${runConfig.value.allowedTools.length} tools`
    : 'all tools'
  return `${mode} · ${tools} · ${runConfig.value.maxTurns} turns`
})
</script>

<template>
  <div class="border-b" style="border-color: var(--border-subtle);">
    <button
      class="w-full flex items-center gap-2 px-4 py-2 text-left hover-bg transition-all"
      @click="open = !open"
    >
      <UIcon
        :name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        class="size-3"
        style="color: var(--text-disabled);"
      />
      <UIcon name="i-lucide-sliders-horizontal" class="size-3 ink-4" />
      <span class="fs-mono font-mono ink-3">Run settings</span>
      <span class="ml-auto fs-micro font-mono truncate ink-4">{{ summary }}</span>
    </button>

    <div v-if="open" class="px-4 pb-4 space-y-4">
      <!-- Permission mode -->
      <div class="space-y-1.5">
        <label class="fs-micro font-medium uppercase tracking-wider ink-4">
          Permissions
        </label>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="mode in PERMISSION_MODES"
            :key="mode.value"
            class="px-2 py-1 rounded-md fs-mono font-medium transition-all"
            :title="mode.hint"
            :style="{
              background: runConfig.permissionMode === mode.value ? 'var(--accent-muted)' : 'var(--surface-raised)',
              border: '1px solid ' + (runConfig.permissionMode === mode.value ? 'var(--accent-glow)' : 'var(--border-subtle)'),
              color: runConfig.permissionMode === mode.value ? 'var(--accent)' : 'var(--text-secondary)',
            }"
            @click="runConfig = { ...runConfig, permissionMode: mode.value }"
          >
            {{ mode.label }}
          </button>
        </div>
        <p class="fs-micro leading-relaxed ink-4">
          {{ PERMISSION_MODES.find(m => m.value === runConfig.permissionMode)?.hint }}
        </p>
      </div>

      <!-- Tools -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label class="fs-micro font-medium uppercase tracking-wider ink-4">
            Tools
          </label>
          <label class="flex items-center gap-1.5 fs-micro ink-3">
            <input v-model="restrictTools" type="checkbox" class="size-3" />
            Restrict
          </label>
        </div>
        <p v-if="!restrictTools" class="fs-micro leading-relaxed ink-4">
          Every tool the CLI offers, minus anything the agent's own <code>tools:</code> frontmatter restricts.
        </p>
        <div v-else class="flex flex-wrap gap-1">
          <button
            v-for="tool in allTools"
            :key="tool"
            class="px-1.5 py-0.5 rounded fs-micro font-mono transition-all"
            :style="{
              background: isToolEnabled(tool) ? 'var(--accent-muted)' : 'var(--surface-raised)',
              color: isToolEnabled(tool) ? 'var(--accent)' : 'var(--text-disabled)',
              border: '1px solid ' + (isToolEnabled(tool) ? 'var(--accent-glow)' : 'var(--border-subtle)'),
            }"
            @click="toggleTool(tool)"
          >
            {{ tool }}
          </button>
        </div>
      </div>

      <!-- Turns + settings sources -->
      <div class="flex items-center gap-4">
        <div class="space-y-1 flex-1">
          <label class="fs-micro font-medium uppercase tracking-wider ink-4">
            Max turns
          </label>
          <input
            :value="runConfig.maxTurns"
            type="number"
            min="1"
            max="200"
            class="field-input fs-sm"
            @input="runConfig = { ...runConfig, maxTurns: Math.max(1, Math.min(Number(($event.target as HTMLInputElement).value) || 1, 200)) }"
          />
        </div>
        <label class="flex items-start gap-2 flex-1 fs-mono cursor-pointer ink-2">
          <input
            :checked="runConfig.loadProjectSettings"
            type="checkbox"
            class="size-3 mt-0.5"
            @change="runConfig = { ...runConfig, loadProjectSettings: ($event.target as HTMLInputElement).checked }"
          />
          <span>
            Load real config
            <span class="block fs-micro ink-4">
              settings.json, CLAUDE.md and project rules — as the CLI would
            </span>
          </span>
        </label>
      </div>
    </div>
  </div>
</template>
