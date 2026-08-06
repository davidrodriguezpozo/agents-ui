<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import type { Agent } from '~/types'
import { agentTemplates } from '~/utils/templates'
import { getAgentColor } from '~/utils/colors'

/**
 * First run, advanced mode. Leads with the two things this is for — running
 * sessions and scheduling rituals — rather than with what an agent is. Someone
 * arriving here wants to leave something running; explaining the vocabulary
 * before showing the work gets the order backwards, and the templates below
 * are still one scroll away for whoever wants them.
 */
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
    toast.add({ title: 'Failed to create agent', description: errorMessage(e), color: 'error' })
  } finally {
    creating.value = null
  }
}

const starts = [
  {
    to: '/schedules',
    icon: 'i-lucide-alarm-clock',
    title: 'Put work on a schedule',
    body: 'A morning briefing, issue triage, a migration review — done before you sit down, retried when it blips, and stopped when it breaks.',
    cta: 'Write a ritual',
  },
  {
    to: '/sessions',
    icon: 'i-lucide-git-branch',
    title: 'Start a session',
    body: 'Say what you want done. It gets its own branch and checkout, runs your tests when it is finished, and will not merge if they fail.',
    cta: 'Run something',
  },
  {
    to: '/explore',
    icon: 'i-lucide-compass',
    title: 'Add tools',
    body: 'Skills, plugins and commands from marketplaces and GitHub, installed without leaving the app.',
    cta: 'Browse',
  },
]
</script>

<template>
  <div class="space-y-8">
    <!-- Hero -->
    <div class="text-center space-y-3 pt-2">
      <h2 class="text-[24px] font-semibold tracking-tight" style="font-family: var(--font-display);">
        Leave Claude Code running
      </h2>
      <p class="type-body max-w-xl mx-auto leading-relaxed">
        Work that fires on a schedule against your own repositories, checks itself with your own
        tests, and stops when it can't. Come back to what it did, what it cost, and what needs you.
      </p>
    </div>

    <!-- Where to start -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <NuxtLink
        v-for="start in starts"
        :key="start.to"
        :to="start.to"
        class="rounded-md p-4 bg-card hover-card focus-ring group flex flex-col"
      >
        <div class="flex items-center gap-2 mb-2">
          <UIcon :name="start.icon" class="size-4" style="color: var(--accent);" />
          <span class="type-strong">{{ start.title }}</span>
        </div>
        <p class="type-detail leading-relaxed flex-1">
          {{ start.body }}
        </p>
        <div class="flex items-center gap-1.5 mt-3 text-[12px] font-medium" style="color: var(--accent);">
          {{ start.cta }}
          <UIcon
            name="i-lucide-arrow-right"
            class="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </div>
      </NuxtLink>
    </div>

    <!-- Subagent templates, for whoever wants them -->
    <div>
      <h3 class="text-section-label mb-1.5">Or set up a subagent</h3>
      <p class="type-detail mb-3 max-w-xl leading-relaxed">
        Subagents are specialists a session can hand work to — a reviewer, a researcher — each
        with its own instructions, model and tool allowlist. Start from a template and change
        anything afterwards.
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <button
          v-for="template in agentTemplates"
          :key="template.id"
          class="rounded-md p-4 text-left hover-card focus-ring relative overflow-hidden group bg-card"
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
            <span class="type-strong">{{ template.frontmatter.name }}</span>
            <UIcon
              v-if="creating === template.id"
              name="i-lucide-loader-2"
              class="size-3.5 ml-auto animate-spin text-meta"
            />
          </div>
          <p class="type-detail leading-relaxed line-clamp-2">
            {{ template.frontmatter.description }}
          </p>
        </button>
      </div>
    </div>
  </div>
</template>
