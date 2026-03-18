<script setup lang="ts">
import type { Agent } from '~/types'
import { agentTemplates } from '~/utils/templates'
import { getAgentColor } from '~/utils/colors'

const emit = defineEmits<{
  created: [agent: Agent]
}>()

const { create } = useAgents()
const toast = useToast()
const creating = ref<string | null>(null)

async function useTemplate(templateId: string) {
  const template = agentTemplates.find(t => t.id === templateId)
  if (!template) return

  creating.value = templateId
  try {
    const agent = await create({
      frontmatter: { ...template.frontmatter },
      body: template.body,
    })
    toast.add({ title: `${template.frontmatter.name} created`, color: 'success' })
    emit('created', agent)
  } catch (e: any) {
    toast.add({ title: 'Failed to create agent', description: e.data?.message || e.message, color: 'error' })
  } finally {
    creating.value = null
  }
}
</script>

<template>
  <div class="space-y-8">
    <!-- Hero -->
    <div class="text-center space-y-3 pt-2">
      <h2 class="text-[24px] font-semibold tracking-tight" style="font-family: var(--font-display);">Welcome to Agent Manager</h2>
      <p class="text-[13px] text-label max-w-lg mx-auto leading-relaxed">
        This tool helps you configure how Claude Code behaves. Create <strong class="text-body">agents</strong> with custom instructions, build reusable <strong class="text-body">commands</strong>, and organize <strong class="text-body">skills</strong> — all without touching the terminal.
      </p>
    </div>

    <!-- Concepts -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div class="rounded-lg p-4 bg-card">
        <div class="flex items-center gap-2 mb-2">
          <UIcon name="i-lucide-cpu" class="size-4" style="color: var(--accent);" />
          <span class="text-[13px] font-medium">Agents</span>
        </div>
        <p class="text-[12px] text-label leading-relaxed">
          Specialized AI assistants. Each agent has its own personality, instructions, and model. Think of them as different team members.
        </p>
      </div>
      <div class="rounded-lg p-4 bg-card">
        <div class="flex items-center gap-2 mb-2">
          <UIcon name="i-lucide-terminal" class="size-4" style="color: var(--accent);" />
          <span class="text-[13px] font-medium">Commands</span>
        </div>
        <p class="text-[12px] text-label leading-relaxed">
          Reusable workflows triggered with a slash (e.g., /deploy). Like shortcuts for things you do repeatedly.
        </p>
      </div>
      <div class="rounded-lg p-4 bg-card">
        <div class="flex items-center gap-2 mb-2">
          <UIcon name="i-lucide-sparkles" class="size-4" style="color: var(--accent);" />
          <span class="text-[13px] font-medium">Skills</span>
        </div>
        <p class="text-[12px] text-label leading-relaxed">
          Specific capabilities you can add to agents. A skill teaches an agent how to do one thing well.
        </p>
      </div>
    </div>

    <!-- Quick start templates -->
    <div>
      <h3 class="text-section-label mb-3">Quick start — pick a template</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <button
          v-for="template in agentTemplates"
          :key="template.id"
          class="rounded-lg p-4 text-left hover-card focus-ring relative overflow-hidden group bg-card"
          :disabled="creating !== null"
          @click="useTemplate(template.id)"
        >
          <!-- Color accent bar -->
          <div
            class="absolute inset-x-0 top-0 h-[2px] opacity-60 group-hover:opacity-100 transition-opacity"
            :style="{ background: getAgentColor(template.frontmatter.color) }"
          />

          <div class="flex items-center gap-2.5 mb-2">
            <UIcon :name="template.icon" class="size-4 shrink-0 text-label" />
            <span class="text-[13px] font-medium">{{ template.frontmatter.name }}</span>
            <UIcon
              v-if="creating === template.id"
              name="i-lucide-loader-2"
              class="size-3.5 ml-auto animate-spin text-meta"
            />
          </div>
          <p class="text-[12px] text-label leading-relaxed line-clamp-2">
            {{ template.frontmatter.description }}
          </p>
        </button>
      </div>
      <p class="text-[12px] text-meta mt-3">
        Click any template to create it instantly. You can customize everything afterwards.
      </p>
    </div>
  </div>
</template>
