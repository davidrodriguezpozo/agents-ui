<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { mergeSkillFrontmatter } from '~/utils/skillFrontmatter'
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
    e.name = 'Names can only contain lowercase letters, numbers, and hyphens (e.g., code-review)'
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
    // Merged over what was read rather than rebuilt from these four fields:
    // editing a skill that carries `allowed-tools` or `license` must not be the
    // thing that deletes them. `initial` is undefined when creating, and merging
    // onto nothing is just the fields.
    const fm = mergeSkillFrontmatter(props.initial?.frontmatter, frontmatter.value)

    const isEdit = props.mode === 'edit' && props.initial
    const skill = isEdit
      ? await update(props.initial!.slug, { frontmatter: fm, body: body.value })
      : await create({ frontmatter: fm, body: body.value })
    toast.add({ title: isEdit ? 'Skill updated' : 'Skill created', color: 'success' })
    emit('saved', skill)
  } catch (e: any) {
    toast.add({ title: `Failed to ${props.mode} skill`, description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="p-6 space-y-4 bg-overlay">
    <h3 class="text-page-title">{{ mode === 'edit' ? 'Edit Skill' : 'New Skill' }}</h3>
    <p class="text-[12px] leading-relaxed text-label">
      Skills are specific capabilities that can be added to agents. Define what this skill does and when it should be used.
    </p>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="field-group">
        <label class="field-label" data-required>Name</label>
        <input
          v-model="frontmatter.name"
          class="field-input"
          :class="{ 'field-input--error': fieldError('name') }"
          placeholder="code-review"
        />
        <span v-if="fieldError('name')" class="field-error">{{ fieldError('name') }}</span>
        <span v-else class="field-hint">Used as an identifier (e.g., code-review)</span>
      </div>

      <div class="field-group">
        <label class="field-label">Availability</label>
        <input v-model="frontmatter.context" class="field-input" placeholder="Leave blank for always available" />
        <span class="field-hint">Optionally restrict when this skill appears. Leave blank to make it always available.</span>
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
      <label class="field-label">Instructions</label>
      <span class="field-hint">Write detailed instructions for what Claude should do when this skill is used.</span>
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
