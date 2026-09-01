<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { chordHint } from '~/utils/shortcuts'
const route = useRoute()
const { claudeDir, exists: claudeDirExists, configured: claudeConfigured, load: loadConfig } = useClaudeDir()
const { fetchAll: fetchAgents, agents } = useAgents()
const { fetchAll: fetchCommands, commands } = useCommands()
const { fetchAll: fetchPlugins, plugins } = usePlugins()
const { fetchAll: fetchSkills, skills } = useSkills()
const { fetchAll: fetchSessions } = useSessions()
const { sources: inboxSources, load: loadInbox } = useInbox()

const initialized = ref(false)
const { isPanelOpen: chatOpen } = useChat()
const { workingDir } = useWorkingDir()
const { createScope, canUseProjectScope, projectClaudeExists, refresh: refreshScope, initProject } = useScope()
const colorMode = useColorMode()
const toast = useToast()
const initializingProject = ref(false)

function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

/**
 * How wide the navigation is, and whether it says anything.
 *
 * Fleet used to get no shell at all: it was a wall left on a screen nobody was
 * sitting at, so 200px of navigation was 200px spent on a reader who was not
 * going to navigate. It stopped being that a while ago — it is the page this app
 * gets opened *to*, read at a desk, and the price of no shell was that it was
 * the one screen you could not leave except by knowing about Escape.
 *
 * So it is an ordinary page, and the sidebar collapses to its icons instead —
 * which is the same 150px back on a dense screen, available everywhere, and
 * reversible by a person who can see the control that did it. The state moved
 * to a composable when `.` started collapsing it too: a key cannot toggle a ref
 * only this component can see.
 */
const { drawerOpen: sidebarOpen, narrow, toggle: toggleSidebar } = useSidebar()

/**
 * Every global key, bound once, here.
 *
 * ⌘K used to be bound inside the dialog it opens and ⌘J inside this file, and
 * the sidebar's "Search ⌘K" button set a ref nothing read. One listener, one
 * table of what the keys do — see `utils/shortcuts.ts`.
 */
const { paletteOpen, shortcutsOpen, pendingKeys } = useShortcutBindings()

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
    fetchAgents(), fetchCommands(), fetchPlugins(), fetchSkills(),
    fetchSessions(),
    // A file read, so it is free — and the badge cannot count what it has not read.
    loadInbox(),
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
const inboxWaiting = computed(() =>
  inboxSources.value.reduce((n, source) => n + source.items.length, 0),
)

const stuckTotal = computed(() =>
  attention.value.blocked
  + attention.value.failingRituals
  + pullSummary.value.onYou
  + inboxWaiting.value,
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

/**
 * One navigation, for everybody.
 *
 * There were two, chosen by a simple/advanced switch that defaulted to simple:
 * one hid Plugins and MCP and led with a page of runnable commands. It filtered
 * *this list* and nothing else — Work, Land, Shipped and Daily were in both sets
 * and neither of them ever got simpler — so the switch did not lower the
 * difficulty of anything, it only decided which of two wrong first screens you
 * got. The Library holds the authoring surface behind a facet, and Explore is
 * where tools get installed; between them that is the whole of what the shorter
 * list was for.
 */
const navLinks = [
  { label: 'Now', icon: 'i-lucide-target', to: '/' },
  // Sessions and Activity were two lists over one event stream, split by
  // what *started* the work — a distinction the system cares about and
  // nobody else does.
  { label: 'Work', icon: 'i-lucide-git-branch', to: '/work' },
  { label: 'Land', icon: 'i-lucide-git-merge', to: '/land' },
  // The one page in here written for somebody who does not run the work.
  // Kept in the navigation rather than behind a link, because the point of
  // it is that you can turn the laptop around.
  { label: 'Shipped', icon: 'i-lucide-package-check', to: '/shipped' },
  { label: 'Daily', icon: 'i-lucide-alarm-clock', to: '/schedules' },
  // Agents, commands and skills were three nav items for one question, and
  // MCP was a fourth: "what can Claude reach". The servers are a facet of
  // the Library now, reachable at /library?type=mcp.
  { label: 'Library', icon: 'i-lucide-library', to: '/library' },
  { label: 'Plugins', icon: 'i-lucide-puzzle', to: '/plugins' },
]

const navSecondary = [
  { label: 'Explore', icon: 'i-lucide-compass', to: '/explore' },
  // A screen to leave on rather than a page to work in, so it sits down
  // here with the other things you visit once and not every day.
  { label: 'Fleet', icon: 'i-lucide-monitor-dot', to: '/wall' },
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
]

/**
 * What a nav item says when you hover it: what it is, why it is shouting, and
 * the two keys that get there without the mouse you are currently holding.
 */
function navTitle(link: { label: string; to: string }) {
  const hint = chordHint(link.to)
  const base = attentionFor(link.to)?.title ?? link.label
  return hint ? `${base} — ${hint}` : base
}

function isActive(to: string) {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}

/**
 * The badge that means "look at this", as distinct from the one that counts what
 * you have.
 *
 * There used to be four of these — on Sessions, Land and Daily — one per
 * place a slice of the answer happened to live. Four counters for one question
 * is the app admitting the question has no home, so they are now one number on
 * Now, which is where the answer is.
 *
 * Red when something is stuck, accent when work is merely in flight: the second
 * is not news, it is just not finished.
 *
 * It counts `stuckTotal`, which is the same set of inputs the queue builds from —
 * blocked sessions, broken rituals, pull requests on you, and whatever the inbox
 * sources last found. That is deliberate and has bitten twice: a badge reading
 * "3" over a screen listing eleven things is worse than no badge, and both times
 * the cause was the badge counting from one place and the view from another.
 */
function attentionFor(to: string) {
  if (to !== '/') return null

  const { working } = attention.value
  const stuck = stuckTotal.value

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
  // One count for the three things the Library now holds.
  if (to === '/library') {
    return (agents.value.length + commands.value.length + skills.value.length) || null
  }
  if (to === '/plugins') return plugins.value.length || null
  return null
}
</script>

<template>
  <UApp>
    <!--
      Navigation is client-side and usually instant, but "usually" is the
      problem: the one route that waits on a git call looked like a dead click.
      A 2px bar costs nothing and answers it.
    -->
    <NuxtLoadingIndicator color="var(--accent)" :height="2" />

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
        class="sidebar shrink-0 flex flex-col relative h-full overflow-hidden fixed inset-y-0 left-0 z-40 -translate-x-full md:relative md:z-auto md:translate-x-0 transition-[transform,width] duration-200"
        :class="[narrow ? 'w-[56px]' : 'w-[200px]', { 'translate-x-0': sidebarOpen }]"
        style="background: var(--sidebar-bg); border-right: 1px solid var(--border-subtle);"
      >

        <!-- Brand -->
        <div class="h-[56px] flex items-center gap-2.5 relative" :class="narrow ? 'px-3.5 justify-center' : 'px-4'">
          <div
            class="size-7 rounded-md flex items-center justify-center relative shrink-0"
            style="background: var(--accent); border: 1px solid var(--accent);"
          >
            <UIcon name="i-lucide-bot" class="size-3.5" style="color: #ffffff;" />
          </div>
          <div v-if="!narrow" class="flex flex-col">
            <span class="fs-sm font-semibold tracking-tight" style="color: var(--text-primary); font-family: var(--font-display);">
              Agents Studio
            </span>
            <span class="fs-micro font-mono tracking-wider uppercase ink-4">
              Claude Code
            </span>
          </div>
        </div>

        <!-- Primary Nav -->
        <nav class="flex-1 pt-1 space-y-0.5 overflow-y-auto overflow-x-hidden" :class="narrow ? 'px-2' : 'px-2.5'">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="nav-item group flex items-center gap-2.5 py-[7px] rounded-md fs-base transition-all duration-150 relative focus-ring"
            :class="[{ 'nav-item--active': isActive(link.to) }, narrow ? 'px-0 justify-center' : 'px-3']"
            :title="navTitle(link)"
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
            <!--
              Narrow keeps the icon and, on top of it, the one number that means
              "look at this". A count that only exists at 200px would make the
              collapsed sidebar quietly worse than the wide one at the single job
              the badge is for.
            -->
            <span class="relative shrink-0 flex items-center justify-center">
              <UIcon :name="link.icon" class="size-[15px] shrink-0 transition-colors duration-150" :style="{ color: isActive(link.to) ? 'var(--accent)' : undefined }" />
              <span
                v-if="narrow && attentionFor(link.to)"
                class="absolute -top-1 -right-1.5 font-mono tabular-nums rounded-full px-1"
                style="font-size: 8.5px; line-height: 1.35;"
                :style="attentionFor(link.to)!.style"
              >{{ attentionFor(link.to)!.count }}</span>
            </span>
            <template v-if="!narrow">
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
            </template>
          </NuxtLink>

          <!-- Separator -->
          <div class="my-3 mx-2" style="border-top: 1px solid var(--border-subtle);" />

          <NuxtLink
            v-for="link in navSecondary"
            :key="link.to"
            :to="link.to"
            class="nav-item group flex items-center gap-2.5 py-[7px] rounded-md fs-base transition-all duration-150 relative focus-ring"
            :class="narrow ? 'px-0 justify-center' : 'px-3'"
            :title="navTitle(link)"
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
            <span v-if="!narrow" style="font-family: var(--font-sans);">{{ link.label }}</span>
          </NuxtLink>
        </nav>

        <!-- Search shortcut -->
        <div class="pb-2.5" :class="narrow ? 'px-2' : 'px-2.5'">
          <button
            class="w-full flex items-center gap-2 py-2 rounded-md transition-all duration-150 focus-ring cursor-pointer press-scale"
            :class="narrow ? 'px-0 justify-center' : 'px-3'"
            title="Search — ⌘K, or just /"
            style="color: var(--text-disabled); background: var(--input-bg); border: 1px solid var(--border-subtle);"
            @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'; ($event.currentTarget as HTMLElement).style.color = 'var(--text-tertiary)'"
            @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'; ($event.currentTarget as HTMLElement).style.color = 'var(--text-disabled)'"
            @click="paletteOpen = true"
          >
            <UIcon name="i-lucide-search" class="size-3.5 shrink-0" />
            <template v-if="!narrow">
              <span class="fs-sm flex-1 text-left" style="font-family: var(--font-sans);">Search</span>
              <kbd class="kbd-key">⌘K</kbd>
            </template>
          </button>
        </div>

        <!-- Chat with Claude -->
        <div class="pb-1" :class="narrow ? 'px-2' : 'px-2.5'">
          <button
            class="w-full flex items-center gap-2 py-2 rounded-md transition-all duration-150 focus-ring cursor-pointer press-scale"
            :class="narrow ? 'px-0 justify-center' : 'px-3'"
            :title="narrow ? 'Claude — ⌘J' : undefined"
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
            <template v-if="!narrow">
              <span class="fs-sm flex-1 text-left" style="font-family: var(--font-sans);">Claude</span>
              <kbd class="kbd-key">⌘J</kbd>
            </template>
          </button>
        </div>

        <!-- Theme toggle -->
        <div class="pb-1" :class="narrow ? 'px-2' : 'px-2.5'">
          <button
            class="w-full flex items-center gap-2 py-2 rounded-md transition-all duration-150 focus-ring press-scale"
            :class="narrow ? 'px-0 justify-center' : 'px-3'"
            style="color: var(--text-tertiary);"
            :title="narrow ? (colorMode.value === 'dark' ? 'Light mode' : 'Dark mode') : undefined"
            @click="toggleTheme"
          >
            <UIcon :name="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'" class="size-4 shrink-0" />
            <span v-if="!narrow" class="fs-sm" style="font-family: var(--font-sans);">
              {{ colorMode.value === 'dark' ? 'Light mode' : 'Dark mode' }}
            </span>
          </button>
        </div>

        <!--
          The keyboard layer, advertised.

          `?` opens it, which is only useful to somebody who already knows that,
          so there is a row that says so — the same reason the collapse control
          below stays on screen rather than living behind a shortcut.
        -->
        <div class="pb-1" :class="narrow ? 'px-2' : 'px-2.5'">
          <button
            class="w-full flex items-center gap-2 py-2 rounded-md transition-all duration-150 focus-ring press-scale"
            :class="narrow ? 'px-0 justify-center' : 'px-3'"
            style="color: var(--text-tertiary);"
            title="Keyboard shortcuts — ?"
            @click="shortcutsOpen = true"
          >
            <UIcon name="i-lucide-keyboard" class="size-4 shrink-0" />
            <template v-if="!narrow">
              <span class="fs-sm flex-1 text-left" style="font-family: var(--font-sans);">Shortcuts</span>
              <kbd class="kbd-key">?</kbd>
            </template>
          </button>
        </div>

        <!--
          The control that did it, always visible.

          Hidden behind a keyboard shortcut this would be a sidebar some people
          discover is missing and cannot get back — which is the failure mode of
          every collapsible panel, and the reason Fleet's no-shell version had to
          go in the first place.
        -->
        <div class="pb-1 md:block hidden" :class="narrow ? 'px-2' : 'px-2.5'">
          <button
            class="w-full flex items-center gap-2 py-2 rounded-md transition-all duration-150 focus-ring press-scale"
            :class="narrow ? 'px-0 justify-center' : 'px-3'"
            style="color: var(--text-tertiary);"
            :title="narrow ? 'Widen the sidebar' : 'Collapse to icons'"
            @click="toggleSidebar"
          >
            <UIcon
              :name="narrow ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
              class="size-4 shrink-0"
            />
            <span v-if="!narrow" class="fs-sm" style="font-family: var(--font-sans);">Collapse</span>
          </button>
        </div>

        <!--
          Footer: which project, and what this build is.

          Collapsed it becomes one button, because every control in here needs
          words to mean anything — a repository name, a scope, a version. An icon
          for "Personal / Project" is a guess, and a sidebar that makes you guess
          about where new files get written is worse than one that asks you to
          widen it first.
        -->
        <div v-if="narrow" class="px-2 pb-2.5" style="border-top: 1px solid var(--border-subtle); padding-top: 0.75rem;">
          <button
            class="w-full flex items-center justify-center py-2 rounded-md transition-all duration-150 focus-ring press-scale"
            style="color: var(--text-tertiary);"
            :title="`${workingDir || 'No project'} — widen the sidebar to change it`"
            @click="toggleSidebar"
          >
            <UIcon name="i-lucide-folder-git-2" class="size-4 shrink-0" />
          </button>
        </div>

        <div v-else class="px-2.5 pb-2.5" style="border-top: 1px solid var(--border-subtle); padding-top: 0.75rem;">
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

          <!--
            Client-only, because which project is active is not something the
            server can know.

            `useWorkingDir` seeds itself from local storage during setup so the
            sidebar names the right repository on the first frame rather than
            after a round trip. That is worth keeping — but it made the server
            render "Pick a project" where the client rendered `storefront-demo`,
            and Vue logged a hydration mismatch on every single page load. A
            production build does not rectify a mismatch, so the flash stayed.
            Rendering nothing on the server is honest: it has nothing to say
            here, and the client has the answer before it paints.
          -->
          <ClientOnly>
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
          </ClientOnly>

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

        <!--
          `NuxtLayout` is here for exactly one layout: `work`, which puts the
          session rail beside the page. Every other page takes `layouts/default`,
          which is an element-free passthrough — so nothing outside the work
          surface gained a wrapper in its DOM by this existing.
        -->
        <NuxtLayout v-else-if="initialized">
          <NuxtPage />
        </NuxtLayout>
        <div v-else class="flex items-center justify-center h-full">
          <UIcon name="i-lucide-loader-2" class="size-5 animate-spin ink-4" />
        </div>
      </main>
    </div>
    <GlobalSearch />
    <ChatPanel v-model:open="chatOpen" />
    <ShortcutsOverlay />

    <!--
      A half-typed sequence, shown.

      `g` on its own does nothing visible, and neither does the `5` in front of
      `5j`, so without this the app looks like it swallowed the keypress. This is
      vim's own answer — the pending command in the corner — and it is the thing
      that makes a count feel safe to start typing.
    -->
    <Transition name="fade">
      <div
        v-if="pendingKeys"
        class="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-md shadow-lg"
        style="background: var(--surface-overlay); border: 1px solid var(--border-default);"
      >
        <kbd class="kbd-key">{{ pendingKeys }}</kbd>
        <span class="type-meta">pending — ? for the list</span>
      </div>
    </Transition>
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
