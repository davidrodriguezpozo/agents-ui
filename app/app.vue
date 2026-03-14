<script setup lang="ts">
const route = useRoute()
const { claudeDir, load: loadConfig } = useClaudeDir()
const { fetchAll: fetchAgents, agents } = useAgents()
const { fetchAll: fetchCommands, commands } = useCommands()
const { fetchAll: fetchPlugins, plugins } = usePlugins()
const { fetchAll: fetchSkills, skills } = useSkills()

const initialized = ref(false)
const showSearch = ref(false)

onMounted(async () => {
  await loadConfig()
  await Promise.all([fetchAgents(), fetchCommands(), fetchPlugins(), fetchSkills()])
  initialized.value = true
})

const navLinks = [
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Agents', icon: 'i-lucide-cpu', to: '/agents' },
  { label: 'Commands', icon: 'i-lucide-terminal', to: '/commands' },
  { label: 'Skills', icon: 'i-lucide-sparkles', to: '/skills' },
  { label: 'Plugins', icon: 'i-lucide-puzzle', to: '/plugins' },
]

const navSecondary = [
  { label: 'Graph', icon: 'i-lucide-workflow', to: '/graph' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
]

function isActive(to: string) {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}

function badgeFor(to: string) {
  if (to === '/agents') return agents.value.length || null
  if (to === '/commands') return commands.value.length || null
  if (to === '/skills') return skills.value.length || null
  if (to === '/plugins') return plugins.value.length || null
  return null
}
</script>

<template>
  <UApp>
    <div class="flex min-h-screen" style="background: var(--surface-base);">
      <!-- Sidebar -->
      <aside class="w-[200px] shrink-0 flex flex-col" style="background: #06060a; border-right: 1px solid var(--border-subtle);">
        <!-- Brand -->
        <div class="h-14 flex items-center gap-2.5 px-4">
          <div class="size-7 rounded-lg flex items-center justify-center" style="background: var(--accent-muted);">
            <UIcon name="i-lucide-bot" class="size-4" style="color: var(--accent);" />
          </div>
          <span class="font-mono text-[11px] font-semibold tracking-[0.08em] uppercase" style="color: var(--text-secondary);">
            Agent Mgr
          </span>
        </div>

        <!-- Primary Nav -->
        <nav class="flex-1 px-2 pt-2 space-y-0.5">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="group flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-all duration-150 relative focus-ring"
            :style="{
              color: isActive(link.to) ? 'var(--text-primary)' : 'var(--text-tertiary)',
              background: isActive(link.to) ? 'rgba(255,255,255,0.06)' : 'transparent',
            }"
          >
            <!-- Active indicator -->
            <div
              v-if="isActive(link.to)"
              class="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full"
              style="background: var(--accent);"
            />
            <UIcon :name="link.icon" class="size-[15px] shrink-0" />
            <span class="flex-1">{{ link.label }}</span>
            <span
              v-if="badgeFor(link.to)"
              class="font-mono text-[11px]"
              style="color: var(--text-disabled);"
            >
              {{ badgeFor(link.to) }}
            </span>
          </NuxtLink>

          <!-- Separator -->
          <div class="my-3 mx-2" style="border-top: 1px solid var(--border-subtle);" />

          <NuxtLink
            v-for="link in navSecondary"
            :key="link.to"
            :to="link.to"
            class="group flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-all duration-150 relative focus-ring"
            :style="{
              color: isActive(link.to) ? 'var(--text-primary)' : 'var(--text-tertiary)',
              background: isActive(link.to) ? 'rgba(255,255,255,0.06)' : 'transparent',
            }"
          >
            <div
              v-if="isActive(link.to)"
              class="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full"
              style="background: var(--accent);"
            />
            <UIcon :name="link.icon" class="size-[15px] shrink-0" />
            <span>{{ link.label }}</span>
          </NuxtLink>
        </nav>

        <!-- Search shortcut -->
        <div class="px-3 pb-2">
          <button
            class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors focus-ring"
            style="color: var(--text-disabled); background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle);"
            @click="showSearch = true"
          >
            <UIcon name="i-lucide-search" class="size-3.5" />
            <span class="text-[12px] flex-1 text-left">Search</span>
            <kbd class="text-[10px] font-mono px-1 py-px rounded" style="background: rgba(255,255,255,0.06);">⌘K</kbd>
          </button>
        </div>

        <!-- Footer: directory -->
        <div class="px-3 py-3" style="border-top: 1px solid var(--border-subtle);">
          <div class="font-mono text-[10px] truncate" style="color: var(--text-disabled);">
            {{ claudeDir || 'No directory set' }}
          </div>
        </div>
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-w-0 overflow-auto" style="background: var(--surface-base);">
        <Transition name="page" mode="out-in">
          <NuxtPage v-if="initialized" />
        </Transition>
        <div v-if="!initialized" class="flex items-center justify-center h-full">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" style="color: var(--text-disabled);" />
        </div>
      </main>
    </div>
    <GlobalSearch />
  </UApp>
</template>
