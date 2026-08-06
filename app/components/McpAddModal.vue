<script setup lang="ts">
import { errorMessage } from '~/utils/errors'

/**
 * Add an MCP server.
 *
 * Two shapes behind one form: a URL for the hosted ones, a command for the
 * ones that run here. Which fields you get follows from the transport rather
 * than being a longer form with half of it greyed out.
 */
const emit = defineEmits<{ added: []; close: [] }>()

const { add } = useMcp()
const { workingDir } = useWorkingDir()
const toast = useToast()

const name = ref('')
const transport = ref<'stdio' | 'http' | 'sse'>('http')
const scope = ref<'local' | 'user' | 'project'>('local')
const target = ref('')
const argsText = ref('')
const pairsText = ref('')
const saving = ref(false)

const isStdio = computed(() => transport.value === 'stdio')

/**
 * Claude Code's own words for these are "private to you in this project",
 * "across all projects" and the shared `.mcp.json`. Worth matching, because
 * two of the three are about *this project* and calling one of them "this
 * machine" sends people to the wrong one.
 */
const SCOPES = [
  { value: 'local', label: 'Just me, here', hint: 'This project only, private to you. Not committed. The default.' },
  { value: 'user', label: 'Just me, everywhere', hint: 'Follows you into every project on this machine.' },
  { value: 'project', label: 'Everyone on this project', hint: 'Written into the repo — anyone who clones it gets it too.' },
] as const

/** Only `user` is answerable without knowing which project you mean. */
const needsProject = computed(() => scope.value !== 'user')

/**
 * One per line, `KEY=value` for stdio and `Header: value` for the rest.
 * Values are secrets and are never read back out, so this box starts empty
 * every time rather than pretending to show what is there.
 */
const pairs = computed(() => {
  const out: Record<string, string> = {}
  for (const line of pairsText.value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const at = isStdio.value ? trimmed.indexOf('=') : trimmed.indexOf(':')
    if (at <= 0) continue
    out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim()
  }
  return out
})

async function onSave() {
  saving.value = true
  try {
    await add({
      name: name.value,
      transport: transport.value,
      scope: scope.value,
      target: target.value,
      // One argument per line, so a path with a space in it survives.
      args: isStdio.value ? argsText.value.split('\n').map(a => a.trim()).filter(Boolean) : [],
      env: isStdio.value ? pairs.value : {},
      headers: isStdio.value ? {} : pairs.value,
    })
    toast.add({ title: `${name.value} added`, color: 'success' })
    emit('added')
    emit('close')
  } catch (e) {
    toast.add({ title: 'Could not add it', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="p-6 space-y-5 bg-overlay">
    <div class="flex items-center gap-2">
      <UIcon name="i-lucide-plug" class="size-4" style="color: var(--accent);" />
      <h3 class="text-page-title">Add an MCP server</h3>
    </div>

    <div class="field-group">
      <label class="field-label">Name</label>
      <input v-model="name" class="field-input font-mono text-[12px]" placeholder="sentry" />
      <span class="field-hint">Letters, numbers, dots and dashes — no spaces.</span>
    </div>

    <div class="field-group">
      <label class="field-label">How it connects</label>
      <div class="flex gap-1">
        <button
          v-for="option in (['http', 'sse', 'stdio'] as const)"
          :key="option"
          class="flex-1 px-2 py-1.5 rounded-md text-[12px] font-medium transition-all"
          :style="{
            background: transport === option ? 'var(--accent-muted)' : 'var(--surface-raised)',
            color: transport === option ? 'var(--accent)' : 'var(--text-secondary)',
          }"
          @click="transport = option"
        >
          {{ option === 'stdio' ? 'Runs here' : option.toUpperCase() }}
        </button>
      </div>
    </div>

    <div class="field-group">
      <label class="field-label">{{ isStdio ? 'Command' : 'URL' }}</label>
      <input
        v-model="target"
        class="field-input font-mono text-[12px]"
        :placeholder="isStdio ? 'npx' : 'https://mcp.sentry.dev/mcp'"
      />
    </div>

    <div v-if="isStdio" class="field-group">
      <label class="field-label">Arguments</label>
      <textarea v-model="argsText" rows="3" class="field-textarea font-mono text-[12px]" placeholder="-y&#10;@sentry/mcp-server" />
      <span class="field-hint">One per line, so a path with a space in it stays in one piece.</span>
    </div>

    <div class="field-group">
      <label class="field-label">{{ isStdio ? 'Environment variables' : 'Headers' }}</label>
      <textarea
        v-model="pairsText"
        rows="2"
        class="field-textarea font-mono text-[12px]"
        :placeholder="isStdio ? 'API_KEY=…' : 'Authorization: Bearer …'"
      />
      <span class="field-hint">
        One per line. These are secrets: they go straight to Claude Code and are never shown back.
      </span>
    </div>

    <div class="field-group">
      <label class="field-label">Where to save it</label>
      <div class="space-y-1.5">
        <label
          v-for="option in SCOPES"
          :key="option.value"
          class="flex items-start gap-2.5 rounded-md px-3 py-2 cursor-pointer"
          :style="scope === option.value
            ? 'background: var(--accent-muted); border: 1px solid var(--accent-muted);'
            : 'background: var(--surface-raised); border: 1px solid var(--border-subtle);'"
        >
          <input v-model="scope" type="radio" :value="option.value" class="mt-1" />
          <span>
            <span class="type-strong block">{{ option.label }}</span>
            <span class="type-detail">{{ option.hint }}</span>
          </span>
        </label>
      </div>
      <span v-if="needsProject && !workingDir" class="field-hint" style="color: var(--warning);">
        Pick a project first — both of these are saved against one.
      </span>
    </div>

    <div class="flex justify-end gap-2">
      <UButton label="Cancel" size="sm" variant="ghost" color="neutral" @click="emit('close')" />
      <UButton
        label="Add it"
        icon="i-lucide-check"
        size="sm"
        :loading="saving"
        :disabled="!name.trim() || !target.trim() || (needsProject && !workingDir)"
        @click="onSave"
      />
    </div>
  </div>
</template>
