<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
const route = useRoute()
const { claudeDir, exists: claudeDirExists, configured: claudeConfigured, load: loadConfig } = useClaudeDir()
const { fetchAll: fetchAgents, agents } = useAgents()
const { fetchAll: fetchCommands, commands } = useCommands()
const { fetchAll: fetchPlugins, plugins } = usePlugins()
const { fetchAll: fetchSkills, skills } = useSkills()
const { fetchAll: fetchWorkflows, workflows } = useWorkflows()
const { fetchAll: fetchSessions } = useSessions()

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

/**
 * Sessions are in here for a reason. `inCurrentProject` is worked out on the
 * server against the selected folder, so after a project switch every session
 * in the shared list still carries the *previous* project's answer — and
 * /sessions, filtered to "This project", went on showing the sessions of the
 * project you had just left. Now's Running and Settled bands read the same
 * shared list and inherited it.
 *
 * Fetched here rather than in each page so one switch fixes every surface.
 */
async function refreshAll() {
  await loadConfig()
  await refreshScope()
  await Promise.all([
    fetchAgents(), fetchCommands(), fetchPlugins(), fetchSkills(), fetchWorkflows(),
    fetchSessions(),
  ])
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

/**
 * Pull requests, polled far more slowly than everything else beside it.
 *
 * `useAttention` reads local files every eight seconds; this leaves the machine
 * and asks github.com. Two minutes is often enough that a review requested from
 * you turns up while you are still in the app, and rare enough that a window
 * left open all day is not spending somebody's rate limit on a badge.
 */
const { summary: pullSummary, watchContinuously: watchPulls, stopWatching: stopWatchingPulls } = useGithubPulls()

/**
 * The tab title is the only part of this app visible from another window, so it
 * carries the count of things that are stuck — the same total the Now badge
 * shows, reviews included. It used to omit reviews, so a morning whose only
 * problem was three pull requests waiting on you looked quiet from the tab bar.
 */
const stuckTotal = computed(() =>
  attention.value.blocked + attention.value.failingRituals + pullSummary.value.onYou,
)

useHead({
  title: computed(() =>
    stuckTotal.value > 0 ? `(${stuckTotal.value}) Agents Studio` : 'Agents Studio',
  ),
})

onMounted(async () => {
  await refreshAll()
  initialized.value = true
  watchContinuously()
  watchPulls()
  await loadBuildStatus()
})

onUnmounted(() => {
  stopWatching()
  stopWatchingPulls()
})

// Simple mode leads with what someone can do and what they own; the authoring
// surface (agents, commands, workflows, graph) is advanced-only.
const navLinks = computed(() => isSimple.value
  ? [
      { label: 'Home', icon: 'i-lucide-house', to: '/' },
      { label: 'Sessions', icon: 'i-lucide-git-branch', to: '/sessions' },
      { label: 'Reviews', icon: 'i-lucide-git-pull-request', to: '/pulls' },
      { label: 'Daily', icon: 'i-lucide-alarm-clock', to: '/schedules' },
      { label: 'Activity', icon: 'i-lucide-activity', to: '/runs' },
      // Was "My skills", which stopped being true when the Library merged
      // agents and commands in beside them. Its Personal group is first and
      // open, so what you wrote is still the first thing on the screen.
      { label: 'Library', icon: 'i-lucide-library', to: '/library' },
    ]
  : [
      { label: 'Now', icon: 'i-lucide-target', to: '/' },
      { label: 'Sessions', icon: 'i-lucide-git-branch', to: '/sessions' },
      { label: 'Reviews', icon: 'i-lucide-git-pull-request', to: '/pulls' },
      { label: 'Daily', icon: 'i-lucide-alarm-clock', to: '/schedules' },
      { label: 'Activity', icon: 'i-lucide-activity', to: '/runs' },
      // Agents, commands and skills were three nav items for one question.
      { label: 'Library', icon: 'i-lucide-library', to: '/library' },
      { label: 'Workflows', icon: 'i-lucide-git-branch', to: '/workflows' },
      { label: 'Plugins', icon: 'i-lucide-puzzle', to: '/plugins' },
      { label: 'MCP', icon: 'i-lucide-plug', to: '/mcp' },
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
 * The badge that means "look at this", as distinct from the one that counts what
 * you have.
 *
 * There used to be four of these — on Sessions, Reviews and Daily — one per
 * place a slice of the answer happened to live. Four counters for one question
 * is the app admitting the question has no home, so they are now one number on
 * Now, which is where the answer is.
 *
 * Red when something is stuck, accent when work is merely in flight: the second
 * is not news, it is just not finished.
 */
function attentionFor(to: string) {
  if (to !== '/') return null

  const { blocked, working, failingRituals } = attention.value
  const stuck = blocked + failingRituals + pullSummary.value.onYou

  if (stuck) {
    return {
      count: stuck,
      title: `${stuck} ${stuck === 1 ? 'thing' : 'things'} will not move until you do something`,
      style: { background: 'var(--error-tint)', color: 'var(--error)' },
    }
  }

  if (working) {
    return {
      count: working,
      title: `${working} working right now`,
      style: { background: 'var(--accent-muted)', color: 'var(--accent)' },
    }
  }

  return null
}

function badgeFor(to: string) {
  if (isSimple.value) {
    // Simple mode counts what this person owns — somebody else's plugin brought
    // 137 skills, and none of them are an answer to "how much have I made".
    if (to !== '/library') return null
    const mine = (item: { source?: string }) => item.source !== 'plugin' && item.source !== 'github'
    return (
      agents.value.filter(mine).length
      + commands.value.filter(mine).length
      + skills.value.filter(mine).length
    ) || null
  }
  // One count for the three things the Library now holds.
  if (to === '/library') {
    return (agents.value.length + commands.value.length + skills.value.length) || null
  }
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
            <span class="fs-sm font-semibold tracking-tight" style="color: var(--text-primary); font-family: var(--font-display);">
              Agents Studio
            </span>
            <span class="fs-micro font-mono tracking-wider uppercase ink-4">
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
            class="nav-item group flex items-center gap-2.5 px-3 py-[7px] rounded-md fs-base transition-all duration-150 relative focus-ring"
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
              class="font-mono fs-micro tabular-nums px-1.5 rounded-full"
              :style="attentionFor(link.to)!.style"
              :title="attentionFor(link.to)!.title"
            >
              {{ attentionFor(link.to)!.count }}
            </span>
            <span
              v-else-if="badgeFor(link.to)"
              class="font-mono fs-micro tabular-nums transition-colors duration-150"
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
            class="nav-item group flex items-center gap-2.5 px-3 py-[7px] rounded-md fs-base transition-all duration-150 relative focus-ring"
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
            <span class="fs-sm flex-1 text-left" style="font-family: var(--font-sans);">Search</span>
            <kbd class="fs-micro font-mono px-1.5 py-0.5 rounded" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">⌘K</kbd>
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
            <span class="fs-sm flex-1 text-left" style="font-family: var(--font-sans);">Claude</span>
            <kbd class="fs-micro font-mono px-1.5 py-0.5 rounded" style="background: var(--badge-subtle-bg); color: var(--text-disabled);">⌘J</kbd>
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
            <span class="fs-sm" style="font-family: var(--font-sans);">
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
            <span class="fs-sm" style="font-family: var(--font-sans);">
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
            <UIcon name="i-lucide-package" class="size-3.5 shrink-0 mt-px ink-accent" />
            <div class="min-w-0">
              <div class="fs-mono" style="color: var(--text-secondary); font-family: var(--font-sans);">
                {{ build?.summary }}
              </div>
              <div class="fs-micro font-mono ink-4">make service</div>
            </div>
          </div>

          <ProjectSwitcher />
          <!-- Where new items get written -->
          <div v-if="workingDir" class="mt-2 space-y-1.5">
            <div v-if="canUseProjectScope" class="flex items-center gap-1 p-0.5 rounded-md" style="background: var(--input-bg); border: 1px solid var(--border-subtle);">
              <button
                v-for="option in [{ value: 'user' as const, label: 'Personal' }, { value: 'project' as const, label: 'Project' }]"
                :key="option.value"
                class="flex-1 px-2 py-1 rounded-md fs-micro font-medium transition-all"
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
              class="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md fs-micro transition-all hover-bg"
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

          <div class="font-mono fs-micro truncate tracking-wide mt-1.5 px-1 ink-4">
            {{ claudeDir || 'No config directory' }}
          </div>

          <!--
            Always, not only when a checkout has drifted. An npm install — the
            way most people have this — showed no version anywhere at all.
          -->
          <VersionFooter class="mt-1" />
        </div>
      </aside>

      <!-- Main content -->
      <main class="flex-1 min-w-0 h-full overflow-y-auto" style="background: var(--surface-base);">
        <!--
          The welcome, shown when there is no Claude Code set-up here — not when
          the directory is missing. This app creates `~/.claude/agents-ui` for
          its own storage while it boots, so on a cold machine the directory
          always existed by the time this rendered and the welcome never fired
          at the one person it was written for.
        -->
        <SetupWizard
          v-if="initialized && !claudeConfigured"
          @complete="onSetupComplete"
        />

        <NuxtPage v-else-if="initialized" />
        <div v-else class="flex items-center justify-center h-full">
          <UIcon name="i-lucide-loader-2" class="size-5 animate-spin ink-4" />
        </div>
      </main>
    </div>
    <GlobalSearch v-model:open="showSearch" />
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
