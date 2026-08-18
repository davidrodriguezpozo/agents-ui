<script setup lang="ts">
const { claudeDir, set: setDir } = useClaudeDir();
const { agents, fetchAll: fetchAgents } = useAgents();
const { commands, fetchAll: fetchCommands } = useCommands();
const { plugins, fetchAll: fetchPlugins } = usePlugins();
const { skills, fetchAll: fetchSkills } = useSkills();
const { fetchImports } = useGithubImports();
const { settings, load: loadSettings } = useSettings();
const { sessions } = useSessions();
const { digest } = useDigest();
const { isSimple } = useUiMode();

const dirInput = ref("");
const settingDir = ref(false);

onMounted(async () => {
  dirInput.value = claudeDir.value || "";
  // Sessions are not fetched here: app.vue loads them before any page renders
  // and reloads them on a project switch, which is what keeps the running count
  // honest about which project it is describing.
  await Promise.all([loadSettings(), fetchPlugins(), fetchSkills(), fetchImports()]);
});

async function changeDir() {
  settingDir.value = true;
  try {
    await setDir(dirInput.value);
    await Promise.all([
      fetchAgents(),
      fetchCommands(),
      fetchPlugins(),
      fetchSkills(),
      loadSettings(),
    ]);
  } finally {
    settingDir.value = false;
  }
}

const hasContent = computed(
  () =>
    agents.value.length > 0 ||
    commands.value.length > 0 ||
    skills.value.length > 0 ||
    plugins.value.length > 0,
);

/**
 * The one line that used to be three bands.
 *
 * Running, landed and what it cost were `NowRunning`, `NowSettled` and the spend
 * figure inside `NightShift` — three sections, each with a heading and a list, on
 * a page whose question is "what needs me". None of them is an answer to that
 * question: they are the reassurance that the *rest* is fine, and reassurance is
 * a sentence, not a section. Each half links to the page that owns it in full.
 */
const running = computed(() => sessions.value.filter(s => s.activity === 'working').length);
const landed = computed(() => sessions.value.filter(s => s.landed).length);

const money = computed(() => {
  const total = digest.value?.costUsd ?? 0;
  if (!total) return null;
  return total < 0.01 ? '<$0.01' : `$${total.toFixed(2)}`;
});

const otherwise = computed(() => Boolean(running.value || landed.value || money.value));
</script>

<template>
  <!-- Simple mode gets a task-first landing page instead of the config dashboard -->
  <SimpleHome v-if="isSimple" />

  <div v-else>
    <PageHeader title="Now" />

    <div class="page-container py-6 stagger-section space-y-7">
      <!--
        One band, and it is meant to empty.
        
        This was a dashboard — four counters, a model-distribution bar, and
        partial lists of agents and commands duplicating their own pages. Then it
        was five bands: the queue, what was running, what had settled, the night
        as a chart, and the standing brief. Which is a better dashboard, and still
        a dashboard — four of the five described work that was going fine, on the
        one page in the app whose entire job is work that is not.
        
        So: what needs you, ranked, resolvable here. Everything else moved to the
        page that owns it — running work and the night chart to /work, landing to
        /land, the standing brief to /settings — and what is left of them is the
        line underneath, which is a reassurance rather than a section.
        
        The suggestions panel went too. "Skill X is not linked to any agent" is a
        true observation about your configuration and never once the reason
        somebody opened this page; it sat under the queue being read past. Config
        advice belongs where the config is, not in the morning's to-do list.
        
        An empty Now is the product working. It should look like it.
      -->
      <NowQueue v-if="hasContent" />

      <!-- What is fine, in one line, since none of it needs you -->
      <div
        v-if="hasContent && otherwise"
        class="flex items-center gap-x-4 gap-y-1 flex-wrap type-detail"
      >
        <NuxtLink
          v-if="running"
          to="/work"
          class="flex items-center gap-1.5 hover:underline underline-offset-2"
        >
          <UIcon name="i-lucide-loader-2" class="size-3.5 shrink-0 animate-spin ink-accent" />
          {{ running }} running
        </NuxtLink>
        <NuxtLink
          v-if="landed"
          to="/land"
          class="flex items-center gap-1.5 hover:underline underline-offset-2"
        >
          <UIcon name="i-lucide-git-merge" class="size-3.5 shrink-0" style="color: var(--success);" />
          {{ landed }} landed
        </NuxtLink>
        <NuxtLink
          v-if="money"
          to="/work"
          class="flex items-center gap-1.5 hover:underline underline-offset-2 text-meta"
        >
          <UIcon name="i-lucide-receipt" class="size-3.5 shrink-0" />
          {{ money }} today
        </NuxtLink>
      </div>

      <!-- Welcome onboarding (first-run) -->
      <WelcomeOnboarding
        v-if="!hasContent"
        @created="(agent) => navigateTo(`/agents/${agent.slug}`)"
      />

      <!-- Advanced: directory picker -->
      <details>
        <summary
          class="fs-sm flex items-center gap-1.5 text-meta cursor-pointer"
        >
          <UIcon
            name="i-lucide-settings"
            class="size-3"
          />
          Advanced: Configuration folder
        </summary>
        <div class="rounded-lg p-4 mt-2 bg-card">
          <p class="fs-sm mb-3 text-label">
            This is where Claude Code stores your agents, commands, and
            settings. The default is ~/.claude.
          </p>
          <div class="flex items-center gap-3">
            <UIcon
              name="i-lucide-folder"
              class="size-4 shrink-0 text-meta"
            />
            <form
              class="flex-1 flex gap-2"
              @submit.prevent="changeDir"
            >
              <input
                v-model="dirInput"
                placeholder="~/.claude"
                class="field-input flex-1"
              />
              <UButton
                type="submit"
                :loading="settingDir"
                label="Load"
                size="sm"
                variant="soft"
              />
            </form>
          </div>
        </div>
      </details>

      <!-- Keyboard shortcuts -->
      <div class="flex items-center gap-4 px-2 text-meta">
        <span class="fs-sm flex items-center gap-1.5">
          <kbd class="fs-micro font-mono px-1 py-px rounded badge-subtle"
            >&#x2318;K</kbd
          >
          Search
        </span>
        <span class="fs-sm flex items-center gap-1.5">
          <kbd class="fs-micro font-mono px-1 py-px rounded badge-subtle"
            >&#x2318;S</kbd
          >
          Save
        </span>
      </div>
    </div>
  </div>
</template>
