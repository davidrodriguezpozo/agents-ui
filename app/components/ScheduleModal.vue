<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import {
  DAY_LABELS, PERMISSION_CHOICES, WEEKDAYS,
  type GithubEventKind, type Schedule, type SchedulePermission,
} from '~/composables/useSchedules'

/** Create or edit a daily ritual. Time and days, not cron. */
const props = defineProps<{
  schedule?: Schedule | null
  /** Prefill when scheduling straight from a command. */
  presetInput?: string
  presetTitle?: string
}>()

const emit = defineEmits<{ saved: [Schedule]; close: [] }>()

const { save } = useSchedules()
const { workingDir } = useWorkingDir()
const { projects, ensureLoaded: ensureProjectsLoaded, display } = useProjects()
const toast = useToast()

/**
 * Which repository this runs against, pinned now because at 08:00 there is
 * nobody to ask and nothing selected to read.
 *
 * A new ritual defaults to the project you are in — the overwhelmingly common
 * intent, and what it always did. An edit keeps whatever the ritual already
 * had, including a project you are not currently in: a briefing pinned to one
 * repository should not follow you around because you opened its settings from
 * somewhere else.
 *
 * The empty string is "no project", which is a real answer for a ritual that
 * works on your personal config rather than on any one repository. It is sent
 * as `null` so the server can tell it apart from having said nothing.
 */
const projectDir = ref<string>(
  props.schedule
    ? props.schedule.projectDir ?? ''
    : workingDir.value,
)

onMounted(ensureProjectsLoaded)

/**
 * A ritual can be pinned to a repository that is no longer on the list —
 * removed since, or seeded from before it existed. Dropping it from the
 * options would silently repoint the ritual the next time anyone saved it.
 */
const options = computed(() => {
  const known = projects.value.map(p => ({ path: p.path, name: p.name, missing: !p.exists }))
  if (projectDir.value && !known.some(o => o.path === projectDir.value)) {
    known.unshift({
      path: projectDir.value,
      name: projectDir.value.split('/').filter(Boolean).pop() ?? projectDir.value,
      missing: true,
    })
  }
  return known
})

const title = ref(props.schedule?.title ?? props.presetTitle ?? '')
const input = ref(props.schedule?.input ?? props.presetInput ?? '')

/**
 * The same command list the session composer offers, for the same reason:
 * writing a ritual is exactly the moment you are trying to remember what a
 * command is called, and this dialog was the one place you had to know it
 * from memory. Opens on a bare slash-word, or from the button beside the box
 * when you don't know one exists.
 *
 * Downwards rather than upwards — the field is at the top of the dialog, and a
 * list that opened above it would leave the screen.
 */
const { commands, fetchAll: fetchCommands } = useCommands()
const paletteOpen = ref(false)
const palette = ref<{ move: (d: number) => void; choose: () => void; hasMatches: boolean } | null>(null)

onMounted(() => { void fetchCommands() })

const commandQuery = computed(() => {
  const match = input.value.match(/^\/(\S*)$/)
  return match ? match[1] ?? '' : ''
})

watch(input, () => {
  // Typing past the command itself means you are writing an instruction now.
  if (input.value.startsWith('/') && !input.value.includes(' ')) paletteOpen.value = true
  else if (!input.value.startsWith('/')) paletteOpen.value = false
})

function insertCommand(invocation: string) {
  input.value = `${invocation} `
  paletteOpen.value = false
}

/** While the list is open it owns the keys that drive it. */
function onInputKey(event: KeyboardEvent) {
  if (!paletteOpen.value) return

  if (event.key === 'ArrowDown') { event.preventDefault(); palette.value?.move(1); return }
  if (event.key === 'ArrowUp') { event.preventDefault(); palette.value?.move(-1); return }
  if (event.key === 'Escape') {
    // Swallowed so it closes the list rather than the whole dialog, which
    // would take the half-written ritual with it.
    event.preventDefault()
    event.stopPropagation()
    paletteOpen.value = false
    return
  }
  if (event.key === 'Enter' && palette.value?.hasMatches) {
    event.preventDefault()
    palette.value.choose()
  }
}
/**
 * One instruction, or several run in order.
 *
 * Written as separate rituals, "triage then fix then verify" is three rows,
 * three failing streaks and three things to read in a morning where one thing
 * happened — and none of them knows what the one before it found. A chain is
 * one ritual with an ordered list, and each step is told what the last produced.
 */
const shape = ref<'single' | 'chain'>(props.schedule?.steps?.length ? 'chain' : 'single')

/**
 * Two empty steps to start, because one is not a chain and an empty list gives
 * no hint of what the box is for. The names are the sequence this was built
 * for, and are meant to be typed over.
 */
const steps = ref<{ title: string; input: string }[]>(
  props.schedule?.steps?.length
    ? props.schedule.steps.map(step => ({ ...step }))
    : [{ title: 'Triage', input: '' }, { title: 'Fix', input: '' }],
)

/** Matches MAX_CHAIN_STEPS on the server, which trims anything past it. */
const MAX_STEPS = 6

const filledSteps = computed(() => steps.value.filter(step => step.input.trim()))

function addStep() {
  if (steps.value.length >= MAX_STEPS) return
  steps.value.push({ title: '', input: '' })
}

function removeStep(index: number) {
  steps.value.splice(index, 1)
}

function moveStep(index: number, direction: -1 | 1) {
  const to = index + direction
  if (to < 0 || to >= steps.value.length) return

  const [moved] = steps.value.splice(index, 1)
  steps.value.splice(to, 0, moved!)
}

const hour = ref(props.schedule?.recurrence.hour ?? 8)
const minute = ref(props.schedule?.recurrence.minute ?? 0)
const days = ref<number[]>(props.schedule?.recurrence.days?.length ? [...props.schedule.recurrence.days] : [...WEEKDAYS])
const permission = ref<SchedulePermission>(props.schedule?.permission ?? 'edits')
const saving = ref(false)

/**
 * A clock is not the only reason to run something. The other one is that
 * something happened — a pull request appeared, CI went red — and it is what
 * the clock cannot express at all: a briefing happens once a morning, a review
 * happens whenever there is something to review.
 */
const EVENT_OPTIONS: { value: GithubEventKind; label: string }[] = [
  { value: 'pr_opened', label: 'A pull request is opened' },
  { value: 'check_failed', label: 'A workflow run fails' },
  { value: 'issue_labelled', label: 'An issue is labelled' },
  { value: 'review_requested', label: 'A review is requested' },
]

const firesOn = ref<'clock' | 'event'>(props.schedule?.trigger ? 'event' : 'clock')
const eventKind = ref<GithubEventKind>(props.schedule?.trigger?.kind ?? 'pr_opened')
const eventBranch = ref(props.schedule?.trigger?.branch ?? '')
const eventLabel = ref(props.schedule?.trigger?.label ?? '')
const eventReviewer = ref(props.schedule?.trigger?.reviewer ?? '')

/**
 * Each kind narrows by a different thing, so only one box is ever shown.
 *
 * Offering all three would suggest they combine, which they do not — a review
 * request has no branch and an issue has no reviewer.
 */
const narrowsBy = computed<'branch' | 'label' | 'reviewer'>(() => {
  if (eventKind.value === 'issue_labelled') return 'label'
  if (eventKind.value === 'review_requested') return 'reviewer'
  return 'branch'
})

const isEdit = computed(() => Boolean(props.schedule))

function toggleDay(day: number) {
  days.value = days.value.includes(day)
    ? days.value.filter(d => d !== day)
    : [...days.value, day].sort()
}

const preview = computed(() => {
  if (firesOn.value === 'event') {
    const what = EVENT_OPTIONS.find(o => o.value === eventKind.value)?.label ?? eventKind.value
    const where = eventBranch.value.trim() ? ` on ${eventBranch.value.trim()}` : ''
    return `${what}${where}`
  }

  const time = `${String(hour.value).padStart(2, '0')}:${String(minute.value).padStart(2, '0')}`
  if (!days.value.length || days.value.length === 7) return `Every day at ${time}`
  if (days.value.length === 5 && WEEKDAYS.every(d => days.value.includes(d))) return `Weekdays at ${time}`
  return `${days.value.map(d => DAY_LABELS[d]).join(', ')} at ${time}`
})

const canSave = computed(() => Boolean(
  title.value.trim()
  // A chain needs two steps with something in them; one step is a plain ritual
  // and the server normalizes it back to one, so saving it here would silently
  // not be a chain.
  && (shape.value === 'chain' ? filledSteps.value.length > 1 : input.value.trim())
  // Days only constrain a clock ritual; an event one has no days to pick.
  && (firesOn.value === 'event' || days.value.length),
))

async function onSave() {
  if (!canSave.value) return
  saving.value = true
  try {
    const chaining = shape.value === 'chain'

    // A chain's `input` is its first step, so the record still describes what
    // the ritual does if the steps are ever cleared — the same reason a
    // triggered ritual keeps its recurrence.
    const primary = chaining
      ? filledSteps.value[0]!.input.trim()
      : input.value.trim()

    const saved = await save({
      ...(props.schedule?.id ? { id: props.schedule.id } : {}),
      title: title.value.trim(),
      input: primary,
      // `null` turns a chain back into a single instruction, which absent
      // cannot say. Titles are trimmed here so the server's fallback naming
      // sees an empty box as empty.
      steps: chaining
        ? filledSteps.value.map(step => ({ title: step.title.trim(), input: step.input.trim() }))
        : null,
      invocation: !chaining && primary.startsWith('/') ? primary.split(' ')[0] : undefined,
      recurrence: { hour: hour.value, minute: minute.value, days: days.value },
      // `null` clears a trigger and puts the ritual back on the clock, which is
      // the only way to say "no longer an event one" — absent would keep it.
      // Only the narrowing this kind actually uses is sent. Carrying a stale
      // branch onto a review trigger would leave a filter on the record that
      // nothing reads and the row does not mention.
      trigger: firesOn.value === 'event'
        ? {
            kind: eventKind.value,
            branch: narrowsBy.value === 'branch' ? eventBranch.value.trim() || undefined : undefined,
            label: narrowsBy.value === 'label' ? eventLabel.value.trim() || undefined : undefined,
            reviewer: narrowsBy.value === 'reviewer' ? eventReviewer.value.trim() || undefined : undefined,
          }
        : null,
      permission: permission.value,
      enabled: props.schedule?.enabled ?? true,
      // Always sent, so the answer is this form's rather than whatever project
      // happened to be selected when the request went out.
      projectDir: projectDir.value || null,
    })
    toast.add({ title: isEdit.value ? 'Ritual updated' : `"${saved.title}" scheduled`, color: 'success' })
    emit('saved', saved)
  } catch (e: any) {
    toast.add({ title: 'Could not save', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="p-6 space-y-5 bg-overlay">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-alarm-clock" class="size-4" style="color: var(--accent);" />
      <h3 class="text-page-title">{{ isEdit ? 'Edit ritual' : 'Make this a daily ritual' }}</h3>
    </div>

    <div class="field-group">
      <label class="field-label">What to run</label>

      <!-- One question with two answers, like When below it, rather than two
           sections that both look optional. -->
      <div class="flex gap-1">
        <button
          v-for="option in [
            { value: 'single' as const, label: 'One instruction' },
            { value: 'chain' as const, label: 'A chain of steps' },
          ]"
          :key="option.value"
          class="flex-1 px-3 py-1.5 rounded-md type-detail transition-all"
          :style="{
            background: shape === option.value ? 'var(--accent-muted)' : 'var(--input-bg)',
            color: shape === option.value ? 'var(--accent)' : 'var(--text-disabled)',
          }"
          @click="() => { shape = option.value }"
        >
          {{ option.label }}
        </button>
      </div>

      <div v-if="shape === 'single'" class="relative">
        <div class="flex gap-2">
          <input
            v-model="input"
            class="field-input font-mono text-[12px] flex-1"
            placeholder="/hd:goodmorning"
            @keydown="onInputKey"
          />
          <UButton
            icon="i-lucide-slash"
            size="sm"
            variant="ghost"
            color="neutral"
            :title="`${commands.length} commands available`"
            aria-label="Show commands"
            @click="() => { paletteOpen = !paletteOpen }"
          />
        </div>

        <!-- Below the field: this one sits near the top of the dialog -->
        <div v-if="paletteOpen" class="absolute top-full left-0 right-0 mt-2 z-10">
          <CommandPalette
            ref="palette"
            :commands="commands"
            :query="commandQuery"
            @select="insertCommand"
            @close="() => { paletteOpen = false }"
          />
        </div>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="(step, index) in steps"
          :key="index"
          class="rounded-md p-2.5 space-y-2"
          style="background: var(--input-bg);"
        >
          <div class="flex items-center gap-2">
            <span class="type-detail font-mono shrink-0" style="color: var(--text-disabled);">
              {{ index + 1 }}
            </span>
            <input
              v-model="step.title"
              class="field-input flex-1 text-[12px]"
              :placeholder="`Step ${index + 1}`"
            />
            <UButton
              icon="i-lucide-chevron-up"
              size="xs"
              variant="ghost"
              color="neutral"
              :disabled="index === 0"
              aria-label="Move up"
              @click="moveStep(index, -1)"
            />
            <UButton
              icon="i-lucide-chevron-down"
              size="xs"
              variant="ghost"
              color="neutral"
              :disabled="index === steps.length - 1"
              aria-label="Move down"
              @click="moveStep(index, 1)"
            />
            <UButton
              icon="i-lucide-x"
              size="xs"
              variant="ghost"
              color="neutral"
              :disabled="steps.length <= 2"
              aria-label="Remove step"
              @click="removeStep(index)"
            />
          </div>
          <textarea
            v-model="step.input"
            class="field-input font-mono text-[12px] w-full"
            rows="2"
            :placeholder="index === 0 ? 'Look at what came in overnight.' : 'Fix what the last step found.'"
          />
        </div>

        <UButton
          label="Add a step"
          icon="i-lucide-plus"
          size="xs"
          variant="ghost"
          color="neutral"
          :disabled="steps.length >= MAX_STEPS"
          @click="addStep"
        />
      </div>

      <span v-if="shape === 'single'" class="field-hint">
        A command, or anything you'd normally ask Claude. Type / to see what you have.
      </span>
      <span v-else class="field-hint">
        Run in order, each one told what the last produced. It stops at the first step
        that doesn't work, and the whole chain counts as one run in the ritual's history.
      </span>
    </div>

    <div class="field-group">
      <label class="field-label">Call it</label>
      <input v-model="title" class="field-input" placeholder="Morning briefing" />
    </div>

    <div class="field-group">
      <label class="field-label">When</label>

      <!-- Two answers to one question, so they share the label rather than
           becoming two sections that both look optional. -->
      <div class="flex gap-1">
        <button
          v-for="option in [
            { value: 'clock' as const, label: 'At a time' },
            { value: 'event' as const, label: 'When something happens' },
          ]"
          :key="option.value"
          class="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all"
          :style="{
            background: firesOn === option.value ? 'var(--accent-muted)' : 'var(--surface-raised)',
            color: firesOn === option.value ? 'var(--accent)' : 'var(--text-disabled)',
            border: '1px solid ' + (firesOn === option.value ? 'var(--accent-glow)' : 'var(--border-subtle)'),
          }"
          @click="firesOn = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <div v-if="firesOn === 'event'" class="space-y-2 pt-2">
        <select v-model="eventKind" class="field-select w-full">
          <option v-for="option in EVENT_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <!--
          A name typed slightly wrong does not fail here, it just never matches
          — so a trigger with a typo in it is indistinguishable from one with
          nothing to do. Still free text: a branch or label that does not exist
          yet is a perfectly reasonable thing to wait for.
        -->
        <RefPicker
          v-if="narrowsBy === 'branch'"
          v-model="eventBranch"
          :repo-dir="projectDir || null"
          placeholder="Any branch"
        />
        <input
          v-else-if="narrowsBy === 'label'"
          v-model="eventLabel"
          class="field-input font-mono"
          placeholder="Any label"
          spellcheck="false"
        />
        <input
          v-else
          v-model="eventReviewer"
          class="field-input font-mono"
          placeholder="Anyone — or a username or team"
          spellcheck="false"
        />
        <p class="field-hint">
          Checked every couple of minutes with <span class="font-mono">gh</span>, using the login
          you already have — nothing is opened to the internet. It starts from now: things that
          already happened before you saved this are not worked through.
        </p>
      </div>

      <div v-else class="flex items-center gap-2 pt-2">
        <select v-model.number="hour" class="field-select w-20">
          <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ String(h - 1).padStart(2, '0') }}</option>
        </select>
        <span class="text-[13px] text-meta">:</span>
        <select v-model.number="minute" class="field-select w-20">
          <option v-for="m in [0, 15, 30, 45]" :key="m" :value="m">{{ String(m).padStart(2, '0') }}</option>
        </select>
      </div>
      <div v-if="firesOn === 'clock'" class="flex gap-1 pt-2">
        <button
          v-for="(label, day) in DAY_LABELS"
          :key="day"
          class="flex-1 px-1 py-1.5 rounded-md text-[11px] font-medium transition-all"
          :style="{
            background: days.includes(day) ? 'var(--accent-muted)' : 'var(--surface-raised)',
            color: days.includes(day) ? 'var(--accent)' : 'var(--text-disabled)',
            border: '1px solid ' + (days.includes(day) ? 'var(--accent-glow)' : 'var(--border-subtle)'),
          }"
          @click="toggleDay(day)"
        >
          {{ label }}
        </button>
      </div>
      <span class="field-hint">{{ preview }}</span>
    </div>

    <!-- Where it will run, pinned now because the scheduler can't ask later -->
    <div class="field-group">
      <label class="field-label">Always runs in</label>
      <select v-model="projectDir" class="field-select w-full">
        <option v-for="option in options" :key="option.path" :value="option.path">
          {{ option.name }}{{ option.missing ? ' — not on disk' : '' }}
        </option>
        <option value="">No project — your Claude settings folder</option>
      </select>
      <span class="field-hint font-mono">
        {{ projectDir ? display(projectDir) : 'Runs against ~/.claude, with no repository of its own.' }}
      </span>
    </div>

    <!-- Decided here, because 8am with nobody watching is the wrong time to ask -->
    <div class="field-group">
      <label class="field-label">What is it allowed to do?</label>
      <div class="space-y-1.5">
        <button
          v-for="choice in PERMISSION_CHOICES"
          :key="choice.value"
          class="w-full flex items-start gap-2.5 px-3 py-2 rounded-md text-left transition-all"
          :style="{
            background: permission === choice.value ? 'var(--accent-muted)' : 'var(--surface-raised)',
            border: '1px solid ' + (permission === choice.value ? 'var(--accent-glow)' : 'var(--border-subtle)'),
          }"
          @click="permission = choice.value"
        >
          <UIcon
            :name="permission === choice.value ? 'i-lucide-circle-check' : 'i-lucide-circle'"
            class="size-3.5 shrink-0 mt-0.5"
            :style="{ color: permission === choice.value ? 'var(--accent)' : 'var(--text-disabled)' }"
          />
          <div class="min-w-0">
            <div
              class="text-[12px] font-medium"
              :style="{ color: permission === choice.value ? 'var(--accent)' : 'var(--text-primary)' }"
            >
              {{ choice.label }}
            </div>
            <div class="text-[10px] leading-relaxed text-meta">{{ choice.hint }}</div>
          </div>
        </button>
      </div>
      <span class="field-hint">
        Nobody is around when this runs, so it can't stop to ask. Anything beyond this
        is refused and the run is flagged for you.
      </span>
    </div>

    <p class="text-[11px] leading-relaxed text-meta">
      Rituals only run while this app is open.
    </p>

    <div class="flex justify-end gap-2">
      <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="emit('close')" />
      <UButton
        :label="isEdit ? 'Save' : 'Schedule it'"
        icon="i-lucide-check"
        size="sm"
        :loading="saving"
        :disabled="!canSave"
        @click="onSave"
      />
    </div>
  </div>
</template>
