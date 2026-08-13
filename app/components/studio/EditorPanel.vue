<script setup lang="ts">
import type { AgentFrontmatter, AgentModel, AgentMemory, AgentSkill } from '~/types'
import { AVAILABLE_TOOLS } from '~/types'

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
  { label: 'Inherit', value: 'inherit' },
  { label: 'Opus', value: 'opus' },
  { label: 'Sonnet', value: 'sonnet' },
  { label: 'Haiku', value: 'haiku' },
]

const memoryOptions: { label: string; value: AgentMemory }[] = [
  { label: 'User', value: 'user' },
  { label: 'Project', value: 'project' },
  { label: 'None', value: 'none' },
]

const allTools = [...AVAILABLE_TOOLS]

function updateFrontmatter(key: keyof AgentFrontmatter, value: unknown) {
  emit('update:frontmatter', { ...props.frontmatter, [key]: value })
}

/**
 * `tools:` in frontmatter is what Claude Code reads to scope a subagent. An
 * empty list means "inherit everything", so we only write the key when the user
 * actually narrows it.
 */
const restrictTools = computed({
  get: () => Boolean(props.frontmatter.tools?.length),
  set: (value: boolean) => updateFrontmatter('tools', value ? allTools : undefined),
})

function toggleTool(tool: string) {
  const current = props.frontmatter.tools ?? allTools
  const next = current.includes(tool) ? current.filter(t => t !== tool) : [...current, tool]
  updateFrontmatter('tools', next.length ? next : undefined)
}

function isToolEnabled(tool: string): boolean {
  const tools = props.frontmatter.tools
  return !tools?.length || tools.includes(tool)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 flex border-b" style="border-color: var(--border-subtle);">
      <button
        v-for="tab in (['instructions', 'settings', 'skills'] as const)"
        :key="tab"
        class="px-4 py-2.5 fs-sm font-medium capitalize transition-all relative"
        :style="{ color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-tertiary)' }"
        @click="activeTab = tab"
      >
        {{ tab }}
        <div v-if="activeTab === tab" class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full" style="background: var(--accent);" />
      </button>
    </div>

    <div v-if="activeTab === 'instructions'" class="flex-1 min-h-0">
      <InstructionEditor :model-value="body" :agent-name="frontmatter.name" :agent-description="frontmatter.description" @update:model-value="emit('update:body', $event)" />
    </div>

    <div v-if="activeTab === 'settings'" class="flex-1 overflow-y-auto p-4 space-y-4">
      <div class="space-y-1">
        <label class="fs-mono font-medium ink-3">Name</label>
        <input :value="frontmatter.name" class="field-input w-full" placeholder="Agent name" @input="updateFrontmatter('name', ($event.target as HTMLInputElement).value)" />
      </div>
      <div class="space-y-1">
        <label class="fs-mono font-medium ink-3">Description</label>
        <input :value="frontmatter.description" class="field-input w-full" placeholder="What does this agent do?" @input="updateFrontmatter('description', ($event.target as HTMLInputElement).value)" />
      </div>
      <div class="space-y-1">
        <label class="fs-mono font-medium ink-3">Model</label>
        <div class="flex gap-2">
          <button v-for="opt in modelOptions" :key="opt.value" class="px-3 py-1.5 rounded-md fs-mono font-medium transition-all" :style="{ background: frontmatter.model === opt.value ? 'var(--accent-muted)' : 'var(--surface-raised)', border: '1px solid ' + (frontmatter.model === opt.value ? 'var(--accent-glow)' : 'var(--border-subtle)'), color: frontmatter.model === opt.value ? 'var(--accent)' : 'var(--text-secondary)' }" @click="updateFrontmatter('model', opt.value)">{{ opt.label }}</button>
        </div>
      </div>
      <div class="space-y-1">
        <label class="fs-mono font-medium ink-3">Memory</label>
        <div class="flex gap-2">
          <button v-for="opt in memoryOptions" :key="opt.value" class="px-3 py-1.5 rounded-md fs-mono font-medium transition-all" :style="{ background: frontmatter.memory === opt.value ? 'var(--accent-muted)' : 'var(--surface-raised)', border: '1px solid ' + (frontmatter.memory === opt.value ? 'var(--accent-glow)' : 'var(--border-subtle)'), color: frontmatter.memory === opt.value ? 'var(--accent)' : 'var(--text-secondary)' }" @click="updateFrontmatter('memory', opt.value)">{{ opt.label }}</button>
        </div>
      </div>
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <label class="fs-mono font-medium ink-3">Tools</label>
          <label class="flex items-center gap-1.5 fs-micro ink-3">
            <input v-model="restrictTools" type="checkbox" class="size-3" />
            Restrict
          </label>
        </div>
        <p v-if="!restrictTools" class="fs-micro leading-relaxed ink-4">
          Inherits every tool available to the parent session — the Claude Code default when
          <code>tools:</code> is omitted.
        </p>
        <div v-else class="flex flex-wrap gap-1 pt-0.5">
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

      <div class="space-y-1">
        <label class="fs-mono font-medium ink-3">Color</label>
        <input type="color" :value="frontmatter.color || '#e5a93e'" class="w-8 h-8 rounded-md cursor-pointer border" style="border-color: var(--border-subtle);" @input="updateFrontmatter('color', ($event.target as HTMLInputElement).value)" />
      </div>
    </div>

    <div v-if="activeTab === 'skills'" class="flex-1 overflow-y-auto p-4">
      <div v-if="loadingSkills" class="fs-mono font-mono py-4 text-center ink-4">Loading skills...</div>
      <div v-else-if="!skills.length" class="fs-sm py-4 text-center ink-3">No skills attached to this agent yet.</div>
      <div v-else class="space-y-2">
        <div v-for="skill in skills" :key="skill.slug" class="flex items-center gap-2 px-3 py-2 rounded-md" style="background: var(--surface-raised); border: 1px solid var(--border-subtle);">
          <UIcon name="i-lucide-sparkles" class="size-3.5 shrink-0 ink-accent" />
          <div class="flex-1 min-w-0">
            <div class="fs-sm font-medium truncate ink">{{ skill.frontmatter.name }}</div>
            <div class="fs-micro truncate ink-3">{{ skill.frontmatter.description }}</div>
          </div>
          <span class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">{{ skill.source }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
