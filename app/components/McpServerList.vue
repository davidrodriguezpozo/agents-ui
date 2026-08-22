<script setup lang="ts">
import type { McpServer, McpStatus } from '~/composables/useMcp'
import { errorMessage } from '~/utils/errors'

/**
 * The MCP servers this machine has, and whether they answer.
 *
 * This was a page of its own and is now a facet of the Library, so the list
 * lives in a component: the page frame around it (title, refresh, add) belongs
 * to whoever is showing it.
 *
 * The question it exists to answer is the one no file could: not "what have I
 * configured" but "which of these is actually answering" — which turns out to
 * be a different list. Loading is done here, on mount, because the answer costs
 * a `claude mcp list` per refresh and nobody should pay for it by visiting the
 * Library to look at a skill.
 */
const props = defineProps<{ search?: string }>()

/** The add-a-server modal, opened by a button in the host page's header. */
const adding = defineModel<boolean>('adding', { default: false })

const { sorted, cwd, loading, error, loaded, broken, load, remove, signIn } = useMcp()
const expanded = ref<string | null>(null)
const busy = ref<string | null>(null)
const toast = useToast()

onMounted(() => { if (!loaded.value) void load() })

/**
 * Signing in happens in a browser window, and takes as long as it takes. The
 * request is open throughout, so the button says what is going on rather than
 * spinning silently for two minutes and looking hung.
 */
async function onSignIn(server: McpServer) {
  busy.value = server.name
  toast.add({
    title: `Signing in to ${displayName(server)}`,
    description: 'A browser window is opening. Finish there and this will catch up.',
  })
  try {
    await signIn(server.name)
    toast.add({ title: `${displayName(server)} signed in`, color: 'success' })
  } catch (e) {
    toast.add({ title: 'Sign-in did not finish', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}

async function onRemove(server: McpServer) {
  busy.value = server.name
  try {
    await remove(server.name)
    toast.add({ title: `${displayName(server)} removed`, color: 'success' })
  } catch (e) {
    toast.add({ title: 'Could not remove it', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}

const LOOKS: Record<McpStatus, { label: string; icon: string; colour: string }> = {
  connected: { label: 'Working', icon: 'i-lucide-circle-check', colour: 'var(--success)' },
  'needs-auth': { label: 'Needs signing in', icon: 'i-lucide-log-in', colour: 'var(--warning)' },
  failed: { label: 'Not working', icon: 'i-lucide-circle-x', colour: 'var(--error)' },
  pending: { label: 'Waiting for approval', icon: 'i-lucide-pause-circle', colour: 'var(--text-secondary)' },
  unknown: { label: 'Unclear', icon: 'i-lucide-circle-help', colour: 'var(--text-secondary)' },
}

/** Where it came from, in words rather than in the prefix on its name. */
function provenance(server: McpServer): string {
  if (server.origin === 'plugin') return `from the ${server.pluginName} plugin`
  if (server.origin === 'claude.ai') return 'connected through claude.ai'
  return 'from this project'
}

/** `plugin:slack:slack` is the id; `slack` is what anyone calls it. */
function displayName(server: McpServer): string {
  if (server.origin === 'plugin') return server.name.replace(/^plugin:[^:]+:/, '')
  if (server.origin === 'claude.ai') return server.name.replace(/^claude\.ai /, '')
  return server.name
}

/**
 * The Library's one search box covers this list too, so typing "notion" while
 * the MCP facet is open narrows the servers rather than doing nothing.
 */
const visible = computed(() => {
  const q = (props.search ?? '').trim().toLowerCase()
  if (!q) return sorted.value
  return sorted.value.filter(server => [
    displayName(server), server.name, server.target, server.pluginName, server.origin,
  ].some(field => field?.toLowerCase().includes(q)))
})
</script>

<template>
  <div class="space-y-6">
    <p class="type-body max-w-2xl leading-relaxed">
      Tools your agents can reach that don't live on this machine — issue trackers, docs,
      mail. Each one is asked whether it is answering, so this says which of them
      <em>work</em>, not just which are set up.
      <span v-if="cwd" class="type-meta block mt-1 font-mono">{{ cwd }}</span>
    </p>

    <div
      v-if="error"
      class="rounded-md px-4 py-3 type-detail"
      style="background: var(--error-wash); border: 1px solid var(--error); color: var(--error);"
    >
      {{ error }}
    </div>

    <div v-else-if="loading && !sorted.length" class="flex items-center gap-2 py-10 justify-center">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-meta" />
      <span class="type-meta">Asking each server whether it answers…</span>
    </div>

    <div v-else-if="!sorted.length" class="surface-card">
      <EmptyState
        variant="inset"
        icon="i-lucide-unplug"
        title="No MCP servers"
        description="Nothing is connected yet. Add one with `claude mcp add`, or install a plugin that brings its own — they show up here either way."
      />
    </div>

    <EmptyState
      v-else-if="!visible.length"
      icon="i-lucide-search-x"
      title="No server matches that"
      description="This looks through server names, their addresses and the plugin that brought them."
    />

    <template v-else>
      <p v-if="broken" class="type-detail ink-warn">
        {{ broken }} of {{ sorted.length }} {{ broken === 1 ? 'needs' : 'need' }} attention.
      </p>

      <div class="space-y-2">
        <div
          v-for="server in visible"
          :key="server.name"
          class="rounded-lg px-4 py-3 bg-card"
        >
          <div class="flex items-start gap-3">
            <UIcon
              :name="LOOKS[server.status].icon"
              class="size-4 shrink-0 mt-0.5"
              :style="{ color: LOOKS[server.status].colour }"
            />

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="type-strong">{{ displayName(server) }}</span>
                <span
                  class="fs-micro px-1.5 py-px rounded-full"
                  style="background: var(--badge-subtle-bg); color: var(--text-secondary);"
                >
                  {{ provenance(server) }}
                </span>
                <span v-if="server.transport" class="type-mono-meta">{{ server.transport }}</span>
              </div>

              <div class="font-mono fs-mono truncate mt-0.5 text-meta" :title="server.target">
                {{ server.target }}
              </div>

              <!--
                Only for the ones that are not working: next to a tick, the
                word "Connected" is the same thing said twice.
              -->
              <div v-if="server.detail" class="mt-1">
                <button
                  class="type-detail underline hover:opacity-80"
                  :style="{ color: LOOKS[server.status].colour }"
                  @click="expanded = expanded === server.name ? null : server.name"
                >
                  {{ LOOKS[server.status].label }}{{ expanded === server.name ? '' : ' — why?' }}
                </button>
                <pre
                  v-if="expanded === server.name"
                  class="font-mono fs-micro leading-relaxed whitespace-pre-wrap mt-1.5 p-2.5 rounded max-h-56 overflow-y-auto"
                  style="background: var(--surface-inset); color: var(--text-secondary);"
                >{{ server.detail }}</pre>
              </div>
              <div v-else class="type-detail mt-0.5" :style="{ color: LOOKS[server.status].colour }">
                {{ LOOKS[server.status].label }}
              </div>
            </div>

            <div class="flex items-center gap-1 shrink-0">
              <!--
                The fix for the commonest state there is. It opens a browser
                window and takes as long as the person does, so the label
                says what is happening rather than spinning silently.
              -->
              <UButton
                v-if="server.status === 'needs-auth'"
                :label="busy === server.name ? 'Waiting for the browser…' : 'Sign in'"
                icon="i-lucide-log-in"
                size="xs"
                variant="soft"
                :loading="busy === server.name"
                :disabled="Boolean(busy)"
                @click="onSignIn(server)"
              />
              <!--
                Only what this app put here. A plugin's server belongs to the
                plugin and a claude.ai connector to claude.ai — removing
                either from underneath its owner would be a lie about where
                the change had been made.
              -->
              <UButton
                v-if="server.origin === 'project'"
                icon="i-lucide-trash-2"
                size="xs"
                variant="ghost"
                color="error"
                :title="`Remove ${displayName(server)}`"
                :disabled="Boolean(busy)"
                @click="onRemove(server)"
              />
            </div>
          </div>
        </div>
      </div>

      <!--
        Where the ones this app cannot remove came from, said plainly rather
        than left to be worked out from a missing button.
      -->
      <p class="type-meta pt-1">
        Servers from a plugin or from claude.ai are managed where they came from —
        this can sign you in to them, but not delete them.
      </p>
    </template>

    <UModal :open="adding" @update:open="v => { adding = v }">
      <template #content>
        <McpAddModal @close="() => { adding = false }" />
      </template>
    </UModal>
  </div>
</template>
