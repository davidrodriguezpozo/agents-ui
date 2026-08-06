<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
const route = useRoute()
const { claudeDir, exists: claudeDirExists, load: loadConfig } = useClaudeDir()
const { fetchAll: fetchAgents, agents } = useAgents()
const { fetchAll: fetchCommands, commands } = useCommands()
const { fetchAll: fetchPlugins, plugins } = usePlugins()
const { fetchAll: fetchSkills, skills } = useSkills()
const { fetchAll: fetchWorkflows, workflows } = useWorkflows()

const initialized = ref(false)
const showSearch = ref(false)
const sidebarOpen = ref(false)
const { isPanelOpen: chatOpen } = useChat()
const { workingDir } = useWorkingDir()
const { createScope, canUseProjectScope, projectClaudeExists, refresh: refreshScope, initProject } = useScope()
const colorMode = useColorMode()
const { isSimple, toggle: toggleMode } = useUiMode()
const toast = useToast()
const initializingProject = ref(false)

function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

watch(() => route.path, () => { sidebarOpen.value = false })

async function refreshAll() {
  await loadConfig()
  await refreshScope()
  await Promise.all([fetchAgents(), fetchCommands(), fetchPlugins(), fetchSkills(), fetchWorkflows()])
}

/**
 * First-run setup creates the directory everything else reads from, so the
 * sidebar's counts are all stale by the time the wizard closes. In the template
 * this could not be typechecked — `Promise` is not one of the globals a Vue
 * expression is allowed to see.
 */
async function onSetupComplete() {
  await loadConfig()
  await Promise.all([fetchAgents(), fetchCommands(), fetchPlugins(), fetchSkills()])
}

// Switching projects changes what every list contains, so reload on change.
watch(workingDir, () => {
  if (initialized.value) refreshAll()
})

async function createProjectConfig() {
  initializingProject.value = true
  try {
    const result = await initProject()
    toast.add({ title: 'Project config created', description: result.claudeDir, color: 'success' })
    await refreshAll()
  } catch (e: any) {
    toast.add({ title: 'Could not create project config', description: errorMessage(e), color: 'error' })
  } finally {
    initializingProject.value = false
  }
}

// Cmd+J to toggle chat
if (import.meta.client) {
  const chatHandler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
      e.preventDefault()
      chatOpen.value = !chatOpen.value
    }
  }
  onMounted(() => document.addEventListener('keydown', chatHandler))
  onUnmounted(() => document.removeEventListener('keydown', chatHandler))
}

const { attention, watchContinuously, stopWatching } = useAttention()
const { build, isStale, load: loadBuildStatus } = useBuildStatus()

// The tab title is the only part of this app visible from another window, so
// it carries the count of things that are stuck.
useHead({
  title: computed(() =>
    attention.value.needsYou > 0
      ? `(${attention.value.needsYou}) Agents Studio`
      : 'Agents Studio',
  ),
})

onMounted(async () => {
  await refreshAll()
  initialized.value = true
  watchContinuously()
  await loadBuildStatus()
})

onUnmounted(stopWatching)

// Simple mode leads with what someone can do and what they own; the authoring
// surface (agents, commands, workflows, graph) is advanced-only.
const navLinks = computed(() => isSimple.value
  ? [
      { label: 'Home', icon: 'i-lucide-house', to: '/' },
      { label: 'Sessions', icon: 'i-lucide-git-branch', to: '/sessions' },
      { label: 'Daily', icon: 'i-lucide-alarm-clock', to: '/schedules' },
      { label: 'Activity', icon: 'i-lucide-activity', to: '/runs' },
      { label: 'My skills', icon: 'i-lucide-sparkles', to: '/skills' },
    ]
  : [
      { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
      { label: 'Sessions', icon: 'i-lucide-git-branch', to: '/sessions' },
      { label: 'Daily', icon: 'i-lucide-alarm-clock', to: '/schedules' },
      { label: 'Activity', icon: 'i-lucide-activity', to: '/runs' },
      { label: 'Agents', icon: 'i-lucide-cpu', to: '/agents' },
      { label: 'Workflows', icon: 'i-lucide-git-branch', to: '/workflows' },
      { label: 'Commands', icon: 'i-lucide-terminal', to: '/commands' },
      { label: 'Skills', icon: 'i-lucide-sparkles', to: '/skills' },
      { label: 'Plugins', icon: 'i-lucide-puzzle', to: '/plugins' },
    ]
)

const navSecondary = computed(() => isSimple.value
  ? [
      { label: 'Add tools', icon: 'i-lucide-compass', to: '/explore' },
      { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
    ]
  : [
      { label: 'Explore', icon: 'i-lucide-compass', to: '/explore' },
      { label: 'Graph', icon: 'i-lucide-workflow', to: '/graph' },
      { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
    ]
)

function isActive(to: string) {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}

/**
 * The badge that means "look at this", as distinct from the one that counts
 * what you have. Blocked work is red because it is stuck; a turn in flight is
 * the accent colour because it is fine, just not finished.
 */
function attentionFor(to: string) {
  const { blocked, working, failingRituals } = attention.value

  if (to === '/sessions') {
    if (blocked) {
      return {
        count: blocked,
        title: `${blocked} waiting for you to approve something`,
        style: { background: 'rgba(248,113,113,0.14)', color: 'var(--error)' },
      }
    }
    if (working) {
      return {
        count: working,
        title: `${working} working right now`,
        style: { background: 'var(--accent-muted)', color: 'var(--accent)' },
      }
    }
  }

  if (to === '/schedules' && failingRituals) {
    return {
      count: failingRituals,
      title: `${failingRituals} rituals whose last runs came to nothing`,
      style: { background: 'rgba(248,113,113,0.14)', color: 'var(--error)' },
    }
  }

  return null
}

function badgeFor(to: string) {
  if (isSimple.value) {
    // "My skills" means the ones this person owns — plugin skills aren't theirs.
    if (to !== '/skills') return null
    return skills.value.filter(s => s.source !== 'plugin' && s.source !== 'github').length || null
  }
  if (to === '/agents') return agents.value.length || null
  if (to === '/commands') return commands.value.length || null
  if (to === '/skills') return skills.value.length || null
  if (to === '/plugins') return plugins.value.length || null
  if (to === '/workflows') return workflows.value.length || null
  return null
}
</script>

<template>
  <UApp>
    <div class="flex h-screen overflow-hidden" style="background: var(--surface-base);">
      <!-- Mobile hamburger (md:hidden) -->
      <button
        class="fixed top-4 left-4 z-30 md:hidden p-2 rounded-md cursor-pointer press-scale"
        style="background: var(--badge-subtle-bg); border: 1px solid var(--border-subtle); color: var(--text-secondary);"
        @click="sidebarOpen = true"
      >
        <UIcon name="i-lucide-menu" class="size-5" />
      </button>

      <!-- Backdrop (mobile only) -->
      <Transition name="fade">
        <div
          v-if="sidebarOpen"
          class="fixed inset-0 z-30 md:hidden"
          style="background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px);"
          @click="sidebarOpen = false"
        />
      </Transition>

      <!-- Sidebar -->
      <aside
        class="sidebar w-[200px] shrink-0 flex flex-col relative h-full overflow-hidden fixed inset-y-0 left-0 z-40 -translate-x-full md:relative md:z-auto md:translate-x-0 transition-transform duration-200"
        :class="{ 'translate-x-0': sidebarOpen }"
        style="background: var(--sidebar-bg); border-right: 1px solid var(--border-subtle);"
      >

        <!-- Brand -->
        <div class="h-[56px] flex items-center gap-2.5 px-4 relative">
          <div
            class="size-7 rounded-md flex items-center justify-center relative"
            style="background: var(--accent); border: 1px solid var(--accent);"
          >
            <UIcon name="i-lucide-bot" class="size-3.5" style="color: #ffffff;" />
          </div>
          <div class="flex flex-col">
            <span class="text-[12px] font-semibold tracking-tight" style="color: var(--text-primary); font-family: var(--font-display);">
              Agents Studio
            </span>
            <span class="text-[9px] font-mono tracking-wider uppercase" style="color: var(--text-disabled);">
              Claude Code
            </span>
          </div>
        </div>

        <!-- Primary Nav -->
        <nav class="flex-1 px-2.5 pt-1 space-y-0.5 overflow-y-auto">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="nav-item group flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-all duration-150 relative focus-ring"
            :class="{ 'nav-item--active': isActive(link.to) }"
            :style="{
              color: isActive(link.to) ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: isActive(link.to) ? '500' : '400',
              background: isActive(link.to) ? 'var(--accent-muted)' : undefined,
            }"
          >
            <!-- Active indicator bar -->
            <div
              v-if="isActive(link.to)"
              class="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-4 rounded-r-full"
              style="background: var(--accent);"
            />
            <UIcon :name="link.icon" class="size-[15px] shrink-0 transition-colors duration-150" :style="{ color: isActive(link.to) ? 'var(--accent)' : undefined }" />
            <span class="flex-1" style="font-family: var(--font-sans);">{{ link.label }}</span>
            <!-- Something blocked outranks how many of a thing you own -->
            <span
              v-if="attentionFor(link.to)"
              class="font-mono text-[10px] tabular-nums px-1.5 rounded-full"
              :style="attentionFor(link.to)!.style"
              :title="attentionFor(link.to)!.title"
            >
              {{ attentionFor(link.to)!.count }}
            </span>
            <span
              v-else-if="badgeFor(link.to)"
              class="font-mono text-[10px] tabular-nums transition-colors duration-150"
              :style="{ color: isActive(link.to) ? 'var(--accent)' : 'var(--text-disabled)' }"
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
            class="nav-item group flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-all duration-150 relative focus-ring"
            :style="{
              color: isActive(link.to) ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: isActive(link.to) ? '500' : '400',
              background: isActive(link.to) ? 'var(--accent-muted)' : undefined,
            }"
          >
            <div
              v-if="isActive(link.to)"
              class="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-4 rounded-r-full"
              style="background: var(--accent);"
            />
            <UIcon :name="link.icon" class="size-[15px] shrink-0 transition-colors duration-150" :style="{ color: isActive(link.to) ? 'var(--accent)' : undefined }" />
            <span style="font-family: var(--font-sans);">{{ link.label }}</span>
          </NuxtLink>
        </nav>

        <!-- Search shortcut -->
        <div class="px-2.5 pb-2.5">
          <button
            class="w-full flex items-center gap-2 px-3 py-2 rounded-md transition-all duration-150 focus-ring cursor-pointer press-scale"
            style="color: var(--text-disabled); background: var(--input-bg); border: 1px solid var(--border-subtle);"
            @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'; ($event.currentTarget as HTMLElement).style.color = 'var(--text-tertiary)'"
            @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'; ($event.currentTarget as HTMLElement).style.color = 'var(--text-disabled)'"
            @click="showSearch = true"
          >
            <UIcon name="i-lucide-search" class="size-3.5" />
            <span class="text-[12px] flex-1 text-left" style="font-family: var(--font-sans);">Search</span>
            <kbd class="text-[9px] font-mono px-1.5 py-0.5 rounded" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">⌘K</kbd>
          </button>
        </div>

        <!-- Chat with Claude -->
        <div class="px-2.5 pb-1">
          <button
            class="w-full flex items-center gap-2 px-3 py-2 rounded-md transition-all duration-150 focus-ring cursor-pointer press-scale"
            :style="{
              color: chatOpen ? 'var(--accent)' : 'var(--text-tertiary)',
              background: chatOpen ? 'var(--accent-muted)' : 'transparent',
            }"
            @click="chatOpen = !chatOpen"
          >
            <div class="size-4 relative flex items-center justify-center">
              <UIcon name="i-lucide-zap" class="size-4" />
              <div
                v-if="chatOpen"
                class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full"
                style="background: var(--accent);"
              />
            </div>
            <span class="text-[12px] flex-1 text-left" style="font-family: var(--font-sans);">Claude</span>
            <kbd class="text-[9px] font-mono px-1.5 py-0.5 rounded" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">⌘J</kbd>
          </button>
        </div>

        <!-- Simple / advanced -->
        <div class="px-2.5 pb-1">
          <button
            class="w-full flex items-center gap-2 px-3 py-2 rounded-md transition-all duration-150 focus-ring press-scale"
            style="color: var(--text-tertiary);"
            :title="isSimple ? 'Show agents, commands, workflows and the graph' : 'Hide the advanced authoring tools'"
            @click="toggleMode"
          >
            <UIcon :name="isSimple ? 'i-lucide-settings-2' : 'i-lucide-minimize-2'" class="size-4" />
            <span class="text-[12px]" style="font-family: var(--font-sans);">
              {{ isSimple ? 'Advanced tools' : 'Simple view' }}
            </span>
          </button>
        </div>

        <!-- Theme toggle -->
        <div class="px-2.5 pb-1">
          <button
            class="w-full flex items-center gap-2 px-3 py-2 rounded-md transition-all duration-150 focus-ring press-scale"
            style="color: var(--text-tertiary);"
            @click="toggleTheme"
          >
            <UIcon :name="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'" class="size-4" />
            <span class="text-[12px]" style="font-family: var(--font-sans);">
              {{ colorMode.value === 'dark' ? 'Light mode' : 'Dark mode' }}
            </span>
          </button>
        </div>

        <!-- Footer: working directory -->
        <div class="px-2.5 pb-2.5" style="border-top: 1px solid var(--border-subtle); padding-top: 0.75rem;">
          <!-- Only ever shown when the running build is behind what you have -->
          <div
            v-if="isStale"
            class="mb-2 px-3 py-2 rounded-md flex items-start gap-2"
            style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
            :title="build?.subject ? `Deployed: ${build.subject}` : undefined"
          >
            <UIcon name="i-lucide-package" class="size-3.5 shrink-0 mt-px" style="color: var(--accent);" />
            <div class="min-w-0">
              <div class="text-[11px]" style="color: var(--text-secondary); font-family: var(--font-sans);">
                {{ build?.summary }}
              </div>
              <div class="text-[10px] font-mono" style="color: var(--text-disabled);">make service</div>
            </div>
          </div>

          <ProjectSwitcher />
          <!-- Where new items get written -->
          <div v-if="workingDir" class="mt-2 space-y-1.5">
            <div v-if="canUseProjectScope" class="flex items-center gap-1 p-0.5 rounded-md" style="background: var(--input-bg); border: 1px solid var(--border-subtle);">
              <button
                v-for="option in [{ value: 'user' as const, label: 'Personal' }, { value: 'project' as const, label: 'Project' }]"
                :key="option.value"
                class="flex-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all"
                :style="{
                  background: createScope === option.value ? 'var(--accent-muted)' : 'transparent',
                  color: createScope === option.value ? 'var(--accent)' : 'var(--text-disabled)',
                }"
                :title="option.value === 'project' ? 'New agents, commands and skills go in this project\'s .claude' : 'New items go in your global ~/.claude'"
                @click="createScope = option.value"
              >
                {{ option.label }}
              </button>
            </div>

            <button
              v-else-if="!projectClaudeExists"
              class="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] transition-all hover-bg"
              style="color: var(--text-disabled); border: 1px dashed var(--border-subtle);"
              :disabled="initializingProject"
              @click="createProjectConfig"
            >
              <UIcon
                :name="initializingProject ? 'i-lucide-loader-2' : 'i-lucide-folder-plus'"
                class="size-3 shrink-0"
                :class="{ 'animate-spin': initializingProject }"
              />
              <span class="truncate">Add .claude to this project</span>
            </button>
          </div>

          <div class="font-mono text-[9px] truncate tracking-wide mt-1.5 px-1" style="color: var(--text-disabled);">
            {{ claudeDir || 'No config directory' }}
          </div>
        </div>
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-w-0 h-full overflow-y-auto" style="background: var(--surface-base);">
        <!-- Setup wizard when directory doesn't exist -->
        <SetupWizard
          v-if="initialized && !claudeDirExists"
          @complete="onSetupComplete"
        />

        <NuxtPage v-else-if="initialized" />
        <div v-else class="flex items-center justify-center h-full">
          <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" style="color: var(--text-disabled);" />
        </div>
      </main>
    </div>
    <GlobalSearch />
    <ChatPanel v-model:open="chatOpen" />
  </UApp>
</template>

<style scoped>
/* Nav item hover with smooth background reveal */
.nav-item {
  transition: background 0.15s, color 0.15s;
}
.nav-item:hover {
  background: var(--surface-hover);
}

/* Fade transition for mobile backdrop */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
