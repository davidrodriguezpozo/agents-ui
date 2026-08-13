<script setup lang="ts">
const { claudeDir, set: setDir } = useClaudeDir();
const { agents, fetchAll: fetchAgents } = useAgents();
const { commands, fetchAll: fetchCommands } = useCommands();
const { plugins, fetchAll: fetchPlugins } = usePlugins();
const { skills, fetchAll: fetchSkills } = useSkills();
const { imports: githubImports, fetchImports } = useGithubImports();
const { settings, load: loadSettings } = useSettings();
const { isSimple } = useUiMode();
const { fetchAll: fetchSessions } = useSessions();

const dirInput = ref("");
const settingDir = ref(false);

interface Suggestion {
  type: string;
  severity: "warning" | "info";
  message: string;
  target: { type: "agent" | "command" | "skill"; slug: string };
}
const suggestions = ref<Suggestion[]>([]);

onMounted(async () => {
  dirInput.value = claudeDir.value || "";
  await Promise.all([
    loadSettings(),
    fetchPlugins(),
    fetchSkills(),
    fetchImports(),
    // The Running and Settled bands read the shared session list, and app.vue
    // fetches everything *except* sessions on boot — so arriving here directly
    // would have shown neither band until you had been to /sessions first.
    fetchSessions(),
  ]);

  try {
    suggestions.value = await $fetch<Suggestion[]>("/api/suggestions");
  } catch {
    // Non-critical
  }
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
</script>

<template>
  <!-- Simple mode gets a task-first landing page instead of the config dashboard -->
  <SimpleHome v-if="isSimple" />

  <div v-else>
    <PageHeader title="Now" />

    <div class="page-container py-6 stagger-section space-y-7">
      <!--
        Three bands, in the order the questions get asked: what needs me, what
        is still going, what went through without me.

        This was a dashboard — four counters, a model-distribution bar, and
        partial lists of agents and commands duplicating their own pages. None of
        it answered a question anybody arrives with. Worse, the one question
        everybody arrives with had no home at all: blocked sessions lived on
        /sessions, reviews on /pulls, broken rituals on /schedules, the morning
        report here. The four red counters in the sidebar were the app admitting
        it, and a badge that stands in for a missing view is a missing view.
      -->
      <NowQueue v-if="hasContent" />

      <NowRunning v-if="hasContent" />

      <NowSettled v-if="hasContent" />

      <!--
        And then the same night as a picture. The bands above answer "what do I
        do" in sentences; this answers "when" — which hours the machine was
        working, what overlapped what, and whether the money arrived in one lump
        or spread across the night.
      -->
      <NightShift v-if="hasContent" />

      <!-- Welcome onboarding (first-run) -->
      <WelcomeOnboarding
        v-if="!hasContent"
        @created="(agent) => navigateTo(`/agents/${agent.slug}`)"
      />

      <!-- Suggestions -->
      <div
        v-if="suggestions.length && hasContent"
        class="rounded-lg overflow-hidden"
        style="border: 1px solid var(--border-subtle)"
      >
        <div
          class="flex items-center justify-between px-4 py-3"
          style="
            background: var(--surface-raised);
            border-bottom: 1px solid var(--border-subtle);
          "
        >
          <h3 class="text-section-title flex items-center gap-2">
            <UIcon
              name="i-lucide-lightbulb"
              class="size-4"
              style="color: var(--accent)"
            />
            Suggestions
          </h3>
          <span class="type-mono-meta">{{
            suggestions.length
          }}</span>
        </div>
        <div
          class="divide-y"
          style="divide-color: var(--border-subtle)"
        >
          <NuxtLink
            v-for="(s, idx) in suggestions.slice(0, 5)"
            :key="idx"
            :to="`/${s.target.type}s/${s.target.slug}`"
            class="flex items-center gap-3 px-4 py-3 hover-bg group"
          >
            <UIcon
              :name="
                s.severity === 'warning'
                  ? 'i-lucide-alert-triangle'
                  : 'i-lucide-info'
              "
              class="size-4 shrink-0"
              :style="{
                color:
                  s.severity === 'warning'
                    ? 'var(--warning, #eab308)'
                    : 'var(--text-disabled)',
              }"
            />
            <span class="type-detail flex-1">{{ s.message }}</span>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-3.5 text-meta opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </NuxtLink>
        </div>
      </div>

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
