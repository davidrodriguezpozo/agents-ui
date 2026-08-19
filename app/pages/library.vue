<script setup lang="ts">
import { getAgentColor, modelColors } from '~/utils/colors'
import { groupByOrigin, filterGroups } from '~/utils/entityGroups'
import {
  toCapabilities, facetCounts, searchableText,
  CAPABILITY_LOOK, type CapabilityType,
} from '~/utils/capabilities'

/**
 * Everything Claude can do, in one place.
 *
 * Agents, commands and skills had a page each, and the split was the system's
 * rather than yours: nobody arrives wondering whether the thing they need is an
 * agent or a skill. The facet is here for when you do care, and it is a filter
 * rather than three destinations to guess between.
 *
 * MCP servers are here too, as a facet after a divider — they were an eighth
 * nav item for the same question this page answers ("what can Claude reach"),
 * and one item in a sidebar is a worse home for them than one click in here.
 * They stay a facet rather than rows in `all` because they are not the same kind
 * of thing: a server is a live connection with a health state and a sign-in
 * button, not a file you wrote and can open.
 */
const { agents, loading: agentsLoading, error: agentsError } = useAgents()
const { commands, loading: commandsLoading, error: commandsError } = useCommands()
const { skills, loading: skillsLoading, error: skillsError } = useSkills()
const {
  servers: mcpServers, loaded: mcpLoaded, loading: mcpLoading, broken: mcpBroken, load: loadMcp,
} = useMcp()
const { isSimple } = useUiMode()
const router = useRouter()
const route = useRoute()

const loading = computed(() => agentsLoading.value || commandsLoading.value || skillsLoading.value)
const error = computed(() => agentsError.value || commandsError.value || skillsError.value)

/** `?type=` so the old /agents, /commands, /skills and /mcp links still land somewhere. */
const TYPES: CapabilityType[] = ['agent', 'command', 'skill']

/** The facet bar's keys: the capability types, everything, and the servers. */
type Facet = CapabilityType | 'all' | 'mcp'

function typeFromQuery(value: unknown): Facet {
  const raw = String(value ?? '')
  if (raw === 'mcp') return 'mcp'
  const singular = raw.replace(/s$/, '')
  return TYPES.includes(singular as CapabilityType) ? (singular as CapabilityType) : 'all'
}

const activeType = ref<Facet>(typeFromQuery(route.query.type))
const search = ref('')

/** True while the facet in view is one of the file-backed kinds. */
const showingCapabilities = computed(() => activeType.value !== 'mcp')

/**
 * MCP was an advanced-only nav item, and turning it into a facet should not
 * quietly promote it into simple mode — that mode leads with what you can do,
 * not with the plumbing. A `?type=mcp` link still works, so a bookmark from an
 * older build lands where it used to.
 */
const showMcpFacet = computed(() => !isSimple.value || activeType.value === 'mcp')

// Reflected in the URL, so a filtered view can be linked to and survives reload.
watch(activeType, (type) => {
  if (type === 'all') return router.replace({ query: {} })
  router.replace({ query: { type: type === 'mcp' ? 'mcp' : `${type}s` } })
})

const all = computed(() => toCapabilities(agents.value, commands.value, skills.value))
const counts = computed(() => facetCounts(all.value))

const facets = computed(() => [
  { key: 'all' as const, label: 'All', count: counts.value.all },
  ...TYPES
    .map(type => ({ key: type, label: CAPABILITY_LOOK[type].plural, count: counts.value[type] }))
    // A facet with nothing behind it is a dead end.
    .filter(facet => facet.count > 0),
])

/**
 * The MCP facet's count is only shown once the servers have been asked, because
 * asking means running `claude mcp list` — so it happens when you open the facet
 * rather than on every visit to the Library. Until then the facet is a label
 * with no number, which is honest; a `0` would not be.
 */
const mcpFacet = computed(() => ({
  count: mcpLoaded.value ? mcpServers.value.length : null,
  broken: mcpLoaded.value ? mcpBroken.value : 0,
}))

const groups = computed(() => filterGroups(
  groupByOrigin(all.value.filter(item => activeType.value === 'all' || item.type === activeType.value)),
  search.value,
  searchableText,
))

const matchCount = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))

/**
 * What the primary button makes. On `all` there is no single answer, so it
 * offers the three rather than picking one.
 */
const showAgentWizard = ref(false)
const showCommandForm = ref(false)
const showSkillWizard = ref(false)
const showImport = ref(false)

const createMenu = computed(() => [[
  { label: 'New agent', icon: CAPABILITY_LOOK.agent.icon, onSelect: () => { showAgentWizard.value = true } },
  { label: 'New command', icon: CAPABILITY_LOOK.command.icon, onSelect: () => { showCommandForm.value = true } },
  { label: 'New skill', icon: CAPABILITY_LOOK.skill.icon, onSelect: () => { showSkillWizard.value = true } },
]])

function openCreate(type: CapabilityType) {
  if (type === 'agent') showAgentWizard.value = true
  else if (type === 'command') showCommandForm.value = true
  else showSkillWizard.value = true
}

function createActive() {
  if (activeType.value !== 'all' && activeType.value !== 'mcp') openCreate(activeType.value)
}

/** The MCP facet's own "New": a server is added through a different modal. */
const showMcpAdd = ref(false)

/** `?new=agent` so the command palette can open the right form from a keystroke. */
onMounted(() => {
  const requested = String(route.query.new ?? '')
  if (TYPES.includes(requested as CapabilityType)) {
    openCreate(requested as CapabilityType)
    router.replace({ query: { ...route.query, new: undefined } })
  }
})

/** Only agents and skills are files you can drop in. */
const canImport = computed(() => activeType.value === 'agent' || activeType.value === 'skill')
</script>

<template>
  <div>
    <PageHeader title="Library">
      <template #trailing>
        <span class="font-mono fs-sm text-meta">
          {{ activeType === 'mcp' ? (mcpFacet.count ?? '') : counts.all }}
        </span>
      </template>
      <template #right>
        <!-- The servers answer to a different pair of buttons than the files do. -->
        <template v-if="activeType === 'mcp'">
          <UButton
            label="Check again"
            icon="i-lucide-refresh-cw"
            size="sm"
            variant="soft"
            color="neutral"
            :loading="mcpLoading"
            @click="loadMcp(true)"
          />
          <UButton
            label="Add a server"
            icon="i-lucide-plus"
            size="sm"
            @click="() => { showMcpAdd = true }"
          />
        </template>
        <template v-else>
          <UButton
            v-if="canImport"
            label="Import"
            icon="i-lucide-upload"
            size="sm"
            variant="soft"
            @click="() => { showImport = true }"
          />
          <UButton
            v-if="activeType !== 'all'"
            :label="`New ${CAPABILITY_LOOK[activeType].label.toLowerCase()}`"
            icon="i-lucide-plus"
            size="sm"
            @click="createActive"
          />
          <UDropdownMenu v-else :items="createMenu">
            <UButton label="New" icon="i-lucide-plus" trailing-icon="i-lucide-chevron-down" size="sm" />
          </UDropdownMenu>
        </template>
      </template>
    </PageHeader>

    <div class="page-container py-6">
      <div class="mb-5 flex items-center gap-3 flex-wrap">
        <input
          v-model="search"
          :placeholder="showingCapabilities ? 'Search the library…' : 'Search the servers…'"
          class="field-search max-w-xs"
        />

        <div class="flex items-center gap-1">
          <button
            v-for="facet in facets"
            :key="facet.key"
            class="px-2.5 py-1 rounded-md fs-mono font-medium transition-all focus-ring"
            :style="{
              background: activeType === facet.key ? 'var(--accent-muted)' : 'transparent',
              color: activeType === facet.key ? 'var(--accent)' : 'var(--text-tertiary)',
            }"
            @click="activeType = facet.key"
          >
            {{ facet.label }}
            <span class="font-mono fs-micro ml-1 opacity-70">{{ facet.count }}</span>
          </button>

          <!--
            The divider is the point. A server is not a fourth kind of file, so
            it sits outside the group the other facets slice up, and "All" keeps
            meaning all of *those*.
          -->
          <span v-if="showMcpFacet" class="w-px h-4 mx-1.5 shrink-0" style="background: var(--border-subtle);" />

          <button
            v-if="showMcpFacet"
            class="px-2.5 py-1 rounded-md fs-mono font-medium transition-all focus-ring flex items-center gap-1"
            :style="{
              background: activeType === 'mcp' ? 'var(--accent-muted)' : 'transparent',
              color: activeType === 'mcp' ? 'var(--accent)' : 'var(--text-tertiary)',
            }"
            title="MCP servers — tools your agents reach that don't live on this machine"
            @click="activeType = 'mcp'"
          >
            MCP
            <span v-if="mcpFacet.count !== null" class="font-mono fs-micro opacity-70">
              {{ mcpFacet.count }}
            </span>
            <!-- Somewhere to look when a server has stopped answering. -->
            <span
              v-if="mcpFacet.broken"
              class="size-1.5 rounded-full shrink-0"
              style="background: var(--warning);"
              :title="`${mcpFacet.broken} need attention`"
            />
          </button>
        </div>

        <span v-if="search && showingCapabilities" class="type-detail">
          {{ matchCount }} of {{ counts.all }}
        </span>
      </div>

      <div
        v-if="error && showingCapabilities"
        class="rounded-lg px-4 py-3 mb-4 flex items-start gap-3"
        style="background: var(--error-wash); border: 1px solid var(--error-tint);"
      >
        <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0 mt-0.5 ink-error" />
        <span class="fs-sm ink-error">{{ error }}</span>
      </div>

      <!--
        Head of the chain below, so the capability list and its empty states are
        skipped wholesale rather than each having to know about the MCP facet.
      -->
      <McpServerList v-if="activeType === 'mcp'" v-model:adding="showMcpAdd" :search="search" />

      <div v-else-if="loading && !counts.all" class="space-y-1">
        <SkeletonRow v-for="i in 6" :key="i" />
      </div>

      <EntityList
        v-else-if="groups.length"
        :groups="groups"
        :open-while-filtering="Boolean(search)"
        :plugin-route="id => `/plugins/${encodeURIComponent(id)}`"
      >
        <template #row="{ item }">
          <EntityRow
            :to="item.to"
            :name="item.name"
            :description="item.description"
            :mono="item.mono"
            :icon="CAPABILITY_LOOK[item.type].icon"
            :accent="item.type !== 'agent'"
            :icon-color="item.type === 'agent' ? getAgentColor(item.colour) : undefined"
          >
            <template #badges>
              <span
                v-if="item.hint"
                class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0 badge badge-subtle max-w-[160px] truncate"
              >
                {{ item.hint }}
              </span>
              <span
                v-if="item.boundAgent"
                class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0 badge badge-agent"
              >
                agent: {{ item.boundAgent }}
              </span>
              <ImportBadge v-if="item.githubRepo" :repo="item.githubRepo" />
            </template>

            <!--
              On `all`, the type is the fact that stops two similarly-named rows
              being confusable. Filtered to one type it is the same word on every
              row, which is noise.
            -->
            <template #meta>
              <span v-if="item.toolCount" class="fs-micro text-meta">{{ item.toolCount }} tools</span>
              <span
                v-if="item.model && modelColors[item.model]"
                class="fs-micro font-mono font-medium px-1.5 py-px rounded-full shrink-0"
                :class="[modelColors[item.model]?.bg, modelColors[item.model]?.text]"
              >
                {{ item.model }}
              </span>
              <span v-if="activeType === 'all'" class="fs-micro text-meta w-14 text-right">
                {{ CAPABILITY_LOOK[item.type].label }}
              </span>
            </template>
          </EntityRow>
        </template>
      </EntityList>

      <EmptyState
        v-else-if="search"
        icon="i-lucide-search-x"
        title="Nothing in the library matches that"
        description="This looks through names, descriptions, plugin names and what a command takes."
      />

      <EmptyState
        v-else
        icon="i-lucide-library"
        title="Nothing installed yet"
        description="Agents, commands and skills all live here. Add one, or browse what is available."
        action-label="Browse what's available"
        action-to="/explore"
      />
    </div>

    <UModal v-model:open="showAgentWizard">
      <template #content>
        <AgentWizard
          @saved="(a) => { showAgentWizard = false; router.push(`/agents/${a.slug}`) }"
          @cancel="showAgentWizard = false"
        />
      </template>
    </UModal>

    <UModal v-model:open="showCommandForm">
      <template #content>
        <CommandForm
          @saved="(c) => { showCommandForm = false; router.push(`/commands/${c.slug}`) }"
          @cancel="showCommandForm = false"
        />
      </template>
    </UModal>

    <UModal v-model:open="showSkillWizard">
      <template #content>
        <!-- Guided three-question flow for simple mode, raw form for advanced -->
        <SkillWizard
          v-if="isSimple"
          @saved="(s) => { showSkillWizard = false; router.push(`/skills/${s.slug}`) }"
          @cancel="showSkillWizard = false"
        />
        <SkillForm
          v-else
          mode="create"
          @saved="(s) => { showSkillWizard = false; router.push(`/skills/${s.slug}`) }"
          @cancel="showSkillWizard = false"
        />
      </template>
    </UModal>

    <UModal v-model:open="showImport">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay modal-panel">
          <h3 class="text-section-title">Import {{ activeType === 'agent' ? 'an agent' : 'a skill' }}</h3>
          <FileImport
            :type="activeType === 'agent' ? 'agents' : 'skills'"
            @imported="showImport = false"
          />
          <div class="flex justify-end">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="() => { showImport = false }" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
