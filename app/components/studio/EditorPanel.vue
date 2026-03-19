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
    <div class="shrink-0 flex border-b" style="border-color: var(--border-subtle);">
      <button
        v-for="tab in (['instructions', 'settings', 'skills'] as const)"
        :key="tab"
        class="px-4 py-2.5 text-[12px] font-medium capitalize transition-all relative"
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
        <label class="text-[11px] font-medium" style="color: var(--text-tertiary);">Name</label>
        <input :value="frontmatter.name" class="field-input w-full" placeholder="Agent name" @input="updateFrontmatter('name', ($event.target as HTMLInputElement).value)" />
      </div>
      <div class="space-y-1">
        <label class="text-[11px] font-medium" style="color: var(--text-tertiary);">Description</label>
        <input :value="frontmatter.description" class="field-input w-full" placeholder="What does this agent do?" @input="updateFrontmatter('description', ($event.target as HTMLInputElement).value)" />
      </div>
      <div class="space-y-1">
        <label class="text-[11px] font-medium" style="color: var(--text-tertiary);">Model</label>
        <div class="flex gap-2">
          <button v-for="opt in modelOptions" :key="opt.value" class="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all" :style="{ background: frontmatter.model === opt.value ? 'var(--accent-muted)' : 'var(--surface-raised)', border: '1px solid ' + (frontmatter.model === opt.value ? 'rgba(229, 169, 62, 0.2)' : 'var(--border-subtle)'), color: frontmatter.model === opt.value ? 'var(--accent)' : 'var(--text-secondary)' }" @click="updateFrontmatter('model', opt.value)">{{ opt.label }}</button>
        </div>
      </div>
      <div class="space-y-1">
        <label class="text-[11px] font-medium" style="color: var(--text-tertiary);">Memory</label>
        <div class="flex gap-2">
          <button v-for="opt in memoryOptions" :key="opt.value" class="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all" :style="{ background: frontmatter.memory === opt.value ? 'var(--accent-muted)' : 'var(--surface-raised)', border: '1px solid ' + (frontmatter.memory === opt.value ? 'rgba(229, 169, 62, 0.2)' : 'var(--border-subtle)'), color: frontmatter.memory === opt.value ? 'var(--accent)' : 'var(--text-secondary)' }" @click="updateFrontmatter('memory', opt.value)">{{ opt.label }}</button>
        </div>
      </div>
      <div class="space-y-1">
        <label class="text-[11px] font-medium" style="color: var(--text-tertiary);">Color</label>
        <input type="color" :value="frontmatter.color || '#e5a93e'" class="w-8 h-8 rounded-lg cursor-pointer border" style="border-color: var(--border-subtle);" @input="updateFrontmatter('color', ($event.target as HTMLInputElement).value)" />
      </div>
    </div>

    <div v-if="activeTab === 'skills'" class="flex-1 overflow-y-auto p-4">
      <div v-if="loadingSkills" class="text-[11px] font-mono py-4 text-center" style="color: var(--text-disabled);">Loading skills...</div>
      <div v-else-if="!skills.length" class="text-[12px] py-4 text-center" style="color: var(--text-tertiary);">No skills attached to this agent yet.</div>
      <div v-else class="space-y-2">
        <div v-for="skill in skills" :key="skill.slug" class="flex items-center gap-2 px-3 py-2 rounded-lg" style="background: var(--surface-raised); border: 1px solid var(--border-subtle);">
          <UIcon name="i-lucide-sparkles" class="size-3.5 shrink-0" style="color: var(--accent);" />
          <div class="flex-1 min-w-0">
            <div class="text-[12px] font-medium truncate" style="color: var(--text-primary);">{{ skill.frontmatter.name }}</div>
            <div class="text-[10px] truncate" style="color: var(--text-tertiary);">{{ skill.frontmatter.description }}</div>
          </div>
          <span class="text-[9px] font-mono px-1.5 py-px rounded-full shrink-0" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">{{ skill.source }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
