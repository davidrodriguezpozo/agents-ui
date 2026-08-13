<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

/**
 * Putting the workspace back.
 *
 * Two things people ask for, kept apart because they cost different amounts:
 * throwing away what is uncommitted, and taking a whole turn off. Both name
 * what will be lost before doing it — a rewind is the one action here whose
 * damage cannot be undone by another button.
 */

const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ changed: [] }>()

interface Preview {
  changed: string[]
  untracked: string[]
  commits: { sha: string; subject: string }[]
  canDiscard: boolean
  canUndoCommit: boolean
  unavailable?: string
}

const preview = ref<Preview | null>(null)
const busy = ref(false)
const note = ref<string | null>(null)
const error = ref<string | null>(null)

async function load() {
  try {
    preview.value = await $fetch<Preview>(
      `/api/sessions/${encodeURIComponent(props.sessionId)}/rewind`,
    )
  } catch (e) {
    error.value = errorMessage(e)
  }
}

const lostByDiscard = computed(() => [
  ...(preview.value?.changed ?? []),
  ...(preview.value?.untracked ?? []),
])

async function go(target: 'uncommitted' | 'commit') {
  const what = target === 'uncommitted'
    ? `Throw away changes to ${lostByDiscard.value.length} file(s)? This cannot be undone.`
    : `Undo "${preview.value?.commits[0]?.subject}"? Anything uncommitted goes with it, and this cannot be undone.`

  // The one action here whose damage no other button can repair.
  if (!confirm(what)) return

  busy.value = true
  error.value = null
  try {
    const result = await $fetch<{ done: boolean; message: string }>(
      `/api/sessions/${encodeURIComponent(props.sessionId)}/rewind`,
      { method: 'POST', body: { target } },
    )
    note.value = result.message
    await load()
    // The diff, the branch position and the check verdict all just moved.
    if (result.done) emit('changed')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="rounded-md p-4 space-y-3" style="border: 1px solid var(--border-subtle);">
    <div class="text-section-label">Put it back</div>

    <p v-if="error" class="type-meta ink-error">{{ error }}</p>
    <p v-else-if="preview?.unavailable" class="type-meta">{{ preview.unavailable }}</p>

    <template v-else-if="preview">
      <p v-if="note" class="type-meta ink-ok">{{ note }}</p>

      <!-- Named, not counted: a list is something you can check against what
           you remember doing, and a number is something you have to trust. -->
      <div v-if="preview.canDiscard" class="space-y-1.5">
        <p class="type-meta">
          Uncommitted, and would go:
          <span class="font-mono">{{ lostByDiscard.slice(0, 4).join(', ') }}</span>
          <template v-if="lostByDiscard.length > 4">
            and {{ lostByDiscard.length - 4 }} more
          </template>
        </p>
        <UButton
          label="Throw away uncommitted changes"
          icon="i-lucide-undo-2"
          size="xs"
          variant="soft"
          color="neutral"
          :loading="busy"
          @click="go('uncommitted')"
        />
      </div>

      <div v-if="preview.canUndoCommit" class="space-y-1.5">
        <p class="type-meta">
          Last commit: <span class="font-mono">{{ preview.commits[0]!.subject }}</span>
        </p>
        <UButton
          label="Undo that commit"
          icon="i-lucide-rotate-ccw"
          size="xs"
          variant="soft"
          color="neutral"
          :loading="busy"
          @click="go('commit')"
        />
      </div>

      <p v-if="!preview.canDiscard && !preview.canUndoCommit" class="type-meta">
        Nothing to put back — this workspace is exactly where it branched from.
      </p>

      <p class="field-hint">
        Only ever this session's own work. It cannot reach past the commit the session
        branched from, so nothing in your repository's history is at risk here.
      </p>
    </template>
  </div>
</template>
