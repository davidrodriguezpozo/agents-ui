<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { formatCost, formatDuration, relativeTime } from '~/utils/time'
import type { RitualOutcome, Schedule, SuggestedRitual } from '~/composables/useSchedules'

const {
  schedules, suggested, loading, loadError, historyFor,
  fetchAll, remove, setEnabled, adopt, revokeRule,
} = useSchedules()
const { describeRule } = usePermissionRuleLabels()
const { nameFor, ensureLoaded: ensureProjectsLoaded } = useProjects()
const { workingDir } = useWorkingDir()
const toast = useToast()

const editing = ref<Schedule | null>(null)
const showModal = ref(false)
const adopting = ref<string | null>(null)
const expanded = ref<string | null>(null)

/** `?new=1` so the command palette can start a ritual from a keystroke. */
const route = useRoute()
const router = useRouter()
onMounted(() => {
  if (!route.query.new) return
  showModal.value = true
  router.replace({ query: { ...route.query, new: undefined } })
})

/**
 * Sandboxing arrived switched on, and it reaches rituals that were running
 * happily before it existed. This is the only place those rituals are listed,
 * which makes it the place to say so — while everything still works, rather
 * than at 08:00 on the morning one of them stops.
 */
const {
  state: sandbox,
  saving: acknowledging,
  load: loadSandbox,
  save: saveSandbox,
} = useProjectSandbox()

async function acknowledgeSandbox() {
  await saveSandbox({ acknowledge: true })
}

onMounted(() => Promise.all([fetchAll(), ensureProjectsLoaded(), loadSandbox()]))

function createNew() {
  editing.value = null
  showModal.value = true
}

function edit(schedule: Schedule) {
  editing.value = schedule
  showModal.value = true
}

async function onToggle(schedule: Schedule, enabled: boolean) {
  try {
    await setEnabled(schedule, enabled)
  } catch {
    toast.add({ title: 'Could not update', color: 'error' })
  }
}

async function onRemove(schedule: Schedule) {
  try {
    await remove(schedule.id)
    toast.add({ title: `"${schedule.title}" removed`, color: 'success' })
  } catch {
    toast.add({ title: 'Could not remove', color: 'error' })
  }
}

async function onAdopt(ritual: SuggestedRitual) {
  adopting.value = ritual.command
  try {
    await adopt(ritual)
    toast.add({ title: `"${ritual.title}" added`, color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not add', description: errorMessage(e), color: 'error' })
  } finally {
    adopting.value = null
  }
}

async function onRevoke(schedule: Schedule, rule: string) {
  try {
    await revokeRule(schedule.id, rule)
    toast.add({ title: 'Permission removed', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not remove it', description: errorMessage(e), color: 'error' })
  }
}

/**
 * Why a granted rule can do nothing, or empty when it can.
 *
 * The server decides this — the page only draws it. A second implementation
 * here would be the `mergeTrain` lesson all over again: two readings of the
 * same judgement is how one screen starts disagreeing with another.
 */
function deadReason(schedule: Schedule, rule: string): string {
  return schedule.deadRules?.find(dead => dead.rule === rule)?.reason ?? ''
}

/** The distinct reasons, since several rules usually share one cause. */
function deadReasons(schedule: Schedule): string[] {
  return [...new Set((schedule.deadRules ?? []).map(dead => dead.reason))]
}

const unadopted = computed(() => suggested.value.filter(s => !s.alreadyAdded))

/** A ritual runs unwatched, so each outcome has to say what it cost you. */
const OUTCOMES: Record<RitualOutcome, { label: string; color: string }> = {
  ok: { label: 'worked', color: 'var(--success)' },
  blocked: { label: 'blocked', color: 'var(--accent)' },
  failed: { label: 'failed', color: 'var(--error)' },
  stopped: { label: 'stopped', color: 'var(--text-disabled)' },
  running: { label: 'running', color: 'var(--accent)' },
}

/** Most recent last, so the strip reads left to right like a calendar. */
function strip(id: string) {
  return [...historyFor(id).runs].slice(0, 7).reverse()
}

function toggleHistory(id: string) {
  expanded.value = expanded.value === id ? null : id
}

/** Why a run came to nothing, preferring the part that is actionable. */
function runDetail(run: { deniedTools?: string[]; error?: string; preview: string }) {
  if (run.deniedTools?.length) return `needed ${run.deniedTools.join(', ')}`
  return run.error || run.preview
}

function brokenSince(id: string) {
  const { lastOkAt } = historyFor(id)
  return lastOkAt ? `last worked ${relativeTime(lastOkAt)}` : 'it has never finished cleanly'
}

function nextLabel(schedule: Schedule) {
  if (!schedule.enabled) return 'paused'
  /**
   * A triggered ritual has a `nextRunAt` — every ritual does, and it is kept so
   * that removing the trigger returns it to a time rather than to nothing. It
   * means nothing while the trigger is set, though, and "next Sat 09:00" beside
   * "when a workflow run fails" is the row contradicting itself.
   */
  if (schedule.trigger) return 'waiting'
  // Said on the row as well as in the report, because somebody who comes
  // straight here is asking exactly this question: why was there nothing?
  if (schedule.missedAt) return `missed ${relativeTime(schedule.missedAt)}`
  if (!schedule.nextRunAt) return ''
  const date = new Date(schedule.nextRunAt)
  const isToday = date.toDateString() === new Date().toDateString()
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  return isToday ? `next today ${time}` : `next ${date.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
}
</script>

<template>
  <div>
    <PageHeader title="Daily rituals" measure>
      <template #trailing>
        <span v-if="schedules.length" class="font-mono fs-sm text-meta">{{ schedules.length }}</span>
      </template>
      <template #right>
        <UButton label="New ritual" icon="i-lucide-plus" size="sm" @click="createNew" />
      </template>
    </PageHeader>

    <div class="page-container page-container--measure py-4 space-y-6">
      <p class="type-body leading-relaxed">
        Things Claude runs for you on a schedule, so the result is waiting when you get in.
        They run while this is running — install it as a service and that means always.
      </p>

      <!--
        Said before anything breaks, not after. These rituals have run before —
        that is what qualifies a project for this — so anything of theirs that
        reached the network used to work and now may not.
      -->
      <div
        v-if="sandbox?.warn"
        class="rounded-md px-4 py-3 flex items-start gap-3"
        style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
      >
        <UIcon name="i-lucide-shield" class="size-4 shrink-0 mt-0.5 ink-accent" />
        <div class="flex-1 min-w-0 space-y-1.5">
          <div class="fs-sm font-medium text-body">Runs here are now sandboxed</div>
          <p class="fs-mono leading-relaxed text-label">
            Your rituals reach only the hosts this project allows, and it currently allows
            none. That is deliberate — it is what makes leaving them running reasonable —
            but a ritual that has been quietly fetching something will stop being able to.
            Nothing has broken yet; this is the warning rather than the failure.
          </p>
          <p class="fs-mono leading-relaxed text-label">
            If one does stop, it will say which host it wanted and offer to allow it. You
            can also list them now, or turn the sandbox off for this project, in
            <NuxtLink to="/settings" class="underline ink-accent">Settings</NuxtLink>.
          </p>
        </div>
        <UButton
          label="Got it"
          size="xs"
          variant="soft"
          color="neutral"
          class="shrink-0"
          :loading="acknowledging"
          @click="acknowledgeSandbox"
        />
      </div>

      <!-- Never render "no rituals" when the truth is "could not read them" -->
      <div
        v-if="loadError"
        class="rounded-md px-4 py-3 flex items-start gap-3"
        style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
      >
        <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0 mt-0.5 ink-accent" />
        <div class="space-y-1.5">
          <div class="type-strong">Your rituals could not be loaded</div>
          <div class="type-detail ink-2">{{ loadError }}</div>
          <p class="type-meta">
            They have not been deleted. Nothing will be overwritten until this is resolved —
            restore a backup from Settings to get them back.
          </p>
          <UButton label="Open Settings" icon="i-lucide-settings" size="xs" variant="soft" to="/settings" />
        </div>
      </div>

      <div v-else-if="loading && !schedules.length" class="space-y-1">
        <SkeletonRow v-for="i in 3" :key="i" />
      </div>

      <!-- Yours -->
      <div v-if="schedules.length" class="space-y-2">
        <div
          v-for="schedule in schedules"
          :key="schedule.id"
          class="rounded-lg"
          style="border: 1px solid var(--border-subtle);"
          :style="{ opacity: schedule.enabled ? 1 : 0.6 }"
        >
          <div class="flex items-center gap-3 px-4 py-3">
            <UIcon name="i-lucide-alarm-clock" class="size-4 shrink-0 ink-accent" />

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="type-strong truncate text-body">{{ schedule.title }}</span>
                <span
                  v-if="schedule.origin === 'team'"
                  class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0"
                  style="background: var(--plugin-tint); color: var(--plugin);"
                >
                  {{ schedule.pluginName || 'team' }}
                </span>
              </div>
              <div class="flex items-center gap-2 mt-0.5 type-mono-meta">
                <span v-if="schedule.invocation" style="color: var(--accent);">{{ schedule.invocation }}</span>
                <!--
                  A chain and a single instruction are the same row otherwise,
                  and they are not the same thing: one firing of this is several
                  agent invocations, which is the row's most expensive fact.
                -->
                <span
                  v-if="schedule.steps?.length"
                  class="flex items-center gap-1"
                  style="color: var(--accent);"
                  :title="schedule.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n')"
                >
                  <UIcon name="i-lucide-list-ordered" class="size-3 shrink-0" />
                  {{ schedule.steps.length }} steps
                </span>
                <span>{{ schedule.description }}</span>
                <span>·</span>
                <span>{{ nextLabel(schedule) }}</span>
                <!--
                  Which repository this runs against. Said only when it is not
                  the one you are in: with several projects, "a briefing at
                  08:00" stops being a complete description of a ritual.
                -->
                <template v-if="schedule.projectDir && schedule.projectDir !== workingDir">
                  <span>·</span>
                  <span class="flex items-center gap-1 truncate" :title="schedule.projectDir">
                    <UIcon name="i-lucide-folder-git-2" class="size-2.5 shrink-0" />
                    {{ nameFor(schedule.projectDir) }}
                  </span>
                </template>
              </div>

              <!--
                Turned off by the scheduler rather than by you. Takes the place
                of the warning below: once it has stopped firing, how many runs
                came to nothing is history, and what matters is that it is off
                and why.
              -->
              <div
                v-if="schedule.pausedReason"
                class="flex items-start gap-1.5 mt-1 type-detail"
                style="color: var(--warning);"
              >
                <UIcon name="i-lucide-pause-circle" class="size-3 shrink-0 mt-0.5" />
                <span>
                  {{ schedule.pausedReason }}
                  <button class="underline hover:opacity-80" @click="onToggle(schedule, true)">
                    Turn it back on
                  </button>
                </span>
              </div>

              <!-- A ritual nobody watches fails quietly, so say it on the row -->
              <div
                v-else-if="historyFor(schedule.id).failingStreak >= 2"
                class="flex items-center gap-1.5 mt-1 type-detail"
                style="color: var(--error);"
              >
                <UIcon name="i-lucide-triangle-alert" class="size-3 shrink-0" />
                The last {{ historyFor(schedule.id).failingStreak }} runs came to nothing —
                {{ brokenSince(schedule.id) }}
              </div>

              <!--
                Something this was watching for went by unseen. Muted rather
                than alarming: nothing failed and nothing is blocked. It clears
                itself the moment a poll can see its own cursor again.
              -->
              <div
                v-if="schedule.eventGapAt"
                class="flex items-start gap-1.5 mt-1 type-detail"
                style="color: var(--text-secondary);"
              >
                <UIcon name="i-lucide-eye-off" class="size-3 shrink-0 mt-0.5" />
                <span>
                  More happened than one look back could cover, so some of it was never
                  picked up.
                </span>
              </div>

              <!-- What this ritual has been allowed to do without asking -->
              <div v-if="schedule.allowRules?.length" class="flex items-center gap-1.5 flex-wrap mt-1.5">
                <!--
                  A rule that cannot do anything must not wear the same green
                  shield as one that can. Eight granted rules on the briefing
                  here were four real ones and four for tools no unattended run
                  could reach, and nothing on the page distinguished them —
                  which is how the same four got granted twice.
                -->
                <span
                  v-for="rule in schedule.allowRules"
                  :key="rule"
                  class="inline-flex items-center gap-1 fs-micro px-1.5 py-px rounded-md group/rule"
                  :style="deadReason(schedule, rule)
                    ? 'background: var(--warning-wash); color: var(--warning);'
                    : 'background: var(--badge-subtle-bg); color: var(--text-secondary);'"
                  :title="deadReason(schedule, rule) || rule"
                >
                  <UIcon
                    :name="deadReason(schedule, rule) ? 'i-lucide-unplug' : 'i-lucide-shield-check'"
                    class="size-2.5 shrink-0"
                    :class="deadReason(schedule, rule) ? 'ink-warn' : 'ink-ok'"
                  />
                  {{ describeRule(rule) }}
                  <button
                    class="opacity-0 group-hover/rule:opacity-100 transition-opacity"
                    style="color: var(--text-disabled);"
                    title="Remove this permission"
                    @click.stop="onRevoke(schedule, rule)"
                  >
                    <UIcon name="i-lucide-x" class="size-2.5" />
                  </button>
                </span>
              </div>

              <!--
                Said once per reason rather than once per rule: five Slack tools
                behind one missing server is one thing to fix, and repeating it
                five times buries what to do about it.
              -->
              <div
                v-for="reason in deadReasons(schedule)"
                :key="reason"
                class="flex items-start gap-1.5 mt-1.5 type-meta"
              >
                <UIcon name="i-lucide-unplug" class="size-3 shrink-0 mt-0.5 ink-warn" />
                <span>{{ reason }}</span>
              </div>
            </div>

            <!-- Every run it has had, oldest to newest -->
            <button
              v-if="historyFor(schedule.id).runs.length"
              class="flex items-center gap-1.5 px-2 py-1 rounded hover-bg shrink-0 focus-ring text-meta"
              :aria-expanded="expanded === schedule.id"
              :title="`${historyFor(schedule.id).runs.length} recent runs`"
              @click="toggleHistory(schedule.id)"
            >
              <span class="flex items-center gap-1">
                <span
                  v-for="run in strip(schedule.id)"
                  :key="run.id"
                  class="size-1.5 rounded-full"
                  :style="{ background: OUTCOMES[run.outcome].color }"
                />
              </span>
              <UIcon
                :name="expanded === schedule.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                class="size-3"
              />
            </button>

            <label class="field-toggle shrink-0" :title="schedule.enabled ? 'Pause' : 'Resume'">
              <input
                type="checkbox"
                :checked="schedule.enabled"
                @change="onToggle(schedule, ($event.target as HTMLInputElement).checked)"
              />
              <span class="field-toggle__track"><span class="field-toggle__thumb" /></span>
            </label>

            <button class="p-1 rounded hover-bg shrink-0 text-meta" title="Edit" @click="edit(schedule)">
              <UIcon name="i-lucide-pencil" class="size-3.5" />
            </button>
            <button class="p-1 rounded hover-bg shrink-0 ink-error" title="Remove" @click="onRemove(schedule)">
              <UIcon name="i-lucide-trash-2" class="size-3.5" />
            </button>
          </div>

          <!-- What it has actually been doing, morning by morning -->
          <div
            v-if="expanded === schedule.id"
            class="px-3 pb-2 pt-2 mx-1 space-y-px"
            style="border-top: 1px solid var(--border-subtle);"
          >
            <NuxtLink
              v-for="run in historyFor(schedule.id).runs"
              :key="run.id"
              :to="`/runs/${run.id}`"
              class="flex items-center gap-2.5 px-2 py-1.5 rounded group focus-ring hover-row"
            >
              <span class="size-1.5 rounded-full shrink-0" :style="{ background: OUTCOMES[run.outcome].color }" />
              <span class="type-detail shrink-0 w-14" :style="{ color: OUTCOMES[run.outcome].color }">
                {{ OUTCOMES[run.outcome].label }}
              </span>
              <span class="type-mono-meta truncate flex-1">{{ runDetail(run) }}</span>
              <span v-if="formatCost(run.costUsd)" class="type-mono-meta shrink-0">{{ formatCost(run.costUsd) }}</span>
              <span v-if="formatDuration(run.durationMs)" class="type-mono-meta shrink-0">
                {{ formatDuration(run.durationMs) }}
              </span>
              <span class="type-mono-meta shrink-0 w-16 text-right">{{ relativeTime(run.at) }}</span>
            </NuxtLink>
          </div>
        </div>
      </div>

      <EmptyState
        v-else-if="!loading && !loadError"
        icon="i-lucide-alarm-clock"
        title="No rituals yet"
        description="Pick something you do every morning and let it run on its own, so the result is waiting when you get in."
        action-label="Create your first ritual"
        action-icon="i-lucide-plus"
        @action="createNew"
      />

      <!-- Suggested by whoever maintains your team's plugins -->
      <div v-if="unadopted.length" class="space-y-2">
        <h2 class="text-section-label">Suggested by your team</h2>
        <div
          v-for="ritual in unadopted"
          :key="ritual.command"
          class="flex items-center gap-3 px-4 py-3 rounded-lg"
          style="border: 1px dashed var(--border-subtle);"
        >
          <UIcon name="i-lucide-sparkles" class="size-4 shrink-0" style="color: var(--plugin);" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="type-strong truncate text-body">{{ ritual.title }}</span>
              <span
                class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0"
                style="background: var(--plugin-tint); color: var(--plugin);"
              >
                {{ ritual.pluginName }}
              </span>
            </div>
            <div class="flex items-center gap-2 mt-0.5 type-mono-meta">
              <span style="color: var(--accent);">{{ ritual.command }}</span>
              <span>{{ ritual.recurrenceLabel }}</span>
            </div>
            <p v-if="ritual.description" class="fs-mono mt-0.5 text-label">{{ ritual.description }}</p>
          </div>
          <UButton
            label="Add"
            size="xs"
            variant="soft"
            :loading="adopting === ritual.command"
            @click="onAdopt(ritual)"
          />
        </div>
      </div>
    </div>

    <UModal v-model:open="showModal">
      <template #content>
        <ScheduleModal
          :schedule="editing"
          @saved="() => { showModal = false; fetchAll() }"
          @close="showModal = false"
        />
      </template>
    </UModal>
  </div>
</template>
