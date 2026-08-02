<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import type { Schedule, SuggestedRitual } from '~/composables/useSchedules'

const { schedules, suggested, loading, fetchAll, remove, setEnabled, adopt, revokeRule } = useSchedules()
const { describeRule } = usePermissionRuleLabels()
const toast = useToast()

const editing = ref<Schedule | null>(null)
const showModal = ref(false)
const adopting = ref<string | null>(null)

onMounted(fetchAll)

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

const unadopted = computed(() => suggested.value.filter(s => !s.alreadyAdded))

function nextLabel(schedule: Schedule) {
  if (!schedule.enabled) return 'paused'
  if (!schedule.nextRunAt) return ''
  const date = new Date(schedule.nextRunAt)
  const isToday = date.toDateString() === new Date().toDateString()
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  return isToday ? `next today ${time}` : `next ${date.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
}
</script>

<template>
  <div>
    <PageHeader title="Daily rituals">
      <template #trailing>
        <span v-if="schedules.length" class="font-mono text-[12px] text-meta">{{ schedules.length }}</span>
      </template>
      <template #right>
        <UButton label="New ritual" icon="i-lucide-plus" size="sm" @click="createNew" />
      </template>
    </PageHeader>

    <div class="px-6 py-4 space-y-6 max-w-4xl">
      <p class="type-body leading-relaxed">
        Things Claude runs for you on a schedule, so the result is waiting when you get in.
        They run while this app is open.
      </p>

      <div v-if="loading && !schedules.length" class="space-y-1">
        <SkeletonRow v-for="i in 3" :key="i" />
      </div>

      <!-- Yours -->
      <div v-if="schedules.length" class="space-y-2">
        <div
          v-for="schedule in schedules"
          :key="schedule.id"
          class="flex items-center gap-3 px-4 py-3 rounded-lg"
          style="border: 1px solid var(--border-subtle);"
          :style="{ opacity: schedule.enabled ? 1 : 0.6 }"
        >
          <UIcon name="i-lucide-alarm-clock" class="size-4 shrink-0" style="color: var(--accent);" />

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="type-strong truncate text-body">{{ schedule.title }}</span>
              <span
                v-if="schedule.origin === 'team'"
                class="text-[9px] font-mono px-1.5 py-px rounded-full shrink-0"
                style="background: rgba(139, 92, 246, 0.12); color: rgb(139, 92, 246);"
              >
                {{ schedule.pluginName || 'team' }}
              </span>
            </div>
            <div class="flex items-center gap-2 mt-0.5 type-mono-meta">
              <span v-if="schedule.invocation" style="color: var(--accent);">{{ schedule.invocation }}</span>
              <span>{{ schedule.description }}</span>
              <span>·</span>
              <span>{{ nextLabel(schedule) }}</span>
            </div>

            <!-- What this ritual has been allowed to do without asking -->
            <div v-if="schedule.allowRules?.length" class="flex items-center gap-1.5 flex-wrap mt-1.5">
              <span
                v-for="rule in schedule.allowRules"
                :key="rule"
                class="inline-flex items-center gap-1 text-[10px] px-1.5 py-px rounded-md group/rule"
                style="background: var(--badge-subtle-bg); color: var(--text-secondary);"
                :title="rule"
              >
                <UIcon name="i-lucide-shield-check" class="size-2.5 shrink-0" style="color: var(--success);" />
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
          </div>

          <NuxtLink
            v-if="schedule.lastRunId"
            :to="`/runs/${schedule.lastRunId}`"
            class="text-[11px] px-2 py-1 rounded hover-bg shrink-0 text-meta"
          >
            Last result
          </NuxtLink>

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
          <button class="p-1 rounded hover-bg shrink-0" style="color: var(--error);" title="Remove" @click="onRemove(schedule)">
            <UIcon name="i-lucide-trash-2" class="size-3.5" />
          </button>
        </div>
      </div>

      <EmptyState
        v-else-if="!loading"
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
          <UIcon name="i-lucide-sparkles" class="size-4 shrink-0" style="color: rgb(139, 92, 246);" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="type-strong truncate text-body">{{ ritual.title }}</span>
              <span
                class="text-[9px] font-mono px-1.5 py-px rounded-full shrink-0"
                style="background: rgba(139, 92, 246, 0.12); color: rgb(139, 92, 246);"
              >
                {{ ritual.pluginName }}
              </span>
            </div>
            <div class="flex items-center gap-2 mt-0.5 type-mono-meta">
              <span style="color: var(--accent);">{{ ritual.command }}</span>
              <span>{{ ritual.recurrenceLabel }}</span>
            </div>
            <p v-if="ritual.description" class="text-[11px] mt-0.5 text-label">{{ ritual.description }}</p>
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
