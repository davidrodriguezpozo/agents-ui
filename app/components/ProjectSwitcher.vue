<script setup lang="ts">
/**
 * Pick which repository you are working in.
 *
 * Replaces a text box that had to be retyped every time. The list is the point:
 * switching between the four things you actually work on should cost a click,
 * and a project you have not touched in a month should not be indistinguishable
 * from one you were in this morning — so they sort by when you were last there,
 * and each says what branch it is on and how many sessions it holds.
 */
const { projects, active, home, ensureLoaded, addProject, activate, remove, display }
  = useProjects()
const { workingDir } = useWorkingDir()

const open = ref(false)
const adding = ref(false)
const pathInput = ref('')
const busy = ref(false)
const error = ref('')

const suggestions = ref<{ name: string; path: string; hasChildren: boolean }[]>([])
const highlighted = ref(-1)
let debounce: ReturnType<typeof setTimeout> | null = null

onMounted(() => { ensureLoaded() })

function onOpen() {
  open.value = true
  adding.value = projects.value.length === 0
  error.value = ''
  ensureLoaded()
}

function startAdding() {
  adding.value = true
  pathInput.value = ''
  suggestions.value = []
  highlighted.value = -1
  error.value = ''
  nextTick(() => pathField.value?.focus())
}

const pathField = ref<HTMLInputElement | null>(null)

async function fetchSuggestions(path: string) {
  if (!path) { suggestions.value = []; return }
  try {
    const data = await $fetch<{ directories: typeof suggestions.value }>('/api/directories', {
      query: { path },
    })
    suggestions.value = data.directories
    highlighted.value = -1
  } catch {
    suggestions.value = []
  }
}

function onInput() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => fetchSuggestions(pathInput.value), 150)
}

function pick(suggestion: { name: string; path: string; hasChildren: boolean }) {
  pathInput.value = suggestion.path
  highlighted.value = -1
  if (suggestion.hasChildren) fetchSuggestions(suggestion.path)
  else suggestions.value = []
}

async function confirmAdd() {
  const path = pathInput.value.trim()
  if (!path || busy.value) return

  busy.value = true
  error.value = ''
  try {
    await addProject(path)
    adding.value = false
    open.value = false
    suggestions.value = []
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'That path could not be added.'
  } finally {
    busy.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (!suggestions.value.length) {
    if (e.key === 'Enter') { e.preventDefault(); confirmAdd() }
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlighted.value = Math.min(highlighted.value + 1, suggestions.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlighted.value = Math.max(highlighted.value - 1, -1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (highlighted.value >= 0) pick(suggestions.value[highlighted.value]!)
    else confirmAdd()
  } else if (e.key === 'Escape') {
    suggestions.value = []
    highlighted.value = -1
  }
}

async function switchTo(path: string | null) {
  if (path === workingDir.value) { open.value = false; return }
  busy.value = true
  try {
    await activate(path)
    open.value = false
  } finally {
    busy.value = false
  }
}

/**
 * Removing is a two-step because the row is a click target for switching, and
 * a stray click that silently drops a project from the list is the kind of
 * thing you only notice later.
 */
const confirmingRemoval = ref<string | null>(null)

async function confirmRemove(path: string) {
  busy.value = true
  try {
    await remove(path)
    confirmingRemoval.value = null
  } finally {
    busy.value = false
  }
}

const label = computed(() => {
  if (!workingDir.value) return 'Pick a project'
  return active.value?.name ?? workingDir.value.split('/').filter(Boolean).pop() ?? workingDir.value
})
</script>

<template>
  <UPopover v-model:open="open" :ui="{ content: 'w-[320px]' }">
    <button
      class="w-full flex items-center gap-2 px-3 py-2 rounded-md transition-all duration-150 focus-ring cursor-pointer text-left press-scale"
      style="color: var(--text-disabled); border: 1px solid var(--border-subtle);"
      @click="onOpen"
    >
      <UIcon
        name="i-lucide-folder-git-2"
        class="size-3.5 shrink-0"
        :style="{ color: workingDir ? 'var(--accent)' : undefined }"
      />
      <div class="flex-1 min-w-0">
        <div
          class="text-[11px] font-medium truncate"
          :style="{ color: workingDir ? 'var(--text-primary)' : 'var(--text-disabled)', fontFamily: 'var(--font-sans)' }"
        >
          {{ label }}
        </div>
        <div v-if="active?.branch" class="text-[10px] font-mono truncate" style="color: var(--text-disabled);">
          {{ active.branch }}
        </div>
      </div>
      <UIcon name="i-lucide-chevrons-up-down" class="size-3 shrink-0" style="color: var(--text-disabled);" />
    </button>

    <template #content>
      <div class="py-2">
        <div class="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wide" style="color: var(--text-disabled);">
          Projects
        </div>

        <div v-if="projects.length" class="max-h-[280px] overflow-y-auto">
          <div v-for="project in projects" :key="project.path" class="group relative">
            <button
              class="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors duration-75 hover-bg"
              :style="{ background: project.path === workingDir ? 'var(--accent-muted)' : 'transparent' }"
              :disabled="busy"
              @click="switchTo(project.path)"
            >
              <UIcon
                :name="project.exists ? (project.isRepo ? 'i-lucide-folder-git-2' : 'i-lucide-folder') : 'i-lucide-folder-x'"
                class="size-3.5 shrink-0"
                :style="{ color: project.path === workingDir ? 'var(--accent)' : project.exists ? 'var(--text-disabled)' : 'var(--error)' }"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span
                    class="text-[11px] font-medium truncate"
                    :style="{ color: project.path === workingDir ? 'var(--text-primary)' : 'var(--text-secondary)' }"
                  >{{ project.name }}</span>
                  <span
                    v-if="project.sessionCount"
                    class="text-[9px] px-1 rounded shrink-0"
                    style="background: var(--surface-raised); color: var(--text-disabled);"
                    :title="`${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}`"
                  >{{ project.sessionCount }}</span>
                </div>
                <div class="text-[10px] font-mono truncate" style="color: var(--text-disabled);">
                  <template v-if="!project.exists">not on disk — {{ display(project.path) }}</template>
                  <template v-else-if="!project.isRepo">not a git repository</template>
                  <template v-else>{{ project.branch ?? display(project.path) }}</template>
                </div>
              </div>
            </button>

            <button
              v-if="confirmingRemoval !== project.path"
              class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover-bg"
              title="Remove from this list — the repository is not touched"
              @click.stop="confirmingRemoval = project.path"
            >
              <UIcon name="i-lucide-x" class="size-3" style="color: var(--text-disabled);" />
            </button>
            <div
              v-else
              class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1 rounded"
              style="background: var(--surface-raised);"
            >
              <button
                class="text-[10px] font-medium px-1.5 py-0.5 rounded"
                style="color: var(--error);"
                :disabled="busy"
                @click.stop="confirmRemove(project.path)"
              >
                Remove
              </button>
              <button
                class="text-[10px] px-1 py-0.5 rounded"
                style="color: var(--text-disabled);"
                @click.stop="confirmingRemoval = null"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>

        <p v-else-if="!adding" class="px-3 py-2 text-[11px] leading-relaxed" style="color: var(--text-secondary);">
          No projects yet. Add the repository you want sessions to branch from.
        </p>

        <div class="mt-1 pt-1" style="border-top: 1px solid var(--border-subtle);">
          <button
            v-if="workingDir"
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover-bg text-[11px]"
            style="color: var(--text-disabled);"
            :disabled="busy"
            @click="switchTo(null)"
          >
            <UIcon name="i-lucide-circle-slash" class="size-3.5 shrink-0" />
            No project — personal config only
          </button>

          <button
            v-if="!adding"
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover-bg text-[11px] font-medium"
            style="color: var(--accent);"
            @click="startAdding"
          >
            <UIcon name="i-lucide-plus" class="size-3.5 shrink-0" />
            Add a project
          </button>

          <div v-else class="p-3 space-y-2">
            <div class="relative">
              <input
                ref="pathField"
                v-model="pathInput"
                class="field-input text-[12px] font-mono"
                placeholder="~/code/your-project"
                autocomplete="off"
                @input="onInput"
                @keydown="onKeydown"
              />
              <div
                v-if="suggestions.length"
                class="mt-1 rounded-md overflow-hidden max-h-[180px] overflow-y-auto"
                style="border: 1px solid var(--border-subtle); background: var(--surface-raised);"
              >
                <button
                  v-for="(suggestion, idx) in suggestions"
                  :key="suggestion.path"
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors duration-75"
                  :style="{
                    background: idx === highlighted ? 'var(--accent-muted)' : 'transparent',
                    color: idx === highlighted ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }"
                  @click="pick(suggestion)"
                  @mouseenter="highlighted = idx"
                >
                  <UIcon
                    :name="suggestion.hasChildren ? 'i-lucide-folder' : 'i-lucide-folder-dot'"
                    class="size-3.5 shrink-0"
                    :style="{ color: idx === highlighted ? 'var(--accent)' : 'var(--text-disabled)' }"
                  />
                  <span class="text-[11px] font-mono truncate">{{ suggestion.name }}</span>
                  <UIcon
                    v-if="suggestion.hasChildren"
                    name="i-lucide-chevron-right"
                    class="size-3 shrink-0 ml-auto"
                    style="color: var(--text-disabled);"
                  />
                </button>
              </div>
            </div>

            <p v-if="error" class="text-[10px]" style="color: var(--error);">{{ error }}</p>

            <div class="flex items-center justify-end gap-2">
              <button
                v-if="projects.length"
                class="text-[11px] px-2 py-1 rounded hover-bg"
                style="color: var(--text-disabled);"
                @click="adding = false"
              >
                Cancel
              </button>
              <UButton label="Add" size="xs" :loading="busy" :disabled="!pathInput.trim()" @click="confirmAdd" />
            </div>
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>
