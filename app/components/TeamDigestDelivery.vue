<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { relativeTime } from '~/utils/time'

/**
 * Sending one message a day about what the team shipped.
 *
 * Arranged around the same rule the morning report is: the schedule does not
 * start until a send has worked once by hand, so the button comes before the
 * switch and the switch says what it is waiting for. Turning it on first and
 * finding out at 09:15 that Slack was never reachable is the failure this shape
 * prevents.
 *
 * Two things are here that the morning report's panel does not have, and both
 * are because this message goes to a room other people are in:
 *
 *   - **A preview of exactly what would go out**, composed by the same function
 *     the send uses. "What will they read" has to be answerable before the first
 *     send, not after it.
 *   - **The refusal, stated where the switch would be.** There is no reply
 *     switch to turn on: a channel can receive and can never command. Saying so
 *     in the place somebody would look for it is more use than an absence.
 */

interface TeamState {
  enabled: boolean
  at?: string | null
  destination: string
  projectDir?: string
  channelId?: string
  channelLabel?: string
  lastSentAt?: number
  lastSkippedAt?: number
  lastSkippedWhy?: string
  lastError?: string
  costUsd?: number
  durationMs?: number
}

interface TeamAnswer {
  state: TeamState
  digest: { landings: number; reverts: number; turns: number; costUsd: number; machines: number }
  wouldSend: boolean
  because: string | null
  commands: string
}

const answer = ref<TeamAnswer | null>(null)
const loading = ref(true)
const saving = ref(false)
const sending = ref(false)
const destination = ref('')
const at = ref('')
const toast = useToast()

const state = computed(() => answer.value?.state ?? null)
/** A send has worked, which is the only thing that can arm the schedule. */
const proven = computed(() => Boolean(state.value?.channelId))

async function load() {
  loading.value = true
  try {
    answer.value = await $fetch<TeamAnswer>('/api/digest/team')
    destination.value = answer.value.state.destination ?? ''
    at.value = answer.value.state.at ?? ''
  } catch (e) {
    toast.add({ title: 'Could not read the team digest settings', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function save(patch: Record<string, unknown>) {
  saving.value = true
  try {
    await $fetch('/api/digest/team', { method: 'POST', body: patch })
    await load()
  } catch (e) {
    toast.add({ title: 'Could not save that', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function sendNow() {
  sending.value = true
  try {
    const result = await $fetch<{ sent?: boolean; because?: string }>('/api/digest/team', {
      method: 'POST',
      body: { send: true, destination: destination.value },
    })
    toast.add({
      title: result.sent ? 'Sent' : 'Nothing to send',
      description: result.sent
        ? 'Check the channel, then turn the daily message on.'
        : result.because,
      color: result.sent ? 'success' : 'warning',
    })
    await load()
  } catch (e) {
    toast.add({ title: 'Could not send it', description: errorMessage(e), color: 'error' })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div id="settings-team-digest" class="rounded-lg p-5 space-y-4 bg-card">
    <h3 class="text-section-label">What we shipped</h3>
    <p class="fs-sm text-meta">
      One message a day to a channel: what landed, by whom, per repository, and what it cost —
      read from every machine's own ledger rather than from this one. Nothing goes out on a day
      when nothing landed, because a channel told "all quiet" every morning gets muted.
    </p>

    <p v-if="loading" class="fs-sm text-label">Reading the settings…</p>

    <template v-else-if="answer">
      <div class="field-group">
        <label class="field-label">Where it goes</label>
        <div class="flex gap-2">
          <input
            v-model="destination"
            class="field-input flex-1"
            placeholder="#shipping"
            spellcheck="false"
          />
          <UButton
            label="Send one now"
            size="sm"
            :loading="sending"
            :disabled="!destination.trim()"
            @click="sendNow"
          />
        </div>
        <p class="field-hint">
          <template v-if="state?.channelLabel">
            Last resolved to <span class="font-mono">{{ state.channelLabel }}</span>, and that is
            what every send after the first uses — a destination re-derived from words each
            morning is one that can drift.
          </template>
          <template v-else>
            A private channel first. The name is read once to find the channel; after that the
            channel is what is used.
          </template>
        </p>
      </div>

      <!-- The switch, and what it is waiting for while there is nothing to switch. -->
      <label
        class="flex items-start justify-between gap-4 py-2 px-3 rounded-md"
        :class="proven ? 'cursor-pointer' : ''"
        style="background: var(--input-bg);"
      >
        <span>
          <span class="type-strong text-body block">Send it daily</span>
          <span class="type-meta">
            <template v-if="!proven">
              Waiting on a send that worked. Nothing is scheduled until one has gone out by hand.
            </template>
            <template v-else-if="state?.enabled">
              Every day at {{ state.at || '—' }}, covering everything since the last message.
            </template>
            <template v-else>Off. One message a day at the time below.</template>
          </span>
        </span>
        <span class="field-toggle shrink-0 mt-0.5">
          <input
            type="checkbox"
            :checked="state?.enabled"
            :disabled="!proven || saving"
            @change="save({ enabled: ($event.target as HTMLInputElement).checked })"
          />
          <span class="field-toggle__track"><span class="field-toggle__thumb" /></span>
        </span>
      </label>

      <div class="field-group">
        <label class="field-label">What time</label>
        <div class="flex gap-2">
          <input v-model="at" class="field-input" placeholder="09:00" spellcheck="false" />
          <UButton
            label="Save"
            size="sm"
            variant="soft"
            :loading="saving"
            :disabled="at === (state?.at ?? '')"
            @click="save({ at: at || null })"
          />
        </div>
        <p class="field-hint">
          A little after your rituals rather than with them — a report assembled at 09:00 sharp
          is a report about a morning that has not happened.
        </p>
      </div>

      <!-- What a channel would read right now, from the same composer. -->
      <div class="field-group">
        <label class="field-label">Right now it would say</label>
        <p class="field-hint">
          <template v-if="answer.wouldSend">
            {{ answer.digest.landings }} merged, {{ answer.digest.reverts }} taken back out,
            ${{ answer.digest.costUsd.toFixed(2) }} across {{ answer.digest.turns }} turns, from
            {{ answer.digest.machines }} {{ answer.digest.machines === 1 ? 'machine' : 'machines' }}.
          </template>
          <template v-else>
            Nothing — {{ answer.because }} A press sends one anyway, because an empty answer to a
            button reads as broken software.
          </template>
        </p>
      </div>

      <p v-if="state?.lastSentAt" class="field-hint">
        Last sent {{ relativeTime(state.lastSentAt) }}<template v-if="state.costUsd">, ${{ state.costUsd.toFixed(2) }}</template>.
      </p>
      <p v-else-if="state?.lastSkippedAt" class="field-hint">
        Last looked {{ relativeTime(state.lastSkippedAt) }} and said nothing: {{ state.lastSkippedWhy }}
      </p>
      <p v-if="state?.lastError" class="field-hint" style="color: var(--error);">
        {{ state.lastError }}
      </p>

      <!--
        Where somebody would look for a reply switch. There is not one, and the
        reason is worth reading rather than inferring from an absence.
      -->
      <p class="field-hint" style="border-top: 1px solid var(--border-subtle); padding-top: 10px;">
        {{ answer.commands }}
      </p>
    </template>
  </div>
</template>
