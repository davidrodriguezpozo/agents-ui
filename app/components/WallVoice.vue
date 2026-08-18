<script setup lang="ts">
import { describe as describeCommand, type VoiceCommand } from '~/utils/voice'
import type { VoiceState } from '~/composables/useVoice'

/**
 * What the room can see the microphone doing.
 *
 * Three things have to be visible at all times, and each of them is a boundary
 * rather than a nicety:
 *
 * - **whether it is listening**, because a microphone whose state is a guess is
 *   the reason people distrust these;
 * - **what it heard**, verbatim, because recognition is a guess and the guess is
 *   what will be acted on;
 * - **what it understood**, separately from what it heard, because those differ
 *   and the confirmation below is against the second one.
 *
 * A command that will start or stop work waits here for a keypress. The prompt
 * says which key. It never counts down and never proceeds on its own: a
 * confirmation that expires into "yes" is not a confirmation, and one that
 * expires into "no" is what you want when somebody has walked away.
 */
const props = defineProps<{
  state: VoiceState
  transcript: string
  /** The parsed command awaiting a hand, if any. */
  pending: VoiceCommand | null
  /** What the last command did, in words, for the seconds after it happened. */
  outcome: string | null
  error: string | null
}>()

const listening = computed(() => props.state === 'listening')

const label = computed(() => {
  if (props.error) return props.error
  if (listening.value) return props.transcript || 'Listening…'
  if (props.pending) return null
  if (props.outcome) return props.outcome
  return 'Hold V to speak'
})

const tone = computed(() => {
  if (props.error) return 'error'
  if (props.pending?.kind === 'refused') return 'error'
  if (listening.value) return 'live'
  return 'quiet'
})
</script>

<template>
  <div class="voice" :class="[`is-${tone}`, { 'is-listening': listening }]">
    <span class="voice-dot" />

    <p v-if="label" class="voice-line">{{ label }}</p>

    <template v-if="pending">
      <p class="voice-heard">“{{ transcript }}”</p>

      <p v-if="pending.kind === 'refused'" class="voice-understood">{{ pending.why }}</p>

      <template v-else>
        <p class="voice-understood">{{ describeCommand(pending) }}</p>
        <span class="voice-confirm">
          <kbd>Enter</kbd> to run · <kbd>Esc</kbd> to drop it
        </span>
      </template>
    </template>
  </div>
</template>

<style scoped>
.voice {
  display: flex;
  align-items: baseline;
  gap: clamp(8px, 1vw, 18px);
  min-width: 0;
  padding: clamp(6px, 0.8vh, 12px) clamp(8px, 1vw, 16px);
  border-radius: 8px;
  border: 1px solid transparent;
  transition: border-color 0.3s ease, background 0.3s ease;
}

.voice.is-live {
  background: var(--accent-muted);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}

.voice.is-error {
  background: var(--error-wash);
  border-color: var(--error-edge);
}

.voice-dot {
  width: clamp(7px, 0.6vw, 10px);
  height: clamp(7px, 0.6vw, 10px);
  border-radius: 999px;
  flex-shrink: 0;
  align-self: center;
  background: var(--text-disabled);
}

.voice.is-live .voice-dot {
  background: var(--accent);
}

.voice.is-error .voice-dot {
  background: var(--error);
}

/* Unmistakable, and only while the key is actually held. */
.voice.is-listening .voice-dot {
  animation: voice-pulse 1.1s ease-in-out infinite;
}

@keyframes voice-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.55; }
}

@media (prefers-reduced-motion: reduce) {
  .voice.is-listening .voice-dot {
    animation: none;
  }
}

.voice-line {
  font-family: var(--font-mono);
  font-size: clamp(11px, 0.9vw, 16px);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice.is-live .voice-line {
  color: var(--text-primary);
}

.voice.is-error .voice-line {
  color: var(--error);
}

/* What was said, kept visually distinct from what it was taken to mean. */
.voice-heard {
  font-family: var(--font-mono);
  font-size: clamp(11px, 0.85vw, 15px);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 34ch;
}

.voice-understood {
  font-family: var(--font-sans);
  font-size: clamp(12px, 1vw, 18px);
  font-weight: 500;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice.is-error .voice-understood {
  color: var(--error);
}

.voice-confirm {
  flex-shrink: 0;
  font-family: var(--font-sans);
  font-size: clamp(10px, 0.8vw, 14px);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.voice-confirm kbd {
  font-family: var(--font-mono);
  font-size: 0.95em;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--badge-subtle-bg);
  color: var(--text-secondary);
}
</style>
