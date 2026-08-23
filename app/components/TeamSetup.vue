<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
/**
 * First run for someone joining a team: point the app at the team's marketplace
 * repo, install the plugins that apply to them, and get out of the way.
 */
const emit = defineEmits<{ done: [] }>()

const toast = useToast()
const {
  sources,
  allPlugins,
  availablePlugins,
  fetchSources,
  fetchAvailable,
  addSource,
  installPlugin,
} = useMarketplace()
const { fetchAll: fetchPlugins } = usePlugins()

const url = ref('')
const adding = ref(false)
const installing = ref<string | null>(null)
const health = ref<{ git: boolean; claudeCli: boolean } | null>(null)

onMounted(async () => {
  health.value = await $fetch<{ git: boolean; claudeCli: boolean }>('/api/system/health').catch(() => null)
  await Promise.all([fetchSources(), fetchAvailable()])
})

const hasSource = computed(() => sources.value.length > 0)
const uninstalled = availablePlugins
const installedCount = computed(() => allPlugins.value.filter(p => p.installed).length)

async function onAdd() {
  const value = url.value.trim()
  if (!value) return

  adding.value = true
  try {
    await addSource(value)
    await Promise.all([fetchSources(), fetchAvailable()])
    url.value = ''
    toast.add({ title: 'Team tools connected', color: 'success' })
  } catch (e: any) {
    toast.add({
      title: 'Could not connect',
      description: errorMessage(e),
      color: 'error',
    })
  } finally {
    adding.value = false
  }
}

async function onInstall(marketplace: string, plugin: string) {
  installing.value = plugin
  try {
    await installPlugin(marketplace, plugin)
    await Promise.all([fetchAvailable(), fetchPlugins()])
    toast.add({ title: `${plugin} installed`, color: 'success' })
  } catch (e: any) {
    toast.add({
      title: 'Install failed',
      description: errorMessage(e),
      color: 'error',
    })
  } finally {
    installing.value = null
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6 py-4">
    <div class="text-center space-y-2">
      <div class="flex justify-center">
        <div
          class="size-14 rounded-xl flex items-center justify-center"
          style="background: linear-gradient(135deg, var(--accent-muted) 0%, var(--accent-muted) 100%); border: 1px solid var(--accent-muted);"
        >
          <UIcon name="i-lucide-users" class="size-6 ink-accent" />
        </div>
      </div>
      <h2 class="text-page-title" style="font-family: var(--font-display);">
        Get your team's tools
      </h2>
      <p class="type-body max-w-md mx-auto leading-relaxed">
        Your team keeps its Claude tools in a shared repository. Connect it once and
        everything your team has built shows up here.
      </p>
    </div>

    <!-- Blockers worth naming before someone hits them -->
    <div
      v-if="health && !health.git"
      class="rounded-lg px-4 py-3 flex items-start gap-3"
      style="background: var(--error-wash); border: 1px solid var(--error-tint);"
    >
      <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0 mt-0.5 ink-error" />
      <span class="fs-sm text-body">
        Git isn't installed on this computer, so team tools can't be downloaded.
        Ask IT to install it, or get it from <strong>git-scm.com</strong>.
      </span>
    </div>

    <!-- Step 1 -->
    <div class="rounded-lg p-5 space-y-3 bg-card">
      <div class="flex items-center gap-2">
        <span
          class="size-5 rounded-full flex items-center justify-center fs-micro font-mono shrink-0"
          :style="hasSource
            ? 'background: var(--success-tint); color: var(--success);'
            : 'background: var(--accent-muted); color: var(--accent);'"
        >
          {{ hasSource ? '✓' : '1' }}
        </span>
        <h3 class="text-section-label">Connect your team's repository</h3>
      </div>

      <div v-if="!hasSource" class="space-y-2">
        <div class="flex gap-2">
          <input
            v-model="url"
            class="field-input flex-1"
            placeholder="your-org/your-tools-repo"
            :disabled="adding || (health ? !health.git : false)"
            @keydown.enter="onAdd"
          />
          <UButton
            label="Connect"
            size="sm"
            :loading="adding"
            :disabled="!url.trim() || (health ? !health.git : false)"
            @click="onAdd"
          />
        </div>
        <p class="field-hint">
          Paste what your team lead gave you — usually something like
          <code>acme/claude-tools</code> or a full repository link.
        </p>
      </div>

      <div v-else class="space-y-1.5">
        <div
          v-for="source in sources"
          :key="source.name"
          class="flex items-center gap-2 fs-sm"
        >
          <UIcon name="i-lucide-check-circle-2" class="size-3.5 shrink-0 ink-ok" />
          <span class="font-medium text-body">{{ source.name }}</span>
          <span class="font-mono fs-micro truncate text-meta">{{ source.sourceUrl }}</span>
        </div>
      </div>
    </div>

    <!-- Step 2 -->
    <div v-if="hasSource" class="rounded-lg p-5 space-y-3 bg-card">
      <div class="flex items-center gap-2">
        <span
          class="size-5 rounded-full flex items-center justify-center fs-micro font-mono shrink-0"
          :style="installedCount
            ? 'background: var(--success-tint); color: var(--success);'
            : 'background: var(--accent-muted); color: var(--accent);'"
        >
          {{ installedCount ? '✓' : '2' }}
        </span>
        <h3 class="text-section-label">Add what you need</h3>
      </div>

      <p v-if="!uninstalled.length && !installedCount" class="type-detail">
        That repository doesn't offer any plugins yet.
      </p>

      <div v-else class="space-y-2">
        <div
          v-for="plugin in uninstalled"
          :key="`${plugin.marketplace}/${plugin.name}`"
          class="flex items-center gap-3 px-3 py-2.5 rounded-md"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
        >
          <UIcon name="i-lucide-puzzle" class="size-4 shrink-0 ink-accent" />
          <div class="flex-1 min-w-0">
            <div class="fs-sm font-medium truncate text-body">{{ plugin.name }}</div>
            <div class="fs-mono truncate text-label">{{ plugin.description || 'No description' }}</div>
            <div class="flex items-center gap-2 mt-0.5 type-mono-meta">
              <span v-if="plugin.skillCount">{{ plugin.skillCount }} skills</span>
              <span v-if="plugin.commandCount">{{ plugin.commandCount }} commands</span>
              <span v-if="plugin.agentCount">{{ plugin.agentCount }} agents</span>
            </div>
          </div>
          <UButton
            label="Add"
            size="xs"
            :loading="installing === plugin.name"
            @click="onInstall(plugin.marketplace, plugin.name)"
          />
        </div>

        <p v-if="installedCount" class="type-meta pt-1">
          {{ installedCount }} already added.
        </p>
      </div>
    </div>

    <!-- Step 3 -->
    <div v-if="installedCount" class="text-center space-y-3 pt-1">
      <p class="type-body">
        You're set up. Everything your team installed is ready to use.
      </p>
      <!--
        Tools are the first half of joining and the easy half. The second is a
        checkout, the rituals the repository already runs, and a spend cap of your
        own — and knowing which of those is yours. That path is `/join`.
      -->
      <UButton label="Join the team's repository" icon="i-lucide-arrow-right" size="sm" to="/join" />
      <p class="type-detail">
        <button class="hover:underline ink-accent" @click="emit('done')">Or just look around first</button>
      </p>
    </div>

    <!--
      Not everyone arriving here has a team repository to paste. Someone who
      installed this to run Claude against their own code would otherwise be
      stuck on a form they have no answer for.
    -->
    <div class="pt-2 text-center" style="border-top: 1px solid var(--border-subtle);">
      <p class="type-detail pt-4">
        Here to run Claude on your own code instead?
        <NuxtLink to="/work" class="font-medium hover:underline ink-accent">
          Start a session
        </NuxtLink>
        — it gets its own branch and checkout, and nothing here needs setting up first.
      </p>
    </div>
  </div>
</template>
