<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { relativeTime } from '~/utils/time'

/**
 * What every run is told before it starts.
 *
 * The panel shows the text itself rather than a description of it, and that is
 * the whole design. A summary of what runs receive is a thing that can be wrong
 * about what runs receive — and the first question anybody has about a feature
 * that edits every prompt on the machine is "what exactly is it putting in
 * there". So: the real string, from the same function the runs use.
 *
 * Collapsed by default, because on a normal day the answer is "the obvious
 * things" and this is not a surface to read every morning. What is worth having
 * open is the note, which is the only part a person writes.
 */
interface Brief {
  enabled: boolean
  pinned: string
  facts: {
    sessions: { title: string; branch: string; repo: string }[]
    rituals: { title: string; trouble: string }[]
    waiting: { source: string; count: number }[]
    moreSessions: number
  }
  updatedAt?: number
  text: string
}

const brief = ref<Brief | null>(null)
const loading = ref(true)
const saving = ref(false)
const open = ref(false)
const showText = ref(false)
const pinned = ref('')
const toast = useToast()

async function load() {
  try {
    brief.value = await $fetch<Brief>('/api/brief')
    pinned.value = brief.value.pinned
  } catch (e) {
    toast.add({ title: 'Could not read the brief', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function save(patch: { pinned?: string; enabled?: boolean }) {
  saving.value = true
  try {
    brief.value = await $fetch<Brief>('/api/brief', { method: 'PUT', body: patch })
    pinned.value = brief.value.pinned
    if (patch.pinned !== undefined) {
      toast.add({
        title: 'Saved',
        description: 'Every run that starts from now on is told this.',
        color: 'success',
      })
    }
  } catch (e) {
    toast.add({ title: 'Could not save that', description: errorMessage(e), color: 'error' })
    await load()
  } finally {
    saving.value = false
  }
}

const changed = computed(() => brief.value !== null && pinned.value !== brief.value.pinned)

/** One line for the collapsed state: what is in it, not how it works. */
const summary = computed(() => {
  const facts = brief.value?.facts
  if (!brief.value?.text) return 'Nothing to say yet, so runs are told nothing.'

  const bits: string[] = []
  const sessions = (facts?.sessions.length ?? 0) + (facts?.moreSessions ?? 0)
  if (sessions) bits.push(`${sessions} session${sessions === 1 ? '' : 's'} in flight`)
  if (facts?.rituals.length) bits.push(`${facts.rituals.length} ritual${facts.rituals.length === 1 ? '' : 's'} not working`)

  const waiting = facts?.waiting.reduce((total, entry) => total + entry.count, 0) ?? 0
  if (waiting) bits.push(`${waiting} waiting elsewhere`)
  if (brief.value.pinned.trim()) bits.push('your own notes')

  return bits.length ? bits.join(' · ') : 'Nothing to say yet, so runs are told nothing.'
})
</script>

<template>
  <div
    class="rounded-lg overflow-hidden"
    style="border: 1px solid var(--border-subtle);"
  >
    <button
      class="w-full flex items-center justify-between gap-3 px-4 py-3 hover-bg text-left"
      style="background: var(--surface-raised);"
      @click="open = !open"
    >
      <span class="flex items-center gap-2 min-w-0">
        <UIcon
          name="i-lucide-notebook-pen"
          class="size-4 shrink-0"
          style="color: var(--accent);"
        />
        <span class="min-w-0">
          <span class="text-section-title block">Standing brief</span>
          <span class="type-meta truncate block">{{ loading ? 'Reading…' : summary }}</span>
        </span>
      </span>
      <UIcon
        :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        class="size-3.5 shrink-0 text-meta"
      />
    </button>

    <div
      v-if="open"
      class="px-4 py-4 space-y-4"
    >
      <p class="type-body">
        Handed to every run that starts cold — rituals, workflow steps, the first turn of a
        session — so it stops rediscovering which branches are yours every morning. It is
        assembled from this machine's own records rather than written by a model, which is what
        makes it free and what stops it inventing a branch. A conversation already under way is
        left alone.
      </p>

      <label class="space-y-1.5 block">
        <span class="type-meta">What it should always know</span>
        <textarea
          v-model="pinned"
          rows="4"
          placeholder="Ana is out until September. The release goes out on Thursdays. Do not touch the billing service directly."
          class="field-input w-full font-mono fs-sm"
        />
        <span class="type-meta block">
          The standing facts nothing on disk can know. This half is never overwritten by an
          assembly — and it is added to every run, so keep it the size of a note.
        </span>
      </label>

      <div class="flex items-center gap-3">
        <UButton
          label="Save"
          size="sm"
          :disabled="!changed"
          :loading="saving"
          @click="save({ pinned })"
        />
        <UButton
          :label="showText ? 'Hide what runs are told' : 'Show what runs are told'"
          size="sm"
          variant="ghost"
          @click="() => { showText = !showText }"
        />
        <span
          v-if="brief?.updatedAt"
          class="type-meta ml-auto"
        >Rebuilt {{ relativeTime(brief.updatedAt) }}</span>
      </div>

      <!--
        The real string, from the same function a run gets it from. A panel that
        paraphrases this is a panel that can be wrong about it.
      -->
      <pre
        v-if="showText"
        class="rounded-md p-3 overflow-x-auto fs-sm font-mono whitespace-pre-wrap"
        style="background: var(--input-bg); color: var(--text-secondary);"
      >{{ brief?.text || 'Nothing — there is nothing to say, so nothing is added.' }}</pre>

      <label
        class="flex items-start justify-between gap-4 py-2 px-3 rounded-md cursor-pointer"
        style="background: var(--input-bg);"
      >
        <span>
          <span class="type-strong text-body block">Give it to runs</span>
          <span class="type-meta">
            Off means runs start knowing nothing about the rest of your work, which is what they
            did before this existed.
          </span>
        </span>
        <span class="field-toggle shrink-0 mt-0.5">
          <input
            type="checkbox"
            :checked="brief?.enabled !== false"
            @change="save({ enabled: ($event.target as HTMLInputElement).checked })"
          />
          <span class="field-toggle__track">
            <span class="field-toggle__thumb" />
          </span>
        </span>
      </label>
    </div>
  </div>
</template>
