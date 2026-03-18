<script setup lang="ts">
import { getAgentColor, modelColors } from "~/utils/colors";

const { claudeDir, set: setDir } = useClaudeDir();
const { agents, fetchAll: fetchAgents } = useAgents();
const { commands, fetchAll: fetchCommands } = useCommands();
const { plugins, fetchAll: fetchPlugins } = usePlugins();
const { skills, fetchAll: fetchSkills } = useSkills();
const { settings, load: loadSettings } = useSettings();

const dirInput = ref("");
const settingDir = ref(false);

interface Suggestion {
  type: string;
  severity: "warning" | "info";
  message: string;
  target: { type: "agent" | "command" | "skill"; slug: string };
}
const suggestions = ref<Suggestion[]>([]);

// Animated counters
const animatedCounts = reactive({
  agents: 0,
  commands: 0,
  skills: 0,
  plugins: 0,
});

function animateCounter(target: number, key: keyof typeof animatedCounts) {
  if (target === 0) {
    animatedCounts[key] = 0;
    return;
  }
  const duration = 600;
  const startTime = performance.now();
  function tick(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    animatedCounts[key] = Math.round(eased * target);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

onMounted(async () => {
  dirInput.value = claudeDir.value || "";
  await Promise.all([loadSettings(), fetchPlugins(), fetchSkills()]);

  // Animate counters after data loads
  nextTick(() => {
    animateCounter(agents.value.length, "agents");
    animateCounter(commands.value.length, "commands");
    animateCounter(skills.value.length, "skills");
    animateCounter(plugins.value.length, "plugins");
  });

  // Watch for data changes to re-animate
  watch(
    () => agents.value.length,
    (v) => animateCounter(v, "agents"),
  );
  watch(
    () => commands.value.length,
    (v) => animateCounter(v, "commands"),
  );
  watch(
    () => skills.value.length,
    (v) => animateCounter(v, "skills"),
  );
  watch(
    () => plugins.value.length,
    (v) => animateCounter(v, "plugins"),
  );

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

const modelLabels: Record<string, string> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  unset: "Default",
};

const modelBreakdown = computed(() => {
  const counts: Record<string, number> = {
    opus: 0,
    sonnet: 0,
    haiku: 0,
    unset: 0,
  };
  for (const a of agents.value) {
    const m = a.frontmatter.model;
    if (m && counts[m] !== undefined) counts[m]++;
    else counts.unset++;
  }
  return counts;
});

const totalAgents = computed(() => agents.value.length);
const modelPercentages = computed(() => {
  if (!totalAgents.value) return {};
  const result: Record<string, number> = {};
  for (const [model, count] of Object.entries(modelBreakdown.value)) {
    if (count > 0) result[model] = (count / totalAgents.value) * 100;
  }
  return result;
});

const modelBarColors: Record<string, string> = {
  opus: "#7C3AED",
  sonnet: "#2563EB",
  haiku: "#D97706",
  unset: "#71717a",
};

const hasContent = computed(
  () =>
    agents.value.length > 0 ||
    commands.value.length > 0 ||
    skills.value.length > 0 ||
    plugins.value.length > 0,
);

const statItems = computed(() => [
  {
    key: "agents" as const,
    to: "/agents",
    count: animatedCounts.agents,
    label: "Agents",
    icon: "i-lucide-cpu",
  },
  {
    key: "commands" as const,
    to: "/commands",
    count: animatedCounts.commands,
    label: "Commands",
    icon: "i-lucide-terminal",
  },
  {
    key: "skills" as const,
    to: "/skills",
    count: animatedCounts.skills,
    label: "Skills",
    icon: "i-lucide-sparkles",
  },
  {
    key: "plugins" as const,
    to: "/plugins",
    count: animatedCounts.plugins,
    label: "Plugins",
    icon: "i-lucide-puzzle",
  },
]);
</script>

<template>
  <div>
    <PageHeader title="Dashboard" />

    <div class="px-6 py-5 stagger-section space-y-5">
      <!-- Hero stat bar -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NuxtLink
          v-for="item in statItems"
          :key="item.to"
          :to="item.to"
          class="relative rounded-xl p-5 focus-ring hover-stat overflow-hidden group bg-card"
        >
          <!-- Subtle accent gradient on hover -->
          <div
            class="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
            style="
              background: radial-gradient(
                ellipse at top left,
                var(--accent-muted) 0%,
                transparent 60%
              );
            "
          />
          <div class="relative">
            <div class="flex items-center gap-2 mb-3">
              <UIcon
                :name="item.icon"
                class="size-4 text-meta group-hover:text-[var(--accent)] transition-colors duration-200"
              />
              <span class="text-[12px] font-medium text-label">{{
                item.label
              }}</span>
            </div>
            <span class="stat-number counter-animate">{{ item.count }}</span>
          </div>
        </NuxtLink>
      </div>

      <!-- Model breakdown (visual bar) -->
      <div
        v-if="agents.length > 0"
        class="rounded-xl px-5 py-4 bg-card"
      >
        <div class="flex items-center justify-between mb-3">
          <span class="text-section-title">Model Distribution</span>
          <span class="text-[11px] text-meta font-mono"
            >{{ totalAgents }} agent{{ totalAgents === 1 ? "" : "s" }}</span
          >
        </div>

        <!-- Proportional bar -->
        <div class="proportion-bar mb-3">
          <div
            v-for="(pct, model) in modelPercentages"
            :key="model"
            class="proportion-bar__segment"
            :style="{
              flexGrow: pct,
              background: modelBarColors[model] || '#71717a',
            }"
          />
        </div>

        <!-- Legend -->
        <div class="flex items-center gap-5">
          <div
            v-for="(count, model) in modelBreakdown"
            :key="model"
            class="flex items-center gap-2"
          >
            <div
              class="size-2 rounded-full"
              :style="{ background: modelBarColors[model] || '#71717a' }"
            />
            <span
              class="text-[11px] font-medium"
              style="color: var(--text-secondary)"
              >{{ modelLabels[model] }}</span
            >
            <span class="font-mono text-[11px] tabular-nums text-meta">{{
              count
            }}</span>
          </div>
        </div>
      </div>

      <!-- Bento grid: Agents + Commands + Quick Actions -->
      <div
        v-if="hasContent"
        class="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <!-- Agents list (takes 2 cols) -->
        <div
          class="md:col-span-2 rounded-xl overflow-hidden"
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
                name="i-lucide-cpu"
                class="size-4"
                style="color: var(--accent)"
              />
              Agents
            </h3>
            <NuxtLink
              to="/agents"
              class="text-[12px] focus-ring rounded px-1.5 py-0.5 hover-bg transition-colors"
              style="color: var(--accent)"
              >View all</NuxtLink
            >
          </div>
          <div
            class="divide-y"
            style="divide-color: var(--border-subtle)"
          >
            <NuxtLink
              v-for="agent in agents.slice(0, 6)"
              :key="agent.slug"
              :to="`/agents/${agent.slug}`"
              class="flex items-center gap-3 px-4 py-3 hover-bg group"
            >
              <div
                class="size-8 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105"
                :style="{
                  background: getAgentColor(agent.frontmatter.color) + '18',
                  border:
                    '1px solid ' +
                    getAgentColor(agent.frontmatter.color) +
                    '25',
                }"
              >
                <UIcon
                  name="i-lucide-cpu"
                  class="size-3.5"
                  :style="{ color: getAgentColor(agent.frontmatter.color) }"
                />
              </div>
              <div class="flex-1 min-w-0">
                <span class="text-[13px] font-medium truncate block">
                  {{ agent.frontmatter.name }}
                </span>
                <span
                  v-if="agent.frontmatter.description"
                  class="text-[11px] text-label truncate block"
                >
                  {{ agent.frontmatter.description }}
                </span>
              </div>
              <span
                v-if="
                  agent.frontmatter.model &&
                  modelColors[agent.frontmatter.model]
                "
                class="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-full shrink-0"
                :class="[
                  modelColors[agent.frontmatter.model].bg,
                  modelColors[agent.frontmatter.model].text,
                ]"
              >
                {{ agent.frontmatter.model }}
              </span>
            </NuxtLink>
          </div>
        </div>

        <!-- Right column: Commands + Quick Actions stacked -->
        <div class="space-y-4">
          <!-- Commands -->
          <div
            class="rounded-xl overflow-hidden"
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
                  name="i-lucide-terminal"
                  class="size-4"
                  style="color: var(--accent)"
                />
                Commands
              </h3>
              <NuxtLink
                to="/commands"
                class="text-[12px] focus-ring rounded px-1.5 py-0.5 hover-bg transition-colors"
                style="color: var(--accent)"
                >View all</NuxtLink
              >
            </div>
            <div
              class="divide-y"
              style="divide-color: var(--border-subtle)"
            >
              <NuxtLink
                v-for="cmd in commands.slice(0, 4)"
                :key="cmd.slug"
                :to="`/commands/${cmd.slug}`"
                class="flex items-center gap-2.5 px-4 py-2.5 hover-bg"
              >
                <span
                  class="font-mono text-[11px] shrink-0"
                  style="color: var(--accent)"
                  >/</span
                >
                <span class="text-[12px] truncate text-body flex-1">
                  {{ cmd.frontmatter.name }}
                </span>
                <span class="text-[10px] shrink-0 text-meta font-mono">
                  {{ cmd.directory }}
                </span>
              </NuxtLink>
            </div>
          </div>

          <!-- Quick Actions -->
          <div class="space-y-2">
            <NuxtLink
              to="/graph"
              class="block rounded-xl p-4 focus-ring hover-card bg-card group"
            >
              <div class="flex items-center gap-3">
                <div
                  class="size-8 rounded-lg flex items-center justify-center shrink-0"
                  style="
                    background: var(--accent-muted);
                    border: 1px solid rgba(229, 169, 62, 0.12);
                  "
                >
                  <UIcon
                    name="i-lucide-workflow"
                    class="size-4"
                    style="color: var(--accent)"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-[13px] font-medium">Relationship Graph</div>
                  <div class="text-[11px] text-label">
                    Visualize connections
                  </div>
                </div>
                <UIcon
                  name="i-lucide-arrow-right"
                  class="size-4 text-meta opacity-0 group-hover:opacity-100 transition-all duration-200 group-hover:translate-x-0.5"
                />
              </div>
            </NuxtLink>

            <NuxtLink
              to="/workflows"
              class="block rounded-xl p-4 focus-ring hover-card bg-card group"
            >
              <div class="flex items-center gap-3">
                <div
                  class="size-8 rounded-lg flex items-center justify-center shrink-0"
                  style="
                    background: var(--accent-secondary-muted);
                    border: 1px solid rgba(99, 102, 241, 0.12);
                  "
                >
                  <UIcon
                    name="i-lucide-git-branch"
                    class="size-4"
                    style="color: var(--accent-secondary)"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-[13px] font-medium">Create Workflow</div>
                  <div class="text-[11px] text-label">Multi-step pipelines</div>
                </div>
                <UIcon
                  name="i-lucide-arrow-right"
                  class="size-4 text-meta opacity-0 group-hover:opacity-100 transition-all duration-200 group-hover:translate-x-0.5"
                />
              </div>
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- Welcome onboarding (first-run) -->
      <WelcomeOnboarding
        v-if="!hasContent"
        @created="(agent) => navigateTo(`/agents/${agent.slug}`)"
      />

      <!-- Suggestions -->
      <div
        v-if="suggestions.length && hasContent"
        class="rounded-xl overflow-hidden"
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
          <span class="font-mono text-[10px] text-meta">{{
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
            <span class="text-[12px] text-label flex-1">{{ s.message }}</span>
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
          class="text-[12px] flex items-center gap-1.5 text-meta cursor-pointer"
        >
          <UIcon
            name="i-lucide-settings"
            class="size-3"
          />
          Advanced: Configuration folder
        </summary>
        <div class="rounded-xl p-4 mt-2 bg-card">
          <p class="text-[12px] mb-3 text-label">
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
        <span class="text-[12px] flex items-center gap-1.5">
          <kbd class="text-[10px] font-mono px-1 py-px rounded badge-subtle"
            >&#x2318;K</kbd
          >
          Search
        </span>
        <span class="text-[12px] flex items-center gap-1.5">
          <kbd class="text-[10px] font-mono px-1 py-px rounded badge-subtle"
            >&#x2318;S</kbd
          >
          Save
        </span>
      </div>
    </div>
  </div>
</template>
