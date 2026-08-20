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
 * Owned by the app rather than by this component.
 *
 * The sidebar's "Search ⌘K" button set a `showSearch` ref in app.vue that
 * nothing read, because this component kept `open` to itself and bound ⌘K to
 * itself — so the button had never opened anything since the day it was added.
 * The key now lives with every other global key, and the state with it.
 */
const { paletteOpen: open, shortcutsOpen } = useShortcuts()
const query = ref('')
const selected = ref(0)

/**
 * What you picked last time, so the panel opens on it.
 *
 * Kept as keys rather than whole rows: a session that has since been archived,
 * or a skill a plugin took away with it, should quietly stop appearing rather
 * than turn into a row that goes nowhere. Resolving against the live list every
 * time is what makes that free.
 */
const RECENT_KEY = 'agents-ui:palette-recent'
const RECENT_MAX = 20
const recent = ref<string[]>([])

onMounted(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    if (Array.isArray(stored)) recent.value = stored.filter(k => typeof k === 'string')
  } catch {
    // A blocked or corrupt store costs the ordering, not the palette.
  }
})

function remember(key: string) {
  // The Recent section re-keys its own rows; recording those would build a
  // `recent:recent:` key that resolves to nothing on the next open.
  const canonical = key.startsWith('recent:') ? key.slice('recent:'.length) : key
  recent.value = [canonical, ...recent.value.filter(k => k !== canonical)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value))
  } catch {
    // As above.
  }
}

const groups = computed(() => buildPalette({
  capabilities: toCapabilities(agents.value, commands.value, skills.value),
  plugins: plugins.value.map(p => ({ id: p.id, name: p.name, description: p.description })),
  // Archived sessions are not somewhere you jump to.
  sessions: sessions.value
    .filter(s => s.status !== 'archived')
    .map(s => ({ id: s.id, title: s.title, branch: s.branch, activity: s.activity })),
  projects: projects.value.map(p => ({ path: p.path, name: p.name, branch: p.branch })),
  currentProject: workingDir.value,
  recent: recent.value,
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

/**
 * The cheatsheet, from inside the panel it is mostly about.
 *
 * `?` cannot do it from here — the cursor is in a text box, where a question
 * mark is a question mark — so the footer hint is a control rather than a label.
 */
function showShortcuts() {
  close()
  shortcutsOpen.value = true
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
  remember(item.key)
  close()
  if (item.run) await perform(item.run)
  else if (item.to) router.push(item.to)
}

/**
 * Moving through the results without leaving the home row.
 *
 * The arrow keys were the only way, which on a panel you open forty times a day
 * means forty trips to the corner of the keyboard. ⌃n/⌃p is the readline
 * spelling, ⌃j/⌃k the vim one, and both cost nothing to support because they
 * are the same two branches.
 */
function move(delta: number) {
  if (!flat.value.length) {
    selected.value = 0
    return
  }
  selected.value = (selected.value + delta + flat.value.length) % flat.value.length
}

/**
 * The scrolling region, so a selection driven from the keyboard stays on screen.
 *
 * Without this ⌃n past the sixth row moved a highlight nobody could see, which
 * is worse than no keyboard support: you cannot tell what ↵ is about to run.
 */
const list = ref<HTMLElement | null>(null)

watch(selected, async () => {
  await nextTick()
  list.value
    ?.querySelector<HTMLElement>(`[data-index="${selected.value}"]`)
    ?.scrollIntoView({ block: 'nearest' })
})

function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && !e.metaKey && !e.altKey) {
    const key = e.key.toLowerCase()
    if (key === 'n' || key === 'j') {
      e.preventDefault()
      move(1)
      return
    }
    if (key === 'p' || key === 'k') {
      e.preventDefault()
      move(-1)
      return
    }
    if (key === 'c') {
      // On a platform where ⌃c is copy, a selection means they meant copy.
      const input = e.target as HTMLInputElement | null
      if (input && input.selectionStart !== input.selectionEnd) return
      e.preventDefault()
      close()
      return
    }
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Home') {
    e.preventDefault()
    selected.value = 0
  } else if (e.key === 'End') {
    e.preventDefault()
    selected.value = Math.max(0, flat.value.length - 1)
  } else if (e.key === 'Enter') {
    const item = flat.value[selected.value]
    if (!item) return
    e.preventDefault()
    void choose(item)
  }
}

// Closing has to reset the query wherever it was closed from — Escape and the
// scrim go through the model, not through `close()`.
watch(open, (isOpen) => {
  if (!isOpen) {
    query.value = ''
    selected.value = 0
  }
})
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
            placeholder="Search or run anything — try a few letters"
            autofocus
            @keydown="onKeydown"
          />
        </div>

        <div ref="list" class="flex-1 overflow-auto py-1.5">
          <div v-if="!flat.length" class="flex flex-col items-center justify-center py-8 gap-1">
            <p class="type-strong">Nothing matches that</p>
            <p class="type-detail">Try a shorter word, or part of a name.</p>
          </div>

          <div v-for="group in groups" :key="group.kind" class="pb-1">
            <div class="text-section-label px-4 pt-2 pb-1">{{ group.label }}</div>

            <button
              v-for="item in group.items"
              :key="item.key"
              :data-index="indexOf(item)"
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

              <!-- And how to skip the panel entirely next time -->
              <kbd
                v-if="item.shortcut"
                class="kbd-key shrink-0"
                title="Works from anywhere"
              >{{ item.shortcut }}</kbd>
            </button>
          </div>
        </div>

        <div
          class="shrink-0 flex items-center gap-4 px-4 py-2"
          style="border-top: 1px solid var(--border-subtle); background: var(--surface-base);"
        >
          <span class="type-meta flex items-center gap-1.5">
            <kbd class="kbd-key">↑↓</kbd>
            <kbd class="kbd-key">⌃n</kbd>
            <kbd class="kbd-key">⌃p</kbd> move
          </span>
          <span class="type-meta flex items-center gap-1.5">
            <kbd class="kbd-key">↵</kbd> run
          </span>
          <button
            class="type-meta flex items-center gap-1.5 hover:text-label"
            @click="showShortcuts"
          >
            <kbd class="kbd-key">?</kbd> all shortcuts
          </button>
          <span class="type-meta flex items-center gap-1.5 ml-auto">
            <kbd class="kbd-key">esc</kbd> close
          </span>
        </div>
      </div>
    </template>
  </UModal>
</template>
