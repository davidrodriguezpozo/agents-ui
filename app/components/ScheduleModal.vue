<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { DAY_LABELS, PERMISSION_CHOICES, WEEKDAYS, type Schedule, type SchedulePermission } from '~/composables/useSchedules'

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
const hour = ref(props.schedule?.recurrence.hour ?? 8)
const minute = ref(props.schedule?.recurrence.minute ?? 0)
const days = ref<number[]>(props.schedule?.recurrence.days?.length ? [...props.schedule.recurrence.days] : [...WEEKDAYS])
const permission = ref<SchedulePermission>(props.schedule?.permission ?? 'edits')
const saving = ref(false)

const isEdit = computed(() => Boolean(props.schedule))

function toggleDay(day: number) {
  days.value = days.value.includes(day)
    ? days.value.filter(d => d !== day)
    : [...days.value, day].sort()
}

const preview = computed(() => {
  const time = `${String(hour.value).padStart(2, '0')}:${String(minute.value).padStart(2, '0')}`
  if (!days.value.length || days.value.length === 7) return `Every day at ${time}`
  if (days.value.length === 5 && WEEKDAYS.every(d => days.value.includes(d))) return `Weekdays at ${time}`
  return `${days.value.map(d => DAY_LABELS[d]).join(', ')} at ${time}`
})

const canSave = computed(() => Boolean(title.value.trim() && input.value.trim() && days.value.length))

async function onSave() {
  if (!canSave.value) return
  saving.value = true
  try {
    const saved = await save({
      ...(props.schedule?.id ? { id: props.schedule.id } : {}),
      title: title.value.trim(),
      input: input.value.trim(),
      invocation: input.value.trim().startsWith('/') ? input.value.trim().split(' ')[0] : undefined,
      recurrence: { hour: hour.value, minute: minute.value, days: days.value },
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
      <input v-model="input" class="field-input font-mono text-[12px]" placeholder="/hd:goodmorning" />
      <span class="field-hint">A command, or anything you'd normally ask Claude.</span>
    </div>

    <div class="field-group">
      <label class="field-label">Call it</label>
      <input v-model="title" class="field-input" placeholder="Morning briefing" />
    </div>

    <div class="field-group">
      <label class="field-label">When</label>
      <div class="flex items-center gap-2">
        <select v-model.number="hour" class="field-select w-20">
          <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ String(h - 1).padStart(2, '0') }}</option>
        </select>
        <span class="text-[13px] text-meta">:</span>
        <select v-model.number="minute" class="field-select w-20">
          <option v-for="m in [0, 15, 30, 45]" :key="m" :value="m">{{ String(m).padStart(2, '0') }}</option>
        </select>
      </div>
      <div class="flex gap-1 pt-2">
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
