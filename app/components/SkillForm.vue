<script setup lang="ts">
import type { Skill, SkillFrontmatter } from '~/types'

const props = defineProps<{
  mode: 'create' | 'edit'
  initial?: Skill
}>()

const emit = defineEmits<{
  saved: [skill: Skill]
  cancel: []
}>()

const { create, update } = useSkills()
const { agents } = useAgents()
const toast = useToast()
const saving = ref(false)
const submitted = ref(false)

const frontmatter = ref<SkillFrontmatter>({
  name: props.initial?.frontmatter.name || '',
  description: props.initial?.frontmatter.description || '',
  context: props.initial?.frontmatter.context,
  agent: props.initial?.frontmatter.agent,
})

const body = ref(props.initial?.body || '')

const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!frontmatter.value.name.trim()) e.name = 'Name is required'
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(frontmatter.value.name.trim()))
    e.name = 'Use lowercase letters, numbers, and hyphens only'
  if (!frontmatter.value.description.trim()) e.description = 'Description is required'
  return e
})

const isValid = computed(() => Object.keys(errors.value).length === 0)

function fieldError(field: string) {
  return submitted.value ? errors.value[field] : undefined
}

const agentOptions = computed(() =>
  agents.value.map(a => a.frontmatter.name)
)

async function save() {
  submitted.value = true
  if (!isValid.value) return

  saving.value = true
  try {
    // Clean empty optional fields
    const fm: SkillFrontmatter = {
      name: frontmatter.value.name.trim(),
      description: frontmatter.value.description.trim(),
    }
    if (frontmatter.value.context?.trim()) fm.context = frontmatter.value.context.trim()
    if (frontmatter.value.agent?.trim()) fm.agent = frontmatter.value.agent.trim()

    const isEdit = props.mode === 'edit' && props.initial
    const skill = isEdit
      ? await update(props.initial!.slug, { frontmatter: fm, body: body.value })
      : await create({ frontmatter: fm, body: body.value })
    toast.add({ title: isEdit ? 'Skill updated' : 'Skill created', color: 'success' })
    emit('saved', skill)
  } catch (e: any) {
    toast.add({ title: `Failed to ${props.mode} skill`, description: e.data?.message || e.message, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="p-6 space-y-4" style="background: var(--surface-overlay);">
    <h3 class="text-page-title">{{ mode === 'edit' ? 'Edit Skill' : 'New Skill' }}</h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="field-group">
        <label class="field-label" data-required>Name</label>
        <input
          v-model="frontmatter.name"
          class="field-input"
          :class="{ 'field-input--error': fieldError('name') }"
          placeholder="my-skill"
        />
        <span v-if="fieldError('name')" class="field-error">{{ fieldError('name') }}</span>
        <span v-else class="field-hint">Skill identifier (used as directory name)</span>
      </div>

      <div class="field-group">
        <label class="field-label">Context</label>
        <input v-model="frontmatter.context" class="field-input" placeholder="e.g. fork, worktree" />
        <span class="field-hint">Execution context for this skill</span>
      </div>
    </div>

    <div class="field-group">
      <label class="field-label" data-required>Description</label>
      <textarea
        v-model="frontmatter.description"
        rows="2"
        class="field-textarea"
        :class="{ 'field-input--error': fieldError('description') }"
        placeholder="When to use this skill and what it does..."
      />
      <span v-if="fieldError('description')" class="field-error">{{ fieldError('description') }}</span>
    </div>

    <div class="field-group">
      <label class="field-label">Agent</label>
      <input
        v-model="frontmatter.agent"
        class="field-input"
        placeholder="Optional — link to an agent"
        :list="agentOptions.length > 0 ? 'agent-opts' : undefined"
      />
      <datalist v-if="agentOptions.length > 0" id="agent-opts">
        <option v-for="a in agentOptions" :key="a" :value="a" />
      </datalist>
      <span class="field-hint">Agent that handles this skill</span>
    </div>

    <div class="field-group">
      <label class="field-label">Skill Prompt</label>
      <textarea
        v-model="body"
        class="editor-textarea editor-textarea--standalone"
        spellcheck="false"
        placeholder="Instructions for this skill..."
      />
    </div>

    <div class="flex justify-end gap-2 pt-2">
      <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="emit('cancel')" />
      <UButton :label="mode === 'edit' ? 'Save' : 'Create'" size="sm" :loading="saving" @click="save" />
    </div>
  </div>
</template>
