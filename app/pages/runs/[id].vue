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
  refusedHosts?: string[]
  suggestedRules?: string[]
  stoppedBy?: 'budget' | 'turns'
  scheduleId?: string
  sessionId?: string
  /** Where a grant from this run should be filed — the repo, not a worktree. */
  rulesDir?: string
} | null>(null)
let controller: AbortController | null = null

const run = computed(() => live.value[id])

/**
 * What this run was, in the one place it changes what can be offered.
 *
 * The blocked banner used to say "it ran on a schedule" about every run that
 * hit a wall, including session turns and workflow steps, and offered the one
 * thing only a ritual could do.
 */
const blockedKind = computed<'ritual' | 'project' | 'neither'>(() => {
  // A run that used up its turns was not refused anything, so there is no
  // permission to grant and offering one would be nonsense.
  if (meta.value?.stoppedBy) return 'neither'
  if (meta.value?.scheduleId) return 'ritual'
  if (meta.value?.rulesDir && meta.value.suggestedRules?.length) return 'project'
  return 'neither'
})

const canLearn = computed(() => blockedKind.value !== 'neither' && !granted.value)
const isActive = computed(() => run.value?.status === 'running' || run.value?.status === 'queued')

/**
 * The other wall a run can hit. A sandboxed run refused a host it needed comes
 * back looking finished, with the part that needed the network missing — the
 * same shape of half-done as a refused tool, and with a fix that is just as
 * narrow: this host, in this repository, rather than turning the sandbox off.
 */
const refusedHosts = computed(() => meta.value?.refusedHosts ?? [])
const hostsAllowed = ref(false)
const allowingHosts = ref(false)

// Filed against the repository rather than a session's worktree, which is the
// same unit the sandbox setting itself is keyed by.
const canAllowHosts = computed(() =>
  refusedHosts.value.length > 0 && Boolean(meta.value?.rulesDir) && !hostsAllowed.value)

async function allowHosts() {
  const dir = meta.value?.rulesDir
  if (!dir) return

  allowingHosts.value = true
  try {
    const current = await $fetch<{ allowedDomains: string[] }>(
      `/api/project/sandbox?dir=${encodeURIComponent(dir)}`,
    )
    await $fetch('/api/project/sandbox', {
      method: 'POST',
      body: {
        dir,
        allowedDomains: [...new Set([...(current.allowedDomains ?? []), ...refusedHosts.value])],
      },
    })
    hostsAllowed.value = true
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : 'Could not allow those hosts.'
  } finally {
    allowingHosts.value = false
  }
}

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

/**
 * The badge, which has to agree with the banner underneath it.
 *
 * A run that used up its turns, or was refused a tool it needed, ends
 * `completed` — the SDK finished cleanly, it just did not finish the work.
 * Wearing a green "completed" directly above "this result is incomplete" is
 * the badge contradicting the page, and the badge is the part people read.
 */
const statusLabel = computed(() => {
  if (!run.value) return ''
  if (run.value.status !== 'completed') return run.value.status
  if (meta.value?.stoppedBy) return 'ran out'
  if (meta.value?.needsAttention || meta.value?.deniedTools?.length) return 'needed you'
  // Same contradiction, different wall: a green badge over "could not reach
  // registry.npmjs.org" is the badge arguing with the page.
  if (meta.value?.refusedHosts?.length) return 'needed you'
  return 'completed'
})

const statusStyle = computed(() => {
  if (statusLabel.value === 'ran out' || statusLabel.value === 'needed you') {
    return { background: 'var(--accent-muted)', color: 'var(--accent)' }
  }

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
  const rules = meta.value?.suggestedRules ?? []
  if (!rules.length) return

  granting.value = true
  try {
    if (blockedKind.value === 'ritual') {
      await grantRules(meta.value!.scheduleId!, rules)
    } else if (blockedKind.value === 'project') {
      // Filed against the repository, so every future session here inherits it
      // — not against this run's worktree, which will not outlive the session.
      await $fetch('/api/project/rules', {
        method: 'POST',
        body: { dir: meta.value!.rulesDir, add: rules },
      })
    } else {
      return
    }

    granted.value = true
    toast.add({ title: 'Allowed from now on', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Could not save that permission', description: errorMessage(e), color: 'error' })
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
          {{ statusLabel }}
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
          v-if="meta && (meta.needsAttention || refusedHosts.length)"
          class="rounded-lg px-4 py-3 flex items-start gap-3"
          style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
        >
          <UIcon name="i-lucide-shield-alert" class="size-4 shrink-0 mt-0.5" style="color: var(--accent);" />
          <div class="flex-1 min-w-0 space-y-1">
            <div class="text-[12px] font-medium text-body">This result is incomplete</div>

            <!--
              Why, rather than a guess at why. This said "a tool needed
              permission" about every unfinished run, including ones that
              simply used up their turns and were refused nothing at all.
            -->
            <p v-if="meta.stoppedBy === 'turns'" class="text-[11px] leading-relaxed text-label">
              It used up every turn it was allowed and stopped part-way. Nothing was refused —
              it just ran out of room. Raise <strong>most turns in one run</strong> in Settings
              if this is normal for the work, or start it again and it will carry on from here.
            </p>
            <p v-else-if="meta.stoppedBy === 'budget'" class="text-[11px] leading-relaxed text-label">
              It reached the spending limit and stopped part-way. Raise the limit in Settings,
              or leave it — the limit is doing exactly what it is for.
            </p>
            <!--
              Before the permission wording, because a run stopped by the
              sandbox usually was not refused a tool at all — and saying "a tool
              needed permission" about it would send someone looking for a
              permission that does not exist.
            -->
            <p v-else-if="refusedHosts.length" class="text-[11px] leading-relaxed text-label">
              <!--
                Said whenever there are hosts, not only when there is nothing
                else. A run that hit both walls used to show the permission
                wording alone while still offering "Allow these hosts" — a
                button granting hosts the page had never named, which is the
                opposite of the narrow, explicit grant everything here is
                built on.
              -->
              <template v-if="meta.deniedTools?.length">
                It was also sandboxed and could not reach
              </template>
              <template v-else>
                It was sandboxed and could not reach
              </template>
              <strong class="font-mono">{{ refusedHosts.join(', ') }}</strong>,
              so whatever needed that did not happen.
            </p>
            <p v-else class="text-[11px] leading-relaxed text-label">
              <!--
                Each on its own line on purpose: with the text hugging the tags,
                Vue's whitespace condensing drops the newline before <strong>
                entirely and the banner reads "and Bash(gh issue edit:*)" with no
                space at all.
              -->
              <template v-if="meta.scheduleId">
                It ran on a schedule, and
              </template>
              <template v-else>
                It ran with nobody watching, and
              </template>
              <strong>{{ (meta.deniedTools || []).join(', ') || 'a tool' }}</strong>
              needed permission that nobody was there to give.
            </p>
            <p v-if="hostsAllowed" class="text-[11px] leading-relaxed" style="color: var(--success);">
              Allowed here from now on. The next run will reach them.
            </p>
            <p v-else-if="canAllowHosts" class="text-[11px] leading-relaxed text-label">
              You can allow just these hosts for this project, rather than turning the
              sandbox off for it.
            </p>
            <p v-if="granted" class="text-[11px] leading-relaxed" style="color: var(--success);">
              Allowed from now on. The next run will not stop for this.
            </p>
            <p v-else-if="canLearn" class="text-[11px] leading-relaxed text-label">
              You can allow just what it needed —
              <span class="font-mono" style="color: var(--text-primary);">
                {{ meta.suggestedRules?.join(', ') }}
              </span>
              — rather than giving it full access.
              <template v-if="blockedKind === 'project'">
                It applies to this whole project, so no session here has to ask again.
              </template>
            </p>
            <!-- The generic fallback, and only when nothing more specific was
                 said above it — a refused host already names its own fix. -->
            <p
              v-else-if="!meta.stoppedBy && !refusedHosts.length"
              class="text-[11px] leading-relaxed text-label"
            >
              Run it again yourself, or raise what this is allowed to do.
            </p>
          </div>
          <div class="flex flex-col gap-1.5 shrink-0">
            <!--
              Rituals could always be taught this; sessions never could, so the
              same approval was given by hand every time. The grant goes to
              whichever thing is able to remember it.
            -->
            <UButton
              v-if="canLearn"
              :label="blockedKind === 'project' ? 'Always allow here' : 'Always allow'"
              icon="i-lucide-shield-check"
              size="xs"
              :loading="granting"
              :title="meta.suggestedRules?.join(', ')"
              @click="alwaysAllow"
            />
            <UButton
              v-if="canAllowHosts"
              label="Allow these hosts"
              icon="i-lucide-globe"
              size="xs"
              :loading="allowingHosts"
              :title="refusedHosts.join(', ')"
              @click="allowHosts"
            />
            <UButton
              label="Run it now"
              icon="i-lucide-play"
              size="xs"
              :variant="canLearn ? 'soft' : 'solid'"
              :color="canLearn ? 'neutral' : 'primary'"
              :loading="rerunning"
              @click="rerunWithApproval"
            />
            <UButton
              v-if="meta.stoppedBy"
              label="Change the limits"
              size="xs"
              variant="ghost"
              color="neutral"
              to="/settings"
            />
            <UButton
              v-else-if="meta.scheduleId"
              label="Ritual settings"
              size="xs"
              variant="ghost"
              color="neutral"
              to="/schedules"
            />
            <UButton
              v-if="meta.sessionId"
              label="Open the session"
              size="xs"
              variant="ghost"
              color="neutral"
              :to="`/sessions/${meta.sessionId}`"
            />
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
            class="px-5 py-4 markdown text-[13px] overflow-x-auto"
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

