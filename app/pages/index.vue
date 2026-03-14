<script setup lang="ts">
import { getAgentColor, modelColors } from '~/utils/colors'

const { claudeDir, set: setDir } = useClaudeDir()
const { agents, fetchAll: fetchAgents } = useAgents()
const { commands, fetchAll: fetchCommands } = useCommands()
const { plugins, fetchAll: fetchPlugins } = usePlugins()
const { skills, fetchAll: fetchSkills } = useSkills()
const { settings, load: loadSettings } = useSettings()

const dirInput = ref('')
const settingDir = ref(false)

onMounted(async () => {
  dirInput.value = claudeDir.value || ''
  await Promise.all([loadSettings(), fetchPlugins(), fetchSkills()])
})

async function changeDir() {
  settingDir.value = true
  try {
    await setDir(dirInput.value)
    await Promise.all([fetchAgents(), fetchCommands(), fetchPlugins(), fetchSkills(), loadSettings()])
  } finally {
    settingDir.value = false
  }
}

const commandGroups = computed(() => {
  const groups = new Set<string>()
  for (const cmd of commands.value) {
    groups.add(cmd.directory || 'root')
  }
  return groups.size
})

const modelBreakdown = computed(() => {
  const counts: Record<string, number> = { opus: 0, sonnet: 0, haiku: 0, unset: 0 }
  for (const a of agents.value) {
    const m = a.frontmatter.model
    if (m && counts[m] !== undefined) counts[m]++
    else counts.unset++
  }
  return counts
})

const totalChars = computed(() =>
  agents.value.reduce((sum, a) => sum + a.body.length, 0)
    + commands.value.reduce((sum, c) => sum + c.body.length, 0)
    + skills.value.reduce((sum, s) => sum + s.body.length, 0)
)
</script>

<template>
  <div>
    <PageHeader title="Dashboard" />

    <div class="px-6 py-4 space-y-6">
      <!-- Directory picker -->
      <div
        class="rounded-xl p-4"
        style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
      >
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-folder" class="size-4 shrink-0" style="color: var(--text-disabled);" />
          <form class="flex-1 flex gap-2" @submit.prevent="changeDir">
            <input
              v-model="dirInput"
              placeholder="~/.claude"
              class="field-input flex-1"
            />
            <UButton type="submit" :loading="settingDir" label="Load" size="sm" variant="soft" />
          </form>
        </div>
      </div>

      <!-- Stat bar -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <NuxtLink
          to="/agents"
          class="rounded-xl p-4 transition-all duration-150 focus-ring"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
          @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'"
          @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'"
        >
          <div class="font-mono text-[24px] font-bold" style="color: var(--text-primary);">{{ agents.length }}</div>
          <div class="text-[11px] mt-1" style="color: var(--text-disabled);">Agents</div>
        </NuxtLink>

        <NuxtLink
          to="/commands"
          class="rounded-xl p-4 transition-all duration-150 focus-ring"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
          @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'"
          @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'"
        >
          <div class="font-mono text-[24px] font-bold" style="color: var(--text-primary);">{{ commands.length }}</div>
          <div class="text-[11px] mt-1" style="color: var(--text-disabled);">Commands</div>
        </NuxtLink>

        <NuxtLink
          to="/skills"
          class="rounded-xl p-4 transition-all duration-150 focus-ring"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
          @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'"
          @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'"
        >
          <div class="font-mono text-[24px] font-bold" style="color: var(--text-primary);">{{ skills.length }}</div>
          <div class="text-[11px] mt-1" style="color: var(--text-disabled);">Skills</div>
        </NuxtLink>

        <NuxtLink
          to="/plugins"
          class="rounded-xl p-4 transition-all duration-150 focus-ring"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
          @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'"
          @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'"
        >
          <div class="font-mono text-[24px] font-bold" style="color: var(--text-primary);">{{ plugins.length }}</div>
          <div class="text-[11px] mt-1" style="color: var(--text-disabled);">Plugins</div>
        </NuxtLink>

        <div
          class="rounded-xl p-4"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        >
          <div class="font-mono text-[24px] font-bold" style="color: var(--text-primary);">{{ Math.round(totalChars / 1000) }}k</div>
          <div class="text-[11px] mt-1" style="color: var(--text-disabled);">Total chars</div>
        </div>
      </div>

      <!-- Model breakdown -->
      <div
        class="rounded-xl p-5"
        style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
      >
        <h3 class="text-section-label mb-3">Model Distribution</h3>
        <div class="flex items-center gap-4">
          <div v-for="(count, model) in modelBreakdown" :key="model" class="flex items-center gap-2">
            <span
              v-if="model !== 'unset'"
              class="text-[10px] font-mono font-medium px-1.5 py-px rounded-full"
              :class="[modelColors[model]?.bg, modelColors[model]?.text]"
            >
              {{ model }}
            </span>
            <span v-else class="text-[10px] font-mono" style="color: var(--text-disabled);">unset</span>
            <span class="font-mono text-[13px] font-medium" style="color: var(--text-primary);">{{ count }}</span>
          </div>
        </div>
      </div>

      <!-- Two-column: Agents + Commands -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Agents list -->
        <div
          class="rounded-xl overflow-hidden"
          style="border: 1px solid var(--border-subtle);"
        >
          <div class="flex items-center justify-between px-4 py-2.5" style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);">
            <h3 class="text-section-label">Agents</h3>
            <NuxtLink to="/agents" class="text-[11px] focus-ring rounded px-1" style="color: var(--accent);">View all</NuxtLink>
          </div>
          <div class="divide-y" style="divide-color: var(--border-subtle);">
            <NuxtLink
              v-for="agent in agents.slice(0, 8)"
              :key="agent.slug"
              :to="`/agents/${agent.slug}`"
              class="flex items-center gap-2.5 px-4 py-2 transition-colors"
              @mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--surface-raised)'"
              @mouseleave="($event.currentTarget as HTMLElement).style.background = 'transparent'"
            >
              <div
                class="size-2 rounded-full shrink-0"
                :style="{ background: getAgentColor(agent.frontmatter.color) }"
              />
              <span class="font-mono text-[12px] font-medium truncate" style="color: var(--text-primary);">
                {{ agent.frontmatter.name }}
              </span>
              <span
                v-if="agent.frontmatter.model && modelColors[agent.frontmatter.model]"
                class="ml-auto text-[9px] font-mono font-medium px-1 py-px rounded-full shrink-0"
                :class="[modelColors[agent.frontmatter.model].bg, modelColors[agent.frontmatter.model].text]"
              >
                {{ agent.frontmatter.model }}
              </span>
            </NuxtLink>
          </div>
        </div>

        <!-- Commands list -->
        <div
          class="rounded-xl overflow-hidden"
          style="border: 1px solid var(--border-subtle);"
        >
          <div class="flex items-center justify-between px-4 py-2.5" style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);">
            <h3 class="text-section-label">Commands</h3>
            <NuxtLink to="/commands" class="text-[11px] focus-ring rounded px-1" style="color: var(--accent);">View all</NuxtLink>
          </div>
          <div class="divide-y" style="divide-color: var(--border-subtle);">
            <NuxtLink
              v-for="cmd in commands.slice(0, 8)"
              :key="cmd.slug"
              :to="`/commands/${cmd.slug}`"
              class="flex items-center gap-2.5 px-4 py-2 transition-colors"
              @mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--surface-raised)'"
              @mouseleave="($event.currentTarget as HTMLElement).style.background = 'transparent'"
            >
              <span class="font-mono text-[9px] shrink-0" style="color: var(--text-disabled);">&gt;_</span>
              <span class="font-mono text-[12px] truncate" style="color: var(--text-secondary);">
                /{{ cmd.frontmatter.name }}
              </span>
              <span class="ml-auto font-mono text-[10px] shrink-0" style="color: var(--text-disabled);">
                {{ cmd.directory }}
              </span>
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Quick actions for empty state -->
      <div
        v-if="agents.length === 0 && commands.length === 0"
        class="rounded-xl p-6 space-y-4"
        style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
      >
        <h3 class="text-section-label">Get Started</h3>
        <p class="text-[13px] leading-relaxed" style="color: var(--text-tertiary);">
          Create agents to define specialized AI behaviors, and commands to build reusable workflows. Start by creating your first agent.
        </p>
        <div class="flex gap-3">
          <NuxtLink
            to="/agents"
            class="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors focus-ring"
            style="background: var(--accent-muted); color: var(--accent); border: 1px solid rgba(45, 212, 191, 0.2);"
          >
            <UIcon name="i-lucide-cpu" class="size-4" />
            Create an Agent
          </NuxtLink>
          <NuxtLink
            to="/commands"
            class="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors focus-ring"
            style="background: rgba(255,255,255,0.04); color: var(--text-secondary); border: 1px solid var(--border-subtle);"
          >
            <UIcon name="i-lucide-terminal" class="size-4" />
            Create a Command
          </NuxtLink>
        </div>
      </div>

      <!-- Graph CTA -->
      <NuxtLink
        v-if="agents.length > 0 || commands.length > 0"
        to="/graph"
        class="block rounded-xl p-5 transition-all duration-150 focus-ring"
        style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'"
        @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'"
      >
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-workflow" class="size-5" style="color: var(--accent);" />
          <div class="flex-1">
            <div class="text-[13px] font-medium" style="color: var(--text-primary);">Relationship Graph</div>
            <div class="text-[11px]" style="color: var(--text-tertiary);">
              Visualize how agents and commands connect to each other
            </div>
          </div>
          <UIcon name="i-lucide-arrow-right" class="size-4" style="color: var(--text-disabled);" />
        </div>
      </NuxtLink>

      <!-- Keyboard shortcuts hint -->
      <div class="flex items-center gap-4 px-2" style="color: var(--text-disabled);">
        <span class="text-[11px] flex items-center gap-1.5">
          <kbd class="text-[10px] font-mono px-1 py-px rounded" style="background: rgba(255,255,255,0.06);">⌘K</kbd>
          Search
        </span>
        <span class="text-[11px] flex items-center gap-1.5">
          <kbd class="text-[10px] font-mono px-1 py-px rounded" style="background: rgba(255,255,255,0.06);">⌘S</kbd>
          Save
        </span>
      </div>
    </div>
  </div>
</template>
