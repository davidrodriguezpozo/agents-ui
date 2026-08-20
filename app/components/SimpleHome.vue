<script setup lang="ts">
import type { Command } from '~/types'

/**
 * The simple-mode landing page. Leads with what this person can actually run
 * today rather than with configuration concepts.
 */
const { commands } = useCommands()
const { skills } = useSkills()
const { plugins } = usePlugins()
const { sources, fetchSources } = useMarketplace()
const { prefillSkill } = useChat()
const { workingDir, displayPath } = useWorkingDir()

const search = ref('')
const runTarget = ref<Command | null>(null)
const showSetup = ref(false)

onMounted(() => fetchSources())

/** Someone who has connected nothing yet gets the setup flow instead. */
const isNewcomer = computed(() =>
  sources.value.length === 0 && plugins.value.length === 0 && commands.value.length === 0
)

const runnable = computed(() => {
  const q = search.value.trim().toLowerCase()
  return commands.value.filter(c =>
    !q
    || c.invocation.toLowerCase().includes(q)
    || (c.frontmatter.description || '').toLowerCase().includes(q)
    || (c.pluginName || '').toLowerCase().includes(q)
  )
})

interface Group {
  key: string
  label: string
  commands: Command[]
}

const grouped = computed<Group[]>(() => {
  const map = new Map<string, Group>()

  for (const cmd of runnable.value) {
    const key = cmd.pluginName || (cmd.scope === 'project' ? 'This project' : 'Yours')
    if (!map.has(key)) map.set(key, { key, label: key, commands: [] })
    map.get(key)!.commands.push(cmd)
  }

  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
})

const mySkills = computed(() => skills.value.filter(s => s.source !== 'plugin' && s.source !== 'github'))

function openRun(cmd: Command) {
  runTarget.value = cmd
}
</script>

<template>
  <div class="px-6 py-5">
    <!-- Nothing connected yet -->
    <TeamSetup v-if="isNewcomer || showSetup" @done="showSetup = false" />

    <div v-else class="page-container space-y-7 !px-0">
      <!-- Header -->
      <div class="space-y-1.5">
        <h1 class="text-page-title" style="font-family: var(--font-display);">
          What you can do
        </h1>
        <p class="type-body leading-relaxed">
          These come from the tools your team installed. Pick one and Claude does the work.
        </p>
      </div>

      <WhileYouWereAway />

      <!-- Working folder -->
      <div
        class="rounded-lg px-4 py-3 flex items-center gap-3"
        :style="workingDir
          ? 'background: var(--surface-raised); border: 1px solid var(--border-subtle);'
          : 'background: var(--accent-muted); border: 1px solid var(--accent-muted);'"
      >
        <UIcon name="i-lucide-folder" class="size-4 shrink-0 ink-accent" />
        <div class="flex-1 min-w-0">
          <div class="fs-sm font-medium text-body">
            {{ workingDir ? 'Working in' : 'No folder picked yet' }}
          </div>
          <div class="font-mono fs-micro truncate text-meta">
            {{ displayPath || 'Choose the folder you want Claude to work in — bottom left.' }}
          </div>
        </div>
      </div>

      <!-- Search -->
      <input
        v-if="commands.length > 8"
        v-model="search"
        class="field-search max-w-xs"
        placeholder="Search what you can do..."
      />

      <!-- Runnable commands -->
      <div v-if="grouped.length" class="space-y-6">
        <div v-for="group in grouped" :key="group.key" class="space-y-2.5">
          <h2 class="text-section-label">{{ group.label }}</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <!-- A button, so Enter runs it without the handler's help. -->
            <button
              v-for="cmd in group.commands"
              :key="cmd.slug"
              data-row
              class="text-left rounded-lg p-3.5 focus-ring hover-card bg-card group"
              @click="openRun(cmd)"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="font-mono fs-sm font-medium truncate ink-accent">
                  {{ cmd.invocation }}
                </span>
                <UIcon
                  name="i-lucide-play"
                  class="size-3 ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style="color: var(--accent);"
                />
              </div>
              <p class="fs-sm leading-relaxed line-clamp-2 text-label">
                {{ cmd.frontmatter.description || 'No description provided.' }}
              </p>
              <div
                v-if="cmd.frontmatter['argument-hint']"
                class="mt-2 font-mono fs-micro truncate text-meta"
              >
                needs: {{ cmd.frontmatter['argument-hint'] }}
              </div>
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="search" class="py-10 text-center">
        <p class="type-body">Nothing matches "{{ search }}".</p>
      </div>

      <div v-else class="surface-card">
        <EmptyState
          variant="inset"
          icon="i-lucide-package-open"
          title="No ready-made actions yet"
          description="The tools your team installed don't include any commands you can run directly. You can connect another repository, or teach Claude something yourself."
          action-label="Connect more tools"
          @action="showSetup = true"
        />
      </div>

      <!-- Your own skills -->
      <div class="space-y-2.5">
        <div class="flex items-center gap-2">
          <h2 class="text-section-label">Things you taught Claude</h2>
          <NuxtLink to="/skills" class="type-meta hover:text-label transition-colors">
            manage
          </NuxtLink>
        </div>

        <div v-if="mySkills.length" class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <button
            v-for="skill in mySkills"
            :key="skill.slug"
            data-row
            class="text-left rounded-lg p-3.5 focus-ring hover-card bg-card"
            @click="prefillSkill(skill.frontmatter.name)"
          >
            <div class="flex items-center gap-2 mb-1">
              <UIcon name="i-lucide-sparkles" class="size-3.5 shrink-0 ink-accent" />
              <span class="fs-sm font-medium truncate text-body">{{ skill.frontmatter.name }}</span>
            </div>
            <p class="fs-sm leading-relaxed line-clamp-2 text-label">
              {{ skill.frontmatter.description }}
            </p>
          </button>
        </div>

        <div v-else class="surface-card">
          <EmptyState
            variant="inset"
            icon="i-lucide-sparkles"
            title="Nothing of your own yet"
            description="Teach Claude something you explain to people often — how your team writes proposals, or where to find the numbers."
            action-label="Teach Claude something"
            action-icon="i-lucide-plus"
            action-to="/skills?new=1"
          />
        </div>
      </div>
    </div>

    <!-- Run a command -->
    <UModal :open="Boolean(runTarget)" @update:open="v => { if (!v) runTarget = null }">
      <template #content>
        <RunModal :command="runTarget" @close="runTarget = null" />
      </template>
    </UModal>
  </div>
</template>
