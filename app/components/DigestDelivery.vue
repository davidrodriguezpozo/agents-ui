<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import { relativeTime } from '~/utils/time'

/**
 * Sending the morning report to Slack.
 *
 * The panel is arranged around the one rule that makes this safe: the schedule
 * does not start until a send has worked once by hand. So the button comes before
 * the switch, and the switch says what it is waiting for while there is nothing
 * to switch on. Turning it on first and finding out at 08:15 that Slack was never
 * reachable is the failure this shape prevents.
 */
interface Delivery {
  enabled: boolean
  /** Null on the way out is how "stop sending it daily" is said. */
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

const state = ref<Delivery | null>(null)
const loading = ref(true)
const saving = ref(false)
const sending = ref(false)
const toast = useToast()

/** Local copies, so typing a time does not save on every keystroke. */
const destination = ref('')
const at = ref('')

async function load() {
  try {
    state.value = await $fetch<Delivery>('/api/digest/delivery')
    destination.value = state.value.destination
    at.value = state.value.at ?? ''
  } catch (e) {
    toast.add({ title: 'Could not read the delivery settings', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function save(patch: Partial<Delivery>) {
  saving.value = true
  try {
    state.value = await $fetch<Delivery>('/api/digest/delivery', { method: 'PUT', body: patch })
    destination.value = state.value.destination
    at.value = state.value.at ?? ''
  } catch (e) {
    toast.add({ title: 'Could not save that', description: errorMessage(e), color: 'error' })
    // Put the fields back to what is actually stored, rather than leaving a
    // refused value on screen looking saved.
    await load()
  } finally {
    saving.value = false
  }
}

/**
 * Send one now.
 *
 * Also the only thing that resolves the destination, which is why the wording is
 * about proving it rather than about testing it: what comes back is the channel
 * the schedule will use from then on, and this is the moment to notice it is the
 * wrong one.
 */
async function onSendNow() {
  sending.value = true
  try {
    const result = await $fetch<{ sent: boolean; because?: string; state: Delivery }>(
      '/api/digest/send',
      { method: 'POST', body: { force: true } },
    )
    state.value = result.state

    toast.add({
      title: result.sent
        ? `Sent to ${result.state.channelLabel ?? result.state.channelId}`
        : 'Nothing was sent',
      description: result.sent
        ? 'That is the destination the daily send will use from now on.'
        : result.because,
      color: result.sent ? 'success' : 'warning',
    })
  } catch (e) {
    toast.add({ title: 'Could not send it', description: errorMessage(e), color: 'error' })
    await load()
  } finally {
    sending.value = false
  }
}

/** What the schedule is still waiting for, or nothing. */
const blocked = computed(() => {
  if (!state.value) return null
  if (!state.value.channelId) return 'Send one by hand first — that is what works out where it goes.'
  if (!state.value.at) return 'Set a time and it will go every day.'
  return null
})

const changed = computed(() =>
  state.value !== null
  && (destination.value.trim() !== state.value.destination || at.value !== (state.value.at ?? '')))
</script>

<template>
  <div
    id="settings-digest"
    class="rounded-lg p-5 space-y-4 bg-card"
  >
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-section-label flex items-center gap-2">
          Morning message
          <HelpTip
            title="The report, sent to you"
            body="The same report the app shows you, posted to Slack through the MCP server you already have set up. There is no token to paste and nothing new stored."
          />
        </h3>
        <p class="type-body mt-1">
          What happened overnight, sent where you already look. Nothing goes out on a morning
          when nothing happened — a daily &ldquo;all quiet&rdquo; is how a channel gets muted.
        </p>
      </div>
      <UButton
        label="Send one now"
        icon="i-lucide-send"
        size="sm"
        variant="soft"
        class="shrink-0"
        :loading="sending"
        :disabled="loading"
        @click="onSendNow"
      />
    </div>

    <div
      v-if="loading"
      class="space-y-1"
    >
      <SkeletonRow v-for="i in 2" :key="i" />
    </div>

    <template v-else-if="state">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="space-y-1.5 block">
          <span class="type-meta">Where it goes</span>
          <input
            v-model="destination"
            placeholder="a direct message to me"
            class="field-input w-full"
          />
          <span class="type-meta block">
            In your own words — <span class="font-mono">#daily-brief</span>, or a direct message
            to yourself. Changing it means sending one by hand again.
          </span>
        </label>

        <label class="space-y-1.5 block">
          <span class="type-meta">What time</span>
          <input
            v-model="at"
            type="time"
            placeholder="08:15"
            class="field-input w-full"
          />
          <span class="type-meta block">
            A little after your rituals. A report assembled at 08:00 sharp is a report about a
            morning that has not happened yet.
          </span>
        </label>
      </div>

      <div class="flex items-center gap-3">
        <UButton
          v-if="changed"
          label="Save"
          size="sm"
          :loading="saving"
          @click="save({ destination: destination.trim(), at: at || null })"
        />
        <span
          v-if="changed"
          class="type-meta"
        >Not saved yet.</span>
      </div>

      <label
        class="flex items-start justify-between gap-4 py-2 px-3 rounded-md cursor-pointer"
        style="background: var(--input-bg);"
        :style="{ opacity: state.channelId && state.at ? 1 : 0.6 }"
      >
        <span>
          <span class="type-strong text-body block">Send it every day</span>
          <span class="type-meta">
            {{ blocked ?? `Every day at ${state.at}, to ${state.channelLabel ?? state.channelId}.` }}
          </span>
        </span>
        <span class="field-toggle shrink-0 mt-0.5">
          <input
            type="checkbox"
            :checked="state.enabled"
            :disabled="Boolean(blocked)"
            @change="save({ enabled: ($event.target as HTMLInputElement).checked })"
          />
          <span class="field-toggle__track">
            <span class="field-toggle__thumb" />
          </span>
        </span>
      </label>

      <!--
        The last attempt, whatever it was. A feature that has been unable to send
        for a week must not read as one that sent successfully a week ago.
      -->
      <div
        v-if="state.lastError"
        class="rounded-md px-4 py-3 flex items-start gap-3"
        style="background: var(--accent-muted); border: 1px solid var(--accent-glow);"
      >
        <UIcon
          name="i-lucide-triangle-alert"
          class="size-4 shrink-0 mt-0.5 ink-accent"
        />
        <div class="space-y-1">
          <div class="type-strong">The last attempt did not go through</div>
          <div class="type-detail ink-2">{{ state.lastError }}</div>
        </div>
      </div>

      <div class="type-meta space-y-1">
        <div v-if="state.lastSentAt">
          Last sent {{ relativeTime(state.lastSentAt) }}
          <template v-if="state.channelLabel">to {{ state.channelLabel }}</template>
          <template v-if="state.costUsd">· ${{ state.costUsd.toFixed(2) }}</template>
        </div>
        <div v-else>
          Nothing has been sent yet.
        </div>
        <div v-if="state.lastSkippedWhy">
          {{ state.lastSkippedWhy }}
        </div>
      </div>
    </template>
  </div>
</template>
