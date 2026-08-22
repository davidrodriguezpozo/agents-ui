<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import type { EditorChoice } from '~/composables/useEditor'

/**
 * The way out of here, to a real editor.
 *
 * One control in two places — the session header and every row of
 * `WorktreePanel` — because the thing it does is the same in both: hand this
 * worktree's absolute path to whatever this machine opens projects with. The
 * press uses the remembered editor; the caret beside it changes which one that
 * is, and opens it there in the same motion, so nobody has to visit Settings to
 * use this once.
 *
 * The path is never turned into a link in the page. A browser will not navigate
 * an `http` page to a `file` URL at all, and nothing here knows whether the
 * directory still exists — see `server/api/editor/open.post.ts`, which answers
 * both.
 */
const props = defineProps<{
  path: string
  /** Icon only, for a row with no room for the sentence. */
  compact?: boolean
  /** The page already knows the directory is gone, so do not offer to open it. */
  missing?: boolean
}>()

const { choice, options, opening, label, load, openIn } = useEditor()
const toast = useToast()

onMounted(load)

const busy = computed(() => opening.value === props.path)

async function open(editor?: EditorChoice) {
  if (props.missing || busy.value) return

  try {
    const result = await openIn(props.path, editor)
    toast.add({ title: `Opened in ${result.name}`, description: props.path, color: 'success' })
  } catch (e) {
    toast.add({ title: 'Could not open it', description: errorMessage(e), color: 'error' })
  }
}

/**
 * A tick against the one the plain press uses, so the menu says which it is
 * rather than making you remember. Everything else carries the icon for what
 * kind of thing it is: an editor, or the folder itself.
 */
const menu = computed(() => [
  options.value.map(option => ({
    label: option.label,
    icon: option.id === choice.value
      ? 'i-lucide-check'
      : option.id === 'finder' ? 'i-lucide-folder-open' : 'i-lucide-code',
    onSelect: () => { void open(option.id) },
  })),
])
</script>

<template>
  <div class="flex items-center shrink-0">
    <UButton
      :label="compact ? undefined : `Open in ${label}`"
      icon="i-lucide-external-link"
      :size="compact ? 'xs' : 'sm'"
      variant="ghost"
      color="neutral"
      :loading="busy"
      :disabled="missing"
      :title="missing
        ? 'This workspace is no longer on disk.'
        : `Open ${path} in ${label}`"
      :aria-label="`Open in ${label}`"
      @click="open()"
    />
    <UDropdownMenu :items="menu" :popper="{ placement: 'bottom-end' }">
      <UButton
        icon="i-lucide-chevron-down"
        :size="compact ? 'xs' : 'sm'"
        variant="ghost"
        color="neutral"
        :disabled="missing"
        class="-ml-1.5 px-0.5"
        aria-label="Choose an editor"
      />
    </UDropdownMenu>
  </div>
</template>
