<script setup lang="ts">
import { toCapabilities } from '~/utils/capabilities'
import { buildPalette, flattenPalette, type PaletteAction, type PaletteItem } from '~/utils/palette'

/**
 * ⌘K.
 *
 * It used to only navigate, and only to four of the app's own object types: you
 * could not reach Settings or Now, you could not jump to a session, and you
 * could not *do* anything. On a tool whose audience lives at a keyboard, that is
 * the difference between a search box and a command palette.
 *
 * It also labelled commands `/${frontmatter.name}` — `/pickup` for a command you
 * actually type as `/defender:pickup`. The Library's own mapping is reused now,
 * so there is one answer to what a thing is called.
 */
const router = useRouter()
const { agents } = useAgents()
const { commands } = useCommands()
const { plugins } = usePlugins()
const { skills } = useSkills()
const { sessions } = useSessions()
const { projects, activate } = useProjects()
const { workingDir } = useWorkingDir()
const { isSimple, toggle: toggleMode } = useUiMode()
const colorMode = useColorMode()

/**
 * Owned by the parent as well as by ⌘K.
 *
 * The sidebar's "Search ⌘K" button set a `showSearch` ref in app.vue that
 * nothing read, because this component kept `open` to itself — so the button had
 * never opened anything since the day it was added.
 */
const open = defineModel<boolean>('open', { default: false })
const query = ref('')
const selected = ref(0)

const groups = computed(() => buildPalette({
  capabilities: toCapabilities(agents.value, commands.value, skills.value),
  plugins: plugins.value.map(p => ({ id: p.id, name: p.name, description: p.description })),
  // Archived sessions are not somewhere you jump to.
  sessions: sessions.value
    .filter(s => s.status !== 'archived')
    .map(s => ({ id: s.id, title: s.title, branch: s.branch, activity: s.activity })),
  projects: projects.value.map(p => ({ path: p.path, name: p.name, branch: p.branch })),
  currentProject: workingDir.value,
  isDark: colorMode.value === 'dark',
  isSimple: isSimple.value,
}, query.value))

const flat = computed(() => flattenPalette(groups.value))

/** Where a row sits in the flat list, which is what the arrow keys move through. */
function indexOf(item: PaletteItem) {
  return flat.value.findIndex(candidate => candidate.key === item.key)
}

watch(query, () => { selected.value = 0 })

function close() {
  open.value = false
  query.value = ''
  selected.value = 0
}

async function perform(action: PaletteAction) {
  if (action.type === 'toggle-theme') {
    colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
    return
  }
  if (action.type === 'toggle-mode') {
    toggleMode()
    return
  }
  if (action.type === 'switch-project') {
    await activate(action.path)
  }
}

async function choose(item: PaletteItem) {
  close()
  if (item.run) await perform(item.run)
  else if (item.to) router.push(item.to)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selected.value = flat.value.length ? (selected.value + 1) % flat.value.length : 0
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selected.value = flat.value.length
      ? (selected.value - 1 + flat.value.length) % flat.value.length
      : 0
  } else if (e.key === 'Enter') {
    const item = flat.value[selected.value]
    if (!item) return
    e.preventDefault()
    void choose(item)
  }
}

// Global ⌘K
if (import.meta.client) {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      if (open.value) close()
      else open.value = true
    }
  }
  onMounted(() => document.addEventListener('keydown', handler))
  onUnmounted(() => document.removeEventListener('keydown', handler))
}
</script>

<template>
  <UModal v-model:open="open">
    <template #content>
      <div class="bg-overlay rounded-lg overflow-hidden flex flex-col" style="max-height: 60vh;">
        <div class="flex items-center gap-3 px-4 py-3 shrink-0" style="border-bottom: 1px solid var(--border-subtle);">
          <UIcon name="i-lucide-search" class="size-4 shrink-0 text-meta" />
          <input
            v-model="query"
            class="flex-1 bg-transparent fs-base outline-none"
            placeholder="Search or run a command…"
            autofocus
            @keydown="onKeydown"
          />
        </div>

        <div class="flex-1 overflow-auto py-1.5">
          <div v-if="!flat.length" class="flex flex-col items-center justify-center py-8 gap-1">
            <p class="type-strong">Nothing matches that</p>
            <p class="type-detail">Try a shorter word, or part of a name.</p>
          </div>

          <div v-for="group in groups" :key="group.kind" class="pb-1">
            <div class="text-section-label px-4 pt-2 pb-1">{{ group.label }}</div>

            <button
              v-for="item in group.items"
              :key="item.key"
              class="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors"
              :style="{ background: indexOf(item) === selected ? 'var(--surface-hover)' : 'transparent' }"
              @mouseenter="selected = indexOf(item)"
              @click="choose(item)"
            >
              <div
                v-if="item.colour"
                class="size-2 rounded-full shrink-0"
                :style="{ background: item.colour }"
              />
              <UIcon
                v-else
                :name="item.icon"
                class="size-4 shrink-0"
                :class="[
                  item.kind === 'action' ? 'ink-accent' : 'text-meta',
                  item.icon.includes('loader') ? 'animate-spin' : '',
                ]"
              />

              <span class="type-strong shrink-0 truncate max-w-[45%]">{{ item.label }}</span>
              <span v-if="item.hint" class="flex-1 fs-sm truncate text-label">{{ item.hint }}</span>
              <span v-else class="flex-1" />

              <!-- Says what pressing it does, for the rows where that is not obvious -->
              <UIcon
                v-if="item.run"
                name="i-lucide-zap"
                class="size-3 shrink-0 ink-accent"
                title="Happens straight away"
              />
            </button>
          </div>
        </div>

        <div
          class="shrink-0 flex items-center gap-4 px-4 py-2"
          style="border-top: 1px solid var(--border-subtle); background: var(--surface-base);"
        >
          <span class="type-meta flex items-center gap-1.5">
            <kbd class="fs-micro font-mono px-1 py-px rounded badge badge-subtle">↑↓</kbd> move
          </span>
          <span class="type-meta flex items-center gap-1.5">
            <kbd class="fs-micro font-mono px-1 py-px rounded badge badge-subtle">↵</kbd> run
          </span>
          <span class="type-meta flex items-center gap-1.5 ml-auto">
            <kbd class="fs-micro font-mono px-1 py-px rounded badge badge-subtle">esc</kbd> close
          </span>
        </div>
      </div>
    </template>
  </UModal>
</template>
