<script setup lang="ts">
import type { BranchRef, PullRequestRef } from '~/composables/useGitRefs'

/**
 * A branch or a pull request, chosen from what exists.
 *
 * Every field that took a ref was free text, and a ref typed slightly wrong is
 * the worst kind of mistake this app can make: it does not fail, it just never
 * matches. A trigger watching `feature/Foo` when the branch is `feature/foo`
 * looks exactly like a trigger with nothing to do.
 *
 * **Still a text box.** The list narrows the common case; it does not close the
 * uncommon one. A branch that does not exist yet, a pull request from a fork,
 * a URL pasted from somebody's message — all still typeable, and the dropdown
 * simply stops matching. Anything that made the free-text path harder would be
 * trading a rare mistake for a routine dead end.
 */

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  /** The repository whose refs to offer. Absent uses the selected project. */
  repoDir?: string | null
  /** Whether open pull requests are offered alongside the branches. */
  withPullRequests?: boolean
  disabled?: boolean
  /** Applied to the input, so a caller can keep its own field styling. */
  inputClass?: string
}>(), {
  placeholder: '',
  repoDir: null,
  withPullRequests: false,
  disabled: false,
  inputClass: 'field-input font-mono',
})

const emit = defineEmits<{ 'update:modelValue': [value: string]; 'enter': [] }>()

const { refs, load } = useGitRefs()

const open = ref(false)
const selected = ref(0)
const root = ref<HTMLElement | null>(null)

onMounted(() => { void load(props.repoDir, { pulls: props.withPullRequests }) })

// Switching project while a dialog is open should offer that project's refs.
watch(() => props.repoDir, () => {
  void load(props.repoDir, { pulls: props.withPullRequests })
})

interface Entry {
  /** What goes in the field when this is chosen. */
  value: string
  label: string
  meta: string
  kind: 'pr' | 'branch'
  badge?: string
}

const entries = computed<Entry[]>(() => {
  const pulls: Entry[] = props.withPullRequests
    ? refs.value.pullRequests.map((pr: PullRequestRef) => ({
        // `#123` rather than the URL: the server parses both, and this is the
        // one somebody can still read in the field a week later.
        value: `#${pr.number}`,
        label: `#${pr.number} ${pr.title}`,
        meta: pr.headBranch,
        kind: 'pr' as const,
        badge: pr.draft ? 'draft' : undefined,
      }))
    : []

  const branches: Entry[] = refs.value.branches.map((branch: BranchRef) => ({
    value: branch.name,
    label: branch.name,
    meta: branch.subject,
    kind: 'branch' as const,
    badge: branch.current ? 'current' : branch.remoteOnly ? 'remote' : undefined,
  }))

  return [...pulls, ...branches]
})

/**
 * Matched on every word typed, in any order and anywhere in the entry.
 *
 * Branch names are paths — `feature/auth/retry-login` — and the part somebody
 * remembers is rarely the prefix. A `startsWith` filter would hide the branch
 * they are looking for while they type the middle of its name.
 */
const matches = computed(() => {
  const needles = props.modelValue.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!needles.length) return entries.value.slice(0, 50)

  return entries.value
    .filter((entry) => {
      const haystack = `${entry.label} ${entry.meta}`.toLowerCase()
      return needles.every(needle => haystack.includes(needle))
    })
    .slice(0, 50)
})

// A filtered list whose selection stayed put would insert the wrong thing.
watch(matches, () => { selected.value = 0 })

function choose(index = selected.value) {
  const entry = matches.value[index]
  if (!entry) return

  emit('update:modelValue', entry.value)
  open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' && !open.value) {
    open.value = true
    return
  }

  if (!open.value || !matches.value.length) {
    // Enter with nothing to pick belongs to whoever is using this — usually
    // "start on what I typed", which must keep working for a free-text ref.
    if (event.key === 'Enter') emit('enter')
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    selected.value = (selected.value + 1) % matches.value.length
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    selected.value = (selected.value - 1 + matches.value.length) % matches.value.length
    return
  }
  if (event.key === 'Escape') {
    // Swallowed, so it closes this list rather than the dialog around it —
    // which would take the half-filled form with it.
    event.preventDefault()
    event.stopPropagation()
    open.value = false
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    choose()
  }
}

/**
 * Closed by clicking anywhere else, rather than on blur.
 *
 * `blur` fires before the click it was caused by, so closing there means a
 * click on an option lands on nothing. The usual fix is a timeout, which is a
 * race with a person's mouse; this one has no timing in it.
 */
function onDocumentPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <div ref="root" class="relative">
    <input
      :value="modelValue"
      :class="inputClass"
      :placeholder="placeholder"
      :disabled="disabled"
      spellcheck="false"
      autocomplete="off"
      class="w-full"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @focus="() => { open = true }"
      @keydown="onKeydown"
    />

    <div
      v-if="open && matches.length"
      class="absolute top-full left-0 right-0 mt-1.5 z-20 rounded-md overflow-hidden shadow-lg"
      style="background: var(--surface-overlay); border: 1px solid var(--border-subtle);"
    >
      <div class="max-h-56 overflow-y-auto py-1">
        <button
          v-for="(entry, index) in matches"
          :key="`${entry.kind}:${entry.value}`"
          type="button"
          class="w-full flex items-center gap-2 px-3 py-1.5 text-left"
          :style="{ background: index === selected ? 'var(--accent-muted)' : undefined }"
          @mouseenter="selected = index"
          @click="choose(index)"
        >
          <UIcon
            :name="entry.kind === 'pr' ? 'i-lucide-git-pull-request' : 'i-lucide-git-branch'"
            class="size-3.5 shrink-0"
            style="color: var(--text-disabled);"
          />
          <span class="font-mono type-detail truncate" :style="{ color: 'var(--text-primary)' }">
            {{ entry.label }}
          </span>
          <span class="type-meta flex-1 min-w-0 truncate">{{ entry.meta }}</span>
          <span
            v-if="entry.badge"
            class="text-[9px] font-mono px-1.5 py-px rounded-full shrink-0"
            style="background: var(--accent-muted); color: var(--accent);"
          >
            {{ entry.badge }}
          </span>
        </button>
      </div>

      <div
        class="px-3 py-1 type-meta"
        style="border-top: 1px solid var(--border-subtle);"
      >
        ↑↓ to choose · ↵ to pick · or keep typing
      </div>
    </div>
  </div>
</template>
