<script setup lang="ts">
import { groupByOrigin, filterGroups } from '~/utils/entityGroups'

const { skills, loading, error, fetchAll: fetchSkills } = useSkills()
const router = useRouter()

const showCreateModal = ref(false)
const { isSimple } = useUiMode()
const route = useRoute()

// `?new=1` deep-links here from the simple-mode home page.
onMounted(() => { if (route.query.new) showCreateModal.value = true })
const showImportModal = ref(false)
const searchQuery = ref('')

/**
 * Grouped by origin rather than listed flat. 198 of these 199 skills came from
 * plugins, so alphabetical order buried the one that is actually yours between
 * `choosing-trend-or-slope` and `cleaning-up-stale-flags`.
 *
 * The source filter that used to sit above the list is now the grouping itself,
 * which does the same job without asking first.
 */
const groups = computed(() => filterGroups(
  groupByOrigin(skills.value),
  searchQuery.value,
  s => [s.frontmatter.name, s.frontmatter.description, s.frontmatter.agent, s.pluginName],
))

const matchCount = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))
</script>

<template>
  <div>
    <PageHeader title="Skills">
      <template #trailing>
        <span class="font-mono fs-sm text-meta">{{ skills.length }}</span>
      </template>
      <template #right>
        <UButton label="Import" icon="i-lucide-upload" size="sm" variant="soft" @click="() => { showImportModal = true }" />
        <UButton
          :label="isSimple ? 'Teach Claude something' : 'New Skill'"
          icon="i-lucide-plus"
          size="sm"
          @click="() => { showCreateModal = true }"
        />
      </template>
    </PageHeader>

    <div class="page-container py-6">
      <p class="fs-base mb-4 leading-relaxed text-label">
        Specific capabilities that can be added to agents and invoked as slash commands.
      </p>

      <div class="mb-4 flex items-center gap-3 flex-wrap">
        <input
          v-model="searchQuery"
          placeholder="Search skills..."
          class="field-search max-w-xs"
        />
        <span v-if="searchQuery" class="type-detail">
          {{ matchCount }} of {{ skills.length }}
        </span>
      </div>

      <div
        v-if="error"
        class="rounded-lg px-4 py-3 mb-4 flex items-start gap-3"
        style="background: var(--error-wash); border: 1px solid var(--error-tint);"
      >
        <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0 mt-0.5 ink-error" />
        <span class="fs-sm ink-error">{{ error }}</span>
      </div>

      <div v-if="loading" class="space-y-1">
        <SkeletonRow v-for="i in 5" :key="i" />
      </div>

      <EntityList
        v-else-if="groups.length"
        :groups="groups"
        :plugin-route="id => `/plugins/${encodeURIComponent(id)}`"
      >
        <template #row="{ item: skill }">
          <EntityRow
            accent
            icon="i-lucide-sparkles"
            :to="`/skills/${skill.slug}`"
            :name="skill.frontmatter.name"
            :description="skill.frontmatter.description"
          >
            <template #badges>
              <span
                v-if="skill.frontmatter.context"
                class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0 badge badge-subtle"
              >
                {{ skill.frontmatter.context }}
              </span>
              <span
                v-if="skill.frontmatter.agent"
                class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0 badge badge-agent"
              >
                agent: {{ skill.frontmatter.agent }}
              </span>
              <ImportBadge
                v-if="skill.source === 'github' && skill.githubRepo"
                :repo="skill.githubRepo"
              />
            </template>
          </EntityRow>
        </template>
      </EntityList>

      <!-- Empty state: search miss -->
      <EmptyState
        v-else-if="searchQuery"
        icon="i-lucide-search-x"
        title="No skills match your search"
        description="Try a shorter search — this looks through names, descriptions and plugin names."
      />

      <!-- Empty state: no skills -->
      <div v-else class="flex flex-col items-center justify-center py-12 space-y-5">
        <div class="rounded-md p-4 bg-card max-w-sm w-full type-detail leading-relaxed space-y-1">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-cpu" class="size-3.5 ink-accent" />
            <span>code-reviewer</span>
            <span class="text-meta">agent</span>
          </div>
          <div class="flex items-center gap-2 ml-5">
            <UIcon name="i-lucide-sparkles" class="size-3 ink-accent" />
            <span>security-audit</span>
            <span class="text-meta">skill</span>
          </div>
          <div class="flex items-center gap-2 ml-5">
            <UIcon name="i-lucide-sparkles" class="size-3 ink-accent" />
            <span>performance-check</span>
            <span class="text-meta">skill</span>
          </div>
        </div>
        <p class="type-body">Skills teach agents specific capabilities. Link a skill to an agent to extend what it can do.</p>
        <div class="flex items-center gap-2">
          <UButton label="Create a skill" size="sm" @click="() => { showCreateModal = true }" />
          <UButton label="Import from GitHub" size="sm" variant="outline" to="/explore?tab=imported" />
        </div>
      </div>
    </div>

    <UModal v-model:open="showCreateModal">
      <template #content>
        <!-- Guided three-question flow for simple mode, raw form for advanced -->
        <SkillWizard
          v-if="isSimple"
          @saved="(s) => { showCreateModal = false; router.push(`/skills/${s.slug}`) }"
          @cancel="showCreateModal = false"
        />
        <SkillForm
          v-else
          mode="create"
          @saved="(s) => { showCreateModal = false; router.push(`/skills/${s.slug}`) }"
          @cancel="showCreateModal = false"
        />
      </template>
    </UModal>

    <UModal v-model:open="showImportModal">
      <template #content>
        <div class="p-6 space-y-4 bg-overlay">
          <h3 class="text-page-title">Import Skill</h3>
          <FileImport
            type="skills"
            @imported="(s) => { showImportModal = false; fetchSkills(); router.push(`/skills/${s.slug}`) }"
          />
          <div class="flex justify-end">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="() => { showImportModal = false }" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
