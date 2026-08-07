<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

/**
 * Editing a file in the session's own workspace.
 *
 * The commonest reason to leave this app was that the agent got something
 * nearly right and you wanted to change one line — which meant finding the
 * worktree on disk and opening an editor.
 *
 * The workspace is a git worktree, so a save here lands in the session's diff
 * exactly like something the agent wrote, and moves the fingerprint that marks
 * the last check result as stale. Edit, re-check, land.
 */

const props = defineProps<{ sessionId: string }>()
const emit = defineEmits<{ saved: [] }>()

interface Entry {
  name: string
  path: string
  kind: 'file' | 'directory'
  size?: number
}

const dir = ref('')
const entries = ref<Entry[]>([])
const listing = ref(false)
const listError = ref<string | null>(null)

const openPath = ref<string | null>(null)
const content = ref('')
const original = ref('')
const loading = ref(false)
const saving = ref(false)
const fileError = ref<string | null>(null)

const dirty = computed(() => openPath.value !== null && content.value !== original.value)

/** Each ancestor of the current directory, so any level is one click away. */
const crumbs = computed(() => {
  const parts = dir.value ? dir.value.split('/') : []
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))
})

async function list(path: string) {
  listing.value = true
  listError.value = null
  try {
    const result = await $fetch<{ entries: Entry[] }>(
      `/api/sessions/${encodeURIComponent(props.sessionId)}/files`,
      { query: { path } },
    )
    entries.value = result.entries
    dir.value = path
  } catch (e) {
    listError.value = errorMessage(e)
  } finally {
    listing.value = false
  }
}

async function open(entry: Entry) {
  if (entry.kind === 'directory') return list(entry.path)

  // Losing an edit to a stray click would be worse than an extra question.
  if (dirty.value && !confirm('You have unsaved changes. Open another file and lose them?')) return

  loading.value = true
  fileError.value = null
  try {
    const file = await $fetch<{ path: string; content: string }>(
      `/api/sessions/${encodeURIComponent(props.sessionId)}/file`,
      { query: { path: entry.path } },
    )
    openPath.value = file.path
    content.value = file.content
    original.value = file.content
  } catch (e) {
    // Binary, too large, or gone since it was listed — all worth saying rather
    // than leaving an empty editor open.
    fileError.value = errorMessage(e)
    openPath.value = null
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!openPath.value || !dirty.value) return
  saving.value = true
  fileError.value = null
  try {
    await $fetch(`/api/sessions/${encodeURIComponent(props.sessionId)}/file`, {
      method: 'PUT',
      body: { path: openPath.value, content: content.value },
    })
    original.value = content.value
    // The diff and the check verdict both just changed underneath the page.
    emit('saved')
  } catch (e) {
    fileError.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}

function revert() {
  content.value = original.value
}

onMounted(() => void list(''))
</script>

<template>
  <div class="rounded-md overflow-hidden" style="border: 1px solid var(--border-subtle);">
    <div class="grid grid-cols-1 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <!-- The tree -->
      <div class="min-w-0 md:border-r" style="border-color: var(--border-subtle);">
        <div class="px-3 py-2 flex items-center gap-1 flex-wrap" style="background: var(--surface-raised);">
          <button class="type-detail hover:underline" @click="list('')">workspace</button>
          <template v-for="crumb in crumbs" :key="crumb.path">
            <span class="type-meta">/</span>
            <button class="type-detail hover:underline" @click="list(crumb.path)">{{ crumb.name }}</button>
          </template>
        </div>

        <p v-if="listError" class="px-3 py-2 type-meta" style="color: var(--error);">{{ listError }}</p>

        <div v-else class="max-h-80 overflow-y-auto py-1">
          <button
            v-if="dir"
            class="w-full text-left px-3 py-1 type-detail hover-row"
            @click="list(crumbs.length > 1 ? crumbs[crumbs.length - 2]!.path : '')"
          >
            <UIcon name="i-lucide-corner-left-up" class="size-3 mr-1.5" />up
          </button>

          <button
            v-for="entry in entries"
            :key="entry.path"
            class="w-full text-left px-3 py-1 type-detail hover-row flex items-center gap-1.5 truncate"
            :style="{ color: openPath === entry.path ? 'var(--accent)' : undefined }"
            @click="open(entry)"
          >
            <UIcon
              :name="entry.kind === 'directory' ? 'i-lucide-folder' : 'i-lucide-file'"
              class="size-3 shrink-0"
              :style="{ color: entry.kind === 'directory' ? 'var(--accent)' : 'var(--text-disabled)' }"
            />
            <span class="truncate">{{ entry.name }}</span>
          </button>

          <p v-if="!listing && !entries.length" class="px-3 py-2 type-meta">Nothing here.</p>
        </div>
      </div>

      <!-- The file -->
      <div class="min-w-0">
        <div
          class="px-3 py-2 flex items-center gap-2"
          style="background: var(--surface-raised);"
        >
          <span class="type-detail font-mono truncate flex-1">
            {{ openPath ?? 'No file open' }}
          </span>
          <span v-if="dirty" class="type-meta" style="color: var(--warning);">unsaved</span>
          <UButton
            v-if="dirty"
            label="Revert"
            size="xs"
            variant="ghost"
            color="neutral"
            @click="revert"
          />
          <UButton
            label="Save"
            size="xs"
            :loading="saving"
            :disabled="!dirty"
            @click="save"
          />
        </div>

        <p v-if="fileError" class="px-3 py-2 type-meta" style="color: var(--error);">{{ fileError }}</p>

        <textarea
          v-else-if="openPath"
          v-model="content"
          class="editor-textarea w-full"
          rows="18"
          spellcheck="false"
          :disabled="loading"
        />

        <p v-else class="px-3 py-6 type-meta text-center">
          Pick a file on the left. Saving puts the change in this session's branch, like
          anything the agent wrote — its checks will need running again.
        </p>
      </div>
    </div>
  </div>
</template>
