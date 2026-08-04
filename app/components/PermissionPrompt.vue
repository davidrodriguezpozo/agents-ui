<script setup lang="ts">
import type { PermissionAnswer, PermissionRequest } from '~/types'

const props = defineProps<{
  request: PermissionRequest
  busy?: boolean
}>()

const emit = defineEmits<{ answer: [decision: PermissionAnswer]; remember: [rule: string] }>()

const { describeRule } = usePermissionRuleLabels()

/**
 * The narrow rule the CLI itself proposed — `Bash(pnpm test:*)` rather than
 * "all commands". Offered only when there is one, because inventing a rule
 * from the arguments is how a person ends up granting more than they meant.
 */
const rememberable = computed(() => props.request.suggestedRules?.[0] ?? null)

const TOOL_VERBS: Record<string, string> = {
  Bash: 'run a command',
  Write: 'write a file',
  Edit: 'edit a file',
  Read: 'read a file',
  WebFetch: 'fetch a URL',
  WebSearch: 'search the web',
  NotebookEdit: 'edit a notebook',
}

const headline = computed(() =>
  `Claude wants to ${TOOL_VERBS[props.request.toolName] ?? `use ${props.request.toolName}`}`
)

/** The one field that actually tells you what you're approving. */
const detail = computed(() => {
  const input = props.request.input ?? {}
  const first = (...keys: string[]) => {
    for (const key of keys) {
      const value = input[key]
      if (typeof value === 'string' && value.trim()) return value
    }
    return null
  }

  return first('command', 'file_path', 'url', 'query', 'path', 'pattern')
    ?? props.request.blockedPath
    ?? JSON.stringify(input).slice(0, 400)
})
</script>

<template>
  <div
    class="rounded-lg overflow-hidden"
    style="background: var(--surface-raised); border: 1px solid var(--accent-glow);"
  >
    <div class="px-3.5 pt-3 pb-2.5 flex items-start gap-2.5">
      <UIcon
        name="i-lucide-shield-alert"
        class="size-4 shrink-0 mt-px"
        style="color: var(--accent);"
      />
      <div class="min-w-0 flex-1 space-y-1.5">
        <p class="text-[12px] font-medium" style="color: var(--text-primary);">
          {{ headline }}
        </p>
        <pre
          class="text-[11px] whitespace-pre-wrap break-words max-h-32 overflow-y-auto rounded-md px-2.5 py-2 m-0"
          style="font-family: var(--font-mono); background: var(--badge-subtle-bg); color: var(--text-secondary);"
        >{{ detail }}</pre>
        <p
          v-if="request.decisionReason"
          class="text-[10px]"
          style="color: var(--text-tertiary);"
        >
          {{ request.decisionReason }}
        </p>
      </div>
    </div>

    <div class="px-3.5 pb-3 flex flex-wrap items-center gap-1.5">
      <UButton
        label="Allow once"
        size="xs"
        color="primary"
        :loading="busy"
        :disabled="busy"
        @click="emit('answer', { behavior: 'allow', scope: 'once' })"
      />
      <UButton
        v-if="request.canRemember"
        label="Allow for this run"
        size="xs"
        variant="soft"
        color="primary"
        :disabled="busy"
        @click="emit('answer', { behavior: 'allow', scope: 'session' })"
      />
      <!-- The only moment anyone knows whether this should keep being asked -->
      <UButton
        v-if="rememberable"
        :label="`Always allow ${describeRule(rememberable)} here`"
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-lucide-shield-check"
        :disabled="busy"
        :title="`Adds ${rememberable} to this project, for every session`"
        @click="emit('remember', rememberable)"
      />
      <UButton
        label="Deny"
        size="xs"
        variant="ghost"
        color="error"
        :disabled="busy"
        @click="emit('answer', { behavior: 'deny' })"
      />
    </div>
  </div>
</template>
