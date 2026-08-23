<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import type { Skill } from '~/types'

/**
 * Guided skill authoring for people who will never write YAML frontmatter.
 * Asks three plain questions, validates against the limits Claude enforces,
 * and can draft the instructions with Claude when someone is stuck.
 */
const emit = defineEmits<{
  saved: [skill: Skill]
  cancel: []
  /** Swap this flow for the raw frontmatter form. */
  raw: []
}>()

const { create } = useSkills()
const { createScope, canUseProjectScope } = useScope()
const toast = useToast()

const NAME_MAX = 64
const DESCRIPTION_MAX = 1024

const step = ref<1 | 2 | 3>(1)
const title = ref('')
const whenToUse = ref('')
const instructions = ref('')
const saving = ref(false)
const drafting = ref(false)

/** Claude matches skills by directory name, which must be a plain slug. */
const slug = computed(() =>
  title.value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, NAME_MAX)
)

const nameError = computed(() => {
  if (!title.value.trim()) return null
  if (!slug.value) return 'Use at least one letter or number.'
  return null
})

const descriptionError = computed(() => {
  if (whenToUse.value.length > DESCRIPTION_MAX) {
    return `Too long by ${whenToUse.value.length - DESCRIPTION_MAX} characters.`
  }
  return null
})

const canContinue = computed(() => {
  if (step.value === 1) return Boolean(slug.value) && !nameError.value
  if (step.value === 2) return whenToUse.value.trim().length > 10 && !descriptionError.value
  return instructions.value.trim().length > 0
})

/** Reuse the agent instruction generator — it takes a name and description. */
async function draftWithClaude() {
  drafting.value = true
  try {
    const result = await $fetch<{ improvedInstructions: string }>('/api/agents/improve-instructions', {
      method: 'POST',
      body: {
        name: title.value.trim(),
        description: whenToUse.value.trim(),
        currentInstructions: instructions.value.trim(),
      },
    })
    if (result.improvedInstructions) {
      instructions.value = result.improvedInstructions
      toast.add({ title: 'Draft ready — edit anything you like', color: 'success' })
    }
  } catch (e: any) {
    toast.add({
      title: 'Could not draft it',
      description: errorMessage(e),
      color: 'error',
    })
  } finally {
    drafting.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const skill = await create({
      frontmatter: {
        name: slug.value,
        description: whenToUse.value.trim(),
      },
      body: instructions.value.trim(),
    })
    toast.add({ title: `"${title.value.trim()}" saved`, color: 'success' })
    emit('saved', skill)
  } catch (e: any) {
    toast.add({
      title: 'Could not save',
      description: errorMessage(e),
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

function next() {
  if (step.value < 3) step.value = (step.value + 1) as 1 | 2 | 3
  else save()
}

function back() {
  if (step.value === 1) emit('cancel')
  else step.value = (step.value - 1) as 1 | 2 | 3
}
</script>

<template>
  <div class="p-6 space-y-5 bg-overlay modal-panel">
    <!-- Progress -->
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-sparkles" class="size-4 ink-accent" />
        <h3 class="text-page-title">Teach Claude something</h3>
        <span class="ml-auto type-mono-meta">{{ step }} of 3</span>
      </div>
      <div class="flex gap-1">
        <div
          v-for="n in 3"
          :key="n"
          class="h-0.5 flex-1 rounded-full transition-colors"
          :style="{ background: n <= step ? 'var(--accent)' : 'var(--border-subtle)' }"
        />
      </div>
    </div>

    <!-- Step 1 -->
    <div v-if="step === 1" class="space-y-3">
      <div class="field-group">
        <label class="field-label">What would you call this?</label>
        <input
          v-model="title"
          class="field-input"
          :class="{ 'field-input--error': nameError }"
          placeholder="Weekly pipeline summary"
          autofocus
          @keydown.enter="canContinue && next()"
        />
        <span v-if="nameError" class="field-error">{{ nameError }}</span>
        <span v-else-if="slug" class="field-hint">Claude will know it as <code>{{ slug }}</code></span>
        <span v-else class="field-hint">Give it a short, plain name.</span>
      </div>
    </div>

    <!-- Step 2 -->
    <div v-else-if="step === 2" class="space-y-3">
      <div class="field-group">
        <label class="field-label">When should Claude use it?</label>
        <textarea
          v-model="whenToUse"
          rows="4"
          class="field-textarea"
          :class="{ 'field-input--error': descriptionError }"
          placeholder="When I ask for a summary of this week's sales pipeline, or mention the weekly pipeline report."
          autofocus
        />
        <span v-if="descriptionError" class="field-error">{{ descriptionError }}</span>
        <span v-else class="field-hint">
          This is how Claude decides when it applies — be specific about the words you'd actually use.
          {{ whenToUse.length }}/{{ DESCRIPTION_MAX }}
        </span>
      </div>
    </div>

    <!-- Step 3 -->
    <div v-else class="space-y-3">
      <div class="field-group">
        <div class="flex items-center justify-between">
          <label class="field-label">What should Claude do?</label>
          <button
            class="fs-mono font-medium px-2 py-1 rounded hover-bg flex items-center gap-1.5"
            style="color: var(--accent);"
            :disabled="drafting"
            @click="draftWithClaude"
          >
            <UIcon
              :name="drafting ? 'i-lucide-loader-2' : 'i-lucide-wand-2'"
              class="size-3"
              :class="{ 'animate-spin': drafting }"
            />
            {{ instructions.trim() ? 'Improve this' : 'Draft it for me' }}
          </button>
        </div>
        <textarea
          v-model="instructions"
          rows="10"
          class="field-textarea font-mono fs-sm"
          placeholder="Step by step, describe what Claude should do. Plain English is fine."
          autofocus
        />
        <span class="field-hint">
          Write it like you'd explain it to a new colleague.
        </span>
      </div>

      <!-- Where it gets saved -->
      <div v-if="canUseProjectScope" class="field-group">
        <label class="field-label">Who gets this?</label>
        <div class="flex gap-2">
          <button
            v-for="option in [
              { value: 'user' as const, label: 'Just me', hint: 'Available everywhere you work' },
              { value: 'project' as const, label: 'This project', hint: 'Shared with anyone in this folder' },
            ]"
            :key="option.value"
            class="flex-1 px-3 py-2 rounded-md text-left transition-all"
            :style="{
              background: createScope === option.value ? 'var(--accent-muted)' : 'var(--surface-raised)',
              border: '1px solid ' + (createScope === option.value ? 'var(--accent-glow)' : 'var(--border-subtle)'),
            }"
            @click="createScope = option.value"
          >
            <div
              class="fs-sm font-medium"
              :style="{ color: createScope === option.value ? 'var(--accent)' : 'var(--text-primary)' }"
            >
              {{ option.label }}
            </div>
            <div class="fs-micro text-meta">{{ option.hint }}</div>
          </button>
        </div>
      </div>
    </div>

    <!--
      The way out for somebody who knows the frontmatter.

      This flow used to be what simple mode showed and the raw form was what
      advanced mode showed, so the two fields only the form has — the context
      trigger, and the agent a skill is bound to — were unreachable to anyone
      who had not found the mode switch. With no mode, the guided flow is what
      opens and this is the sentence that gets past it.
    -->
    <button
      v-if="step === 1"
      class="fs-sm text-meta hover:text-label underline underline-offset-2 focus-ring rounded"
      @click="emit('raw')"
    >
      Fill in the fields myself
    </button>

    <!-- Actions -->
    <div class="flex items-center justify-between pt-1">
      <button class="fs-sm px-2 py-1 rounded hover-bg text-meta" @click="back">
        {{ step === 1 ? 'Cancel' : 'Back' }}
      </button>
      <UButton
        :label="step === 3 ? 'Save' : 'Continue'"
        :icon="step === 3 ? 'i-lucide-check' : 'i-lucide-arrow-right'"
        size="sm"
        :loading="saving"
        :disabled="!canContinue"
        @click="next"
      />
    </div>
  </div>
</template>
