<script setup lang="ts">
import type { PermissionAnswer, PermissionRequest, QuestionPrompt } from '~/types'

/**
 * A question the agent stopped to ask, with its options.
 *
 * It arrives through the permission queue because that is how the CLI asks —
 * `AskUserQuestion` is answered by allowing the tool call with the answers
 * written into its input — but it is not a permission and must not look like
 * one. "Claude wants to use AskUserQuestion / Allow once" is the prompt this
 * replaces, and answering it that way told the agent nobody had answered.
 */
const props = defineProps<{
  request: PermissionRequest
  busy?: boolean
}>()

const emit = defineEmits<{ answer: [decision: PermissionAnswer] }>()

const questions = computed<QuestionPrompt[]>(() => props.request.questions ?? [])

/** Chosen labels per question. One entry for a single-choice question. */
const picked = ref<Record<string, string[]>>({})
/** What somebody typed instead of choosing. The tool takes any string. */
const typed = ref<Record<string, string>>({})

/**
 * Choosing and typing are the same slot, so they clear each other. Both at once
 * would send two answers to one question with no way to say which is meant.
 */
function choose(question: QuestionPrompt, label: string) {
  if (props.busy) return
  typed.value = { ...typed.value, [question.question]: '' }

  const current = picked.value[question.question] ?? []
  const next = question.multiSelect
    ? current.includes(label) ? current.filter(l => l !== label) : [...current, label]
    : current.includes(label) ? [] : [label]

  picked.value = { ...picked.value, [question.question]: next }
}

function onType(question: QuestionPrompt, value: string) {
  typed.value = { ...typed.value, [question.question]: value }
  if (value.trim()) picked.value = { ...picked.value, [question.question]: [] }
}

function isChosen(question: QuestionPrompt, label: string): boolean {
  return (picked.value[question.question] ?? []).includes(label)
}

/** The preview behind whatever is chosen, when the agent sent one. */
function previewFor(question: QuestionPrompt): string | null {
  for (const label of picked.value[question.question] ?? []) {
    const preview = question.options.find(option => option.label === label)?.preview
    if (preview) return preview
  }
  return null
}

const answers = computed<Record<string, string[]>>(() => {
  const out: Record<string, string[]> = {}
  for (const question of questions.value) {
    const text = (typed.value[question.question] ?? '').trim()
    const chosen = text ? [text] : (picked.value[question.question] ?? [])
    if (chosen.length) out[question.question] = chosen
  }
  return out
})

const answered = computed(() => Object.keys(answers.value).length)

/** Which are still blank, so the button can say what is left rather than just refusing. */
const remaining = computed(() => questions.value.length - answered.value)

function send() {
  if (!answered.value || props.busy) return
  emit('answer', { behavior: 'allow', answers: answers.value })
}

/**
 * Skipping is a real answer, and it is the CLI's own: allowing the call with
 * nothing in it makes the tool report that the questions went unanswered, which
 * leaves the agent free to decide for itself and say what it assumed. A denial
 * would instead hand it an error, which is not what "just get on with it" means.
 */
function skip() {
  if (props.busy) return
  emit('answer', { behavior: 'allow' })
}
</script>

<template>
  <div
    class="rounded-lg overflow-hidden"
    style="background: var(--surface-raised); border: 1px solid var(--accent-glow);"
  >
    <div class="px-3.5 pt-3 pb-1 flex items-start gap-2.5">
      <UIcon
        name="i-lucide-message-circle-question"
        class="size-4 shrink-0 mt-px"
        style="color: var(--accent);"
      />
      <p class="fs-sm font-medium ink">
        {{ questions.length > 1 ? `Claude is asking ${questions.length} questions` : 'Claude is asking' }}
      </p>
    </div>

    <div class="px-3.5 py-2 space-y-3.5">
      <div v-for="question in questions" :key="question.question" class="space-y-1.5">
        <div class="flex items-baseline gap-2">
          <span
            v-if="question.header"
            class="fs-micro font-medium px-1.5 py-0.5 rounded shrink-0"
            style="background: var(--badge-subtle-bg); color: var(--text-secondary);"
          >{{ question.header }}</span>
          <p class="fs-sm ink min-w-0">
            {{ question.question }}
          </p>
        </div>

        <p v-if="question.multiSelect" class="fs-micro ink-3">
          Pick as many as apply.
        </p>

        <div class="space-y-1">
          <button
            v-for="option in question.options"
            :key="option.label"
            type="button"
            class="w-full text-left rounded-md px-2.5 py-1.5 flex items-start gap-2 transition-colors"
            :style="isChosen(question, option.label)
              ? 'background: var(--accent-muted); border: 1px solid var(--accent);'
              : 'background: var(--surface-base); border: 1px solid var(--border-default);'"
            :disabled="busy"
            @click="choose(question, option.label)"
          >
            <UIcon
              :name="question.multiSelect
                ? (isChosen(question, option.label) ? 'i-lucide-square-check' : 'i-lucide-square')
                : (isChosen(question, option.label) ? 'i-lucide-circle-dot' : 'i-lucide-circle')"
              class="size-3.5 shrink-0 mt-0.5"
              :style="{ color: isChosen(question, option.label) ? 'var(--accent)' : 'var(--text-tertiary)' }"
            />
            <span class="min-w-0">
              <span class="fs-sm ink block">{{ option.label }}</span>
              <span v-if="option.description" class="fs-micro ink-3 block">{{ option.description }}</span>
            </span>
          </button>
        </div>

        <!-- The agent sent a mockup with the option, so show it once chosen -->
        <pre
          v-if="previewFor(question)"
          class="fs-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto rounded-md px-2.5 py-2 m-0"
          style="font-family: var(--font-mono); background: var(--badge-subtle-bg); color: var(--text-secondary);"
        >{{ previewFor(question) }}</pre>

        <!-- None of the above. The tool takes any string as an answer -->
        <UInput
          :model-value="typed[question.question] ?? ''"
          size="xs"
          placeholder="Or answer in your own words"
          :disabled="busy"
          class="w-full"
          @update:model-value="onType(question, String($event))"
        />
      </div>
    </div>

    <div class="px-3.5 pb-3 pt-1 flex flex-wrap items-center gap-1.5">
      <UButton
        :label="answered && remaining ? `Send ${answered} of ${questions.length}` : 'Send answer'"
        size="xs"
        color="primary"
        :loading="busy"
        :disabled="busy || !answered"
        @click="send"
      />
      <UButton
        label="Skip"
        size="xs"
        variant="ghost"
        color="neutral"
        :disabled="busy"
        title="Claude is told nobody answered, and decides for itself"
        @click="skip"
      />
    </div>
  </div>
</template>
