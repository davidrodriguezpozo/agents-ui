<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { renderMarkdown } from '~/utils/markdown'
import type { PermissionRequest } from '~/types'

const route = useRoute()
const id = route.params.id as string

const { live, attach, cancelRun, startRun, promptsFor, isAnsweringPermission, answerPermission } = useRuns()
const { allowRules: grantRules } = useSchedules()
const granting = ref(false)
const granted = ref(false)
const router = useRouter()
const rerunning = ref(false)
const prompts = promptsFor(id)
const toast = useToast()

const loadError = ref<string | null>(null)
const meta = ref<{
  title: string
  invocation?: string
  createdAt: number
  projectDir?: string
  input?: string
  needsAttention?: boolean
  deniedTools?: string[]
  suggestedRules?: string[]
  scheduleId?: string
} | null>(null)
let controller: AbortController | null = null

const run = computed(() => live.value[id])
const isActive = computed(() => run.value?.status === 'running' || run.value?.status === 'queued')

onMounted(async () => {
  try {
    const record = await $fetch<NonNullable<typeof meta.value>>(`/api/runs/${encodeURIComponent(id)}`)
    meta.value = record
  } catch {
    loadError.value = 'That run no longer exists.'
    return
  }

  controller = new AbortController()
  try {
    // Replays everything already recorded, then follows live if still going.
    await attach(id, controller.signal)
  } catch (e: unknown) {
    if (!(e instanceof Error && e.name === 'AbortError')) {
      loadError.value = e instanceof Error ? e.message : 'Lost connection to the run.'
    }
  }
})

onUnmounted(() => controller?.abort())

async function onCancel() {
  try {
    await cancelRun(id)
    toast.add({ title: 'Run stopped', color: 'success' })
  } catch {
    toast.add({ title: 'Could not stop the run', color: 'error' })
  }
}

const statusStyle = computed(() => {
  switch (run.value?.status) {
    case 'running':
    case 'queued':
      return { background: 'var(--accent-muted)', color: 'var(--accent)' }
    case 'completed':
      return { background: 'rgba(34,197,94,0.12)', color: 'rgb(34,197,94)' }
    case 'failed':
      return { background: 'rgba(248,113,113,0.12)', color: 'var(--error)' }
    default:
      return { background: 'var(--badge-subtle-bg)', color: 'var(--text-tertiary)' }
  }
})

/** Rerun with a person present, so the prompts can actually be answered. */
async function rerunWithApproval() {
  if (!meta.value?.input || rerunning.value) return
  rerunning.value = true
  try {
    const newId = await startRun({
      input: meta.value.input,
      kind: 'command',
      title: meta.value.title,
      invocation: meta.value.invocation,
    })
    router.push(`/runs/${newId}`)
  } catch (e: any) {
    toast.add({ title: 'Could not start', description: errorMessage(e), color: 'error' })
  } finally {
    rerunning.value = false
  }
}

/**
 * Grant the ritual exactly what this run asked for. Narrower than raising the
 * ritual's trust level, and it means tomorrow's run just works.
 */
async function alwaysAllow() {
  if (!meta.value?.scheduleId || !meta.value.suggestedRules?.length) return
  granting.value = true
  try {
    await grantRules(meta.value.scheduleId, meta.value.suggestedRules)
    granted.value = true
    toast.add({ title: 'Allowed from now on', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not update the ritual', description: errorMessage(e), color: 'error' })
  } finally {
    granting.value = false
  }
}

function formatCost(usd?: number) {
  if (!usd) return null
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}
</script>

<template>
  <div>
    <PageHeader width="wide" :title="meta?.title || 'Run'">
      <template #leading>
        <NuxtLink to="/runs" class="focus-ring rounded p-1.5 -m-1.5" aria-label="Back to activity">
          <UIcon name="i-lucide-arrow-left" class="size-4 text-label" />
        </NuxtLink>
      </template>
      <template #trailing>
        <span
          v-if="run"
          class="text-[10px] font-mono px-1.5 py-px rounded-full"
          :style="statusStyle"
        >
          {{ run.status }}
        </span>
        <span v-if="meta?.invocation" class="font-mono text-[12px]" style="color: var(--accent);">
          {{ meta.invocation }}
        </span>
      </template>
      <template #right>
        <UButton
          v-if="isActive"
          label="Stop"
          icon="i-lucide-square"
          size="sm"
          variant="soft"
          color="error"
          @click="onCancel"
        />
      </template>
    </PageHeader>

    <div class="page-container page-container--wide py-5 space-y-5">
      <div v-if="loadError" class="rounded-lg px-4 py-3 text-[12px]" style="background: rgba(248,113,113,0.06); color: var(--error);">
        {{ loadError }}
      </div>

      <template v-else-if="run">
        <!-- Blocked on you: the run cannot move until these are answered -->
        <div v-if="prompts.length" class="space-y-2">
          <PermissionPrompt
            v-for="request in prompts"
            :key="request.id"
            :request="(request as PermissionRequest)"
            :busy="isAnsweringPermission(request.id)"
            @answer="answerPermission(request.id, $event)"
          />
        </div>

        <!-- This is the point of the whole thing: it kept going without you -->
        <div
          v-if="isActive && !prompts.length"
          class="rounded-lg px-4 py-3 flex items-center gap-3"
          style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
        >
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin shrink-0" style="color: var(--accent);" />
          <span class="text-[12px] text-body">
            Running — you can close this tab and come back to it.
          </span>
        </div>

        <!-- A scheduled run that hit a wall. The result below is incomplete, and
             saying so matters more than presenting it as finished. -->
        <div
          v-if="meta?.needsAttention"
          class="rounded-lg px-4 py-3 flex items-start gap-3"
          style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
        >
          <UIcon name="i-lucide-shield-alert" class="size-4 shrink-0 mt-0.5" style="color: var(--accent);" />
          <div class="flex-1 min-w-0 space-y-1">
            <div class="text-[12px] font-medium text-body">This result is incomplete</div>
            <p class="text-[11px] leading-relaxed text-label">
              It ran on a schedule, and
              <strong>{{ (meta.deniedTools || []).join(', ') || 'a tool' }}</strong>
              needed permission that nobody was there to give.
            </p>
            <p v-if="granted" class="text-[11px] leading-relaxed" style="color: var(--success);">
              Allowed from now on. The next run will not stop for this.
            </p>
            <p
              v-else-if="meta.scheduleId && meta.suggestedRules?.length"
              class="text-[11px] leading-relaxed text-label"
            >
              You can allow just what it needed —
              <span class="font-mono" style="color: var(--text-primary);">
                {{ meta.suggestedRules.join(', ') }}
              </span>
              — rather than giving it full access.
            </p>
            <p v-else class="text-[11px] leading-relaxed text-label">
              Run it again yourself, or raise what the ritual is allowed to do.
            </p>
          </div>
          <div class="flex flex-col gap-1.5 shrink-0">
            <UButton
              v-if="meta.scheduleId && meta.suggestedRules?.length && !granted"
              label="Always allow"
              icon="i-lucide-shield-check"
              size="xs"
              :loading="granting"
              :title="meta.suggestedRules.join(', ')"
              @click="alwaysAllow"
            />
            <UButton
              label="Run it now"
              icon="i-lucide-play"
              size="xs"
              :variant="meta.scheduleId && meta.suggestedRules?.length && !granted ? 'soft' : 'solid'"
              :color="meta.scheduleId && meta.suggestedRules?.length && !granted ? 'neutral' : 'primary'"
              :loading="rerunning"
              @click="rerunWithApproval"
            />
            <UButton label="Ritual settings" size="xs" variant="ghost" color="neutral" to="/schedules" />
          </div>
        </div>

        <div v-if="run.error" class="rounded-lg px-4 py-3 text-[12px]" style="background: rgba(248,113,113,0.06); color: var(--error);">
          {{ run.error }}
        </div>

        <!-- Result -->
        <div v-if="run.output" class="rounded-lg overflow-hidden" style="border: 1px solid var(--border-subtle);">
          <div
            class="px-4 py-2.5 flex items-center justify-between"
            style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);"
          >
            <h3 class="text-section-label">Result</h3>
            <div class="flex items-center gap-3 type-mono-meta">
              <span v-if="run.stats">{{ run.stats.numTurns }} turns</span>
              <span v-if="formatCost(run.stats?.costUsd)">{{ formatCost(run.stats?.costUsd) }}</span>
            </div>
          </div>
          <div
            class="px-5 py-4 run-prose text-[13px] leading-[1.7] overflow-x-auto"
            style="color: var(--text-primary); font-family: var(--font-sans);"
            v-html="renderMarkdown(run.output)"
          />
        </div>

        <div v-else-if="!isActive" class="rounded-lg p-6 text-center bg-card">
          <p class="type-body">This run produced no output.</p>
        </div>

        <!-- What it did -->
        <div v-if="run.toolCalls.length" class="space-y-2">
          <h3 class="text-section-label">What it did</h3>
          <div
            v-for="call in run.toolCalls"
            :key="call.id"
            class="flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-mono"
            style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
          >
            <UIcon
              :name="call.isError ? 'i-lucide-circle-alert' : 'i-lucide-wrench'"
              class="size-3 shrink-0"
              :style="{ color: call.isError ? 'var(--error)' : 'var(--text-disabled)' }"
            />
            <span class="shrink-0 text-body">{{ call.toolName }}</span>
            <span class="flex-1 truncate text-meta">{{ call.result || '…' }}</span>
          </div>
        </div>

        <details v-if="meta?.projectDir" class="group">
          <summary class="text-[10px] cursor-pointer list-none flex items-center gap-1.5 text-meta">
            <UIcon name="i-lucide-folder" class="size-3" />
            Ran in
          </summary>
          <div class="mt-1 font-mono text-[10px] pl-4.5 text-meta">{{ meta.projectDir }}</div>
        </details>
      </template>

      <div v-else class="flex justify-center py-16">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.run-prose :deep(p) { margin: 0.5em 0; }
.run-prose :deep(p:first-child) { margin-top: 0; }
.run-prose :deep(h1), .run-prose :deep(h2), .run-prose :deep(h3) {
  font-weight: 600;
  margin: 1em 0 0.4em;
  font-family: var(--font-display);
}
.run-prose :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--badge-subtle-bg);
  padding: 0.15em 0.4em;
  border-radius: 4px;
}
.run-prose :deep(pre) {
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 0.75em 1em;
  overflow-x: auto;
  margin: 0.6em 0;
}
.run-prose :deep(pre code) { background: none; padding: 0; font-size: 0.85em; }
.run-prose :deep(ul), .run-prose :deep(ol) { padding-left: 1.5em; margin: 0.4em 0; }
.run-prose :deep(table) { border-collapse: collapse; margin: 0.6em 0; }
.run-prose :deep(th), .run-prose :deep(td) {
  border: 1px solid var(--border-subtle);
  padding: 0.35em 0.6em;
  text-align: left;
}
</style>
