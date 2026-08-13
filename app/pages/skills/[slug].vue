<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import {
  formatAllowedTools,
  mergeSkillFrontmatter,
  normalizeSkillFrontmatter,
  parseAllowedTools,
} from '~/utils/skillFrontmatter'
import type { Skill, SkillFile, SkillFrontmatter } from '~/types'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { fetchOne, update, remove } = useSkills()
const { prefillSkill } = useChat()
const { agents } = useAgents()

const slug = route.params.slug as string
const skill = ref<Skill | null>(null)
const isImported = computed(() => skill.value?.source === 'github')
const saving = ref(false)

const frontmatter = ref<SkillFrontmatter>({ name: '', description: '' })
const body = ref('')
/** Held as text because that is how people type a list into one field. */
const allowedTools = ref('')

/**
 * Supporting files kept apart from `skill`, because saving the instructions
 * returns the written SKILL.md and knows nothing about the rest of the
 * directory — folding that response into `skill` would blank the tree.
 */
const files = ref<SkillFile[]>([])

/**
 * What the frontmatter would look like written to disk right now.
 *
 * Built by merging over what was read, so keys this editor has no field for —
 * `license`, `metadata`, anything a future version of the format adds — are
 * still there afterwards. Rebuilding it from the fields instead is how saving a
 * typo fix used to delete a skill's `allowed-tools` without saying so.
 */
const editedFrontmatter = computed(() => mergeSkillFrontmatter(skill.value?.frontmatter, {
  ...frontmatter.value,
  'allowed-tools': parseAllowedTools(allowedTools.value),
}))

/** The file as it stands on disk, normalised the way a save would write it. */
const baseline = ref('')

const { hasDraft, draftAge, loadDraft, clearDraft, scheduleSave } = useDraftRecovery(`skill:${slug}`)

watch([frontmatter, body, allowedTools], () => {
  if (skill.value) scheduleSave(editedFrontmatter.value, body.value)
}, { deep: true })

function restoreDraft() {
  const draft = loadDraft()
  if (draft) {
    const fm = draft.frontmatter as SkillFrontmatter
    frontmatter.value = { ...fm }
    allowedTools.value = formatAllowedTools(fm['allowed-tools'])
    body.value = draft.body
    clearDraft()
    toast.add({ title: 'Draft restored', color: 'success' })
  }
}

/** Load the editor from a skill as fetched, and reset what "unchanged" means. */
function adopt(loaded: Skill) {
  skill.value = loaded
  frontmatter.value = { ...loaded.frontmatter }
  allowedTools.value = formatAllowedTools(loaded.frontmatter['allowed-tools'])
  body.value = loaded.body
  if (loaded.files) files.value = loaded.files
  baseline.value = JSON.stringify(normalizeSkillFrontmatter(loaded.frontmatter))
}

onMounted(async () => {
  try {
    adopt(await fetchOne(slug))
  } catch {
    toast.add({ title: 'Skill not found', color: 'error' })
    router.push('/skills')
  }
})

async function save() {
  if (!frontmatter.value.name.trim()) {
    toast.add({ title: 'Name is required', color: 'error' })
    return
  }

  saving.value = true
  try {
    const fm = editedFrontmatter.value
    const updated = await update(slug, { frontmatter: fm, body: body.value })

    // The PUT response carries no file list — the tree on screen is still right,
    // so it is kept rather than overwritten with nothing.
    adopt({ ...updated, files: files.value })
    clearDraft()
    toast.add({ title: 'Saved', color: 'success' })
    if (updated.slug !== slug) router.replace(`/skills/${updated.slug}`)
  } catch (e: any) {
    toast.add({ title: 'Failed to save', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

const showDeleteConfirm = ref(false)

async function deleteSkill() {
  try {
    await remove(slug)
    toast.add({ title: 'Deleted', color: 'success' })
    router.push('/skills')
  } catch {
    toast.add({ title: 'Failed to delete', color: 'error' })
  }
}

/**
 * Copy a read-only skill into one you own — supporting files included.
 *
 * Copying only SKILL.md produces instructions that refer to `references/api.md`
 * beside a directory that has no such file, which is a broken skill that looks
 * like a working one. Binary assets are the exception and are named rather than
 * silently dropped: they go through a text read that would corrupt them.
 */
async function editCopy() {
  if (!skill.value) return
  const { create, readFile, saveFile } = useSkills()

  try {
    const copy = await create({
      frontmatter: { ...skill.value.frontmatter, name: skill.value.frontmatter.name + ' (copy)' },
      body: skill.value.body,
    })

    const skipped: string[] = []
    for (const file of files.value) {
      if (file.kind !== 'file') continue
      if (file.binary) {
        skipped.push(file.path)
        continue
      }
      try {
        const { content } = await readFile(slug, file.path)
        await saveFile(copy.slug, file.path, content)
      } catch {
        skipped.push(file.path)
      }
    }

    toast.add({
      title: 'Copy created',
      description: skipped.length ? `Not copied: ${skipped.join(', ')}` : undefined,
      color: skipped.length ? 'warning' : 'success',
    })
    router.push(`/skills/${copy.slug}`)
  } catch (e: any) {
    toast.add({ title: 'Failed to create copy', description: errorMessage(e), color: 'error' })
  }
}

// Cmd+S to save
if (import.meta.client) {
  const onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      save()
    }
  }
  onMounted(() => document.addEventListener('keydown', onKeydown))
  onUnmounted(() => document.removeEventListener('keydown', onKeydown))
}

const charCount = computed(() => body.value.length)
const lineCount = computed(() => body.value.split('\n').length)

const isDirty = computed(() => {
  if (!skill.value) return false
  return JSON.stringify(editedFrontmatter.value) !== baseline.value
    || body.value !== skill.value.body
})

useUnsavedChanges(isDirty)

const agentOptions = computed(() =>
  agents.value.map(a => a.frontmatter.name)
)
</script>

<template>
  <div>
    <PageHeader :title="skill?.frontmatter.name || slug">
      <template #leading>
        <NuxtLink to="/skills" class="focus-ring rounded p-1.5 -m-1.5" aria-label="Back to skills">
          <UIcon name="i-lucide-arrow-left" class="size-4 text-label" />
        </NuxtLink>
      </template>
      <template #trailing>
        <UIcon name="i-lucide-sparkles" class="size-4 ink-accent" />
        <SourceBadge
          v-if="skill"
          :scope="skill.scope"
          :source="skill.source === 'plugin' ? 'plugin' : skill.source === 'github' ? 'github' : 'local'"
          :plugin-name="skill.pluginName"
          :github-repo="skill.githubRepo"
          :project-dir="skill.projectDir"
        />
        <NuxtLink
          v-if="skill?.pluginId"
          :to="`/plugins/${encodeURIComponent(skill.pluginId)}?tab=skills`"
          class="fs-mono px-2 py-0.5 rounded focus-ring text-meta hover-bg"
        >
          View in plugin
        </NuxtLink>
      </template>
      <template #right>
        <UButton
          label="Use"
          icon="i-lucide-play"
          size="sm"
          variant="soft"
          :disabled="!skill"
          @click="prefillSkill(skill!.frontmatter.name)"
        />
        <a
          :href="`/api/skills/${slug}/export`"
          download
          class="fs-sm px-2 py-1 rounded focus-ring text-label hover-bg"
          title="Download .md file"
        >
          <UIcon name="i-lucide-download" class="size-3.5" />
        </a>
        <template v-if="!isImported">
          <button
            class="fs-sm px-2 py-1 rounded focus-ring text-label"
            @click="showDeleteConfirm = true"
          >
            Delete
          </button>
          <span v-if="isDirty" class="fs-micro font-mono unsaved-pulse ink-warn">unsaved</span>
          <UButton label="Save" icon="i-lucide-save" size="sm" :loading="saving" @click="save" />
        </template>
        <UButton v-else label="Edit a copy" icon="i-lucide-copy" size="sm" @click="editCopy" />
      </template>
    </PageHeader>

    <div v-if="skill" class="page-container py-6 space-y-6">
      <!-- Draft recovery banner -->
      <div
        v-if="hasDraft"
        class="rounded-lg px-4 py-3 flex items-center gap-3"
        style="background: var(--info-wash); border: 1px solid var(--info-tint);"
      >
        <UIcon name="i-lucide-archive-restore" class="size-4 shrink-0" style="color: var(--info);" />
        <span class="fs-sm flex-1 ink-2">
          You have an unsaved draft from {{ draftAge }}.
        </span>
        <button class="fs-sm font-medium px-2 py-1 rounded hover-bg" style="color: var(--info);" @click="restoreDraft">Restore</button>
        <button class="fs-sm px-2 py-1 rounded hover-bg text-meta" @click="clearDraft">Dismiss</button>
      </div>

      <!-- Read-only banner for imported skills -->
      <div
        v-if="isImported"
        class="rounded-lg px-4 py-3 flex items-center gap-3"
        style="background: var(--badge-subtle-bg); border: 1px solid var(--border-subtle);"
      >
        <svg class="size-4 shrink-0 text-label" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        <span class="fs-sm flex-1 text-label">
          This skill is imported from GitHub and is read-only. Updates from the source may overwrite local changes.
        </span>
        <UButton label="Edit a copy" size="xs" variant="soft" @click="editCopy" />
      </div>

      <!-- Configuration -->
      <div
        class="rounded-lg overflow-hidden"
        style="border: 1px solid var(--border-subtle);"
      >
        <!-- Skill identity banner -->
        <div class="relative px-5 pt-6 pb-5" style="background: var(--surface-raised);">
          <!-- Top accent bar -->
          <div
            class="absolute inset-x-0 top-0 h-[3px]"
            style="background: var(--accent);"
          />

          <!-- Identity row -->
          <div class="flex items-start gap-4">
            <div
              class="size-11 rounded-lg flex items-center justify-center shrink-0"
              style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
            >
              <UIcon name="i-lucide-sparkles" class="size-5 ink-accent" />
            </div>

            <div class="flex-1 min-w-0 pt-0.5">
              <div class="flex items-center gap-2.5 flex-wrap">
                <span class="fs-lg font-semibold truncate">
                  {{ frontmatter.name || 'Unnamed Skill' }}
                </span>
                <span
                  v-if="frontmatter.context"
                  class="fs-micro font-medium px-2 py-0.5 rounded-full shrink-0 badge badge-subtle"
                >
                  {{ frontmatter.context }}
                </span>
              </div>
              <p v-if="frontmatter.description" class="fs-sm mt-1 leading-relaxed text-label">
                {{ frontmatter.description }}
              </p>
            </div>
          </div>
        </div>

        <!-- Form fields -->
        <div class="px-5 py-4 space-y-4" style="background: var(--surface-base); border-top: 1px solid var(--border-subtle);">
          <h3 class="text-section-label">Configuration</h3>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="field-group">
              <label class="field-label">Name</label>
              <input v-model="frontmatter.name" class="field-input" :disabled="isImported" />
              <span class="field-hint">Identifier for this skill. Also used as the slash command name.</span>
            </div>
            <div class="field-group">
              <label class="field-label">Availability</label>
              <input v-model="frontmatter.context" class="field-input" :disabled="isImported" placeholder="Leave blank for always available" />
              <span class="field-hint">Restrict when this skill appears (e.g., only in certain repos)</span>
            </div>
            <div class="field-group">
              <label class="field-label">Agent</label>
              <input
                v-model="frontmatter.agent"
                class="field-input"
                :disabled="isImported"
                placeholder="Optional — link to an agent"
                :list="agentOptions.length > 0 ? 'agent-opts-detail' : undefined"
              />
              <datalist v-if="agentOptions.length > 0" id="agent-opts-detail">
                <option v-for="a in agentOptions" :key="a" :value="a" />
              </datalist>
              <span class="field-hint">Link this skill to a specific agent. The skill's instructions will be loaded when that agent is active.</span>
            </div>
            <div class="field-group">
              <label class="field-label">Allowed tools</label>
              <input
                v-model="allowedTools"
                class="field-input"
                :disabled="isImported"
                placeholder="Leave blank for every tool"
              />
              <span class="field-hint">Comma separated, e.g. Read, Grep, Bash. Restricts what this skill may do.</span>
            </div>
          </div>

          <div class="field-group">
            <label class="field-label">Description</label>
            <textarea v-model="frontmatter.description" rows="2" class="field-textarea" :disabled="isImported" />
            <span class="field-hint">Helps Claude decide when to use this skill. Be specific about the trigger.</span>
          </div>
        </div>
      </div>

      <!-- Skill Prompt Editor -->
      <div
        class="rounded-lg overflow-hidden"
        style="border: 1px solid var(--border-subtle);"
      >
        <div class="flex items-center justify-between px-4 py-2.5" style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);">
          <h3 class="text-section-label">Instructions</h3>
          <div class="flex items-center gap-3">
            <span class="type-mono-meta">
              {{ lineCount }} lines
            </span>
            <span class="type-mono-meta">
              {{ charCount.toLocaleString() }} chars
            </span>
          </div>
        </div>
        <CodeEditor v-model="body" path="SKILL.md" :disabled="isImported" />
      </div>

      <!-- The rest of the directory: references/, scripts/, assets/ -->
      <SkillFilesPanel
        :slug="slug"
        :files="files"
        :read-only="isImported || skill.source === 'plugin'"
        @update:files="(next) => { files = next }"
      />

      <!-- File location (collapsed) -->
      <details class="group">
        <summary class="fs-micro cursor-pointer list-none flex items-center gap-1.5 text-meta">
          <UIcon name="i-lucide-file" class="size-3" />
          Show file location
        </summary>
        <div class="mt-1 font-mono fs-micro pl-4.5 text-meta">
          {{ skill.filePath }}
        </div>
      </details>
    </div>

    <div v-else class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
    </div>

    <!-- Delete confirmation -->
    <UModal v-model:open="showDeleteConfirm">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay">
          <h3 class="text-page-title">Delete Skill</h3>
          <p class="type-body">
            Permanently delete <strong>{{ skill?.frontmatter.name }}</strong>? This action cannot be undone.
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="() => { showDeleteConfirm = false }" />
            <UButton label="Delete" color="error" size="sm" @click="deleteSkill" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
