<script setup lang="ts">
const { skills, loading, error, fetchAll: fetchSkills } = useSkills()
const router = useRouter()

const showCreateModal = ref(false)
const { isSimple } = useUiMode()
const route = useRoute()

// `?new=1` deep-links here from the simple-mode home page.
onMounted(() => { if (route.query.new) showCreateModal.value = true })
const showImportModal = ref(false)
const searchQuery = ref('')

const sourceFilter = ref<'all' | 'user' | 'project' | 'plugin'>('all')

const sourceFilters = computed(() => {
  const counts = { all: skills.value.length, user: 0, project: 0, plugin: 0 }
  for (const s of skills.value) {
    if (s.source === 'plugin') counts.plugin++
    else if (s.scope === 'project') counts.project++
    else counts.user++
  }
  return [
    { key: 'all' as const, label: 'All', count: counts.all },
    { key: 'user' as const, label: 'Personal', count: counts.user },
    { key: 'project' as const, label: 'Project', count: counts.project },
    { key: 'plugin' as const, label: 'Plugins', count: counts.plugin },
  ].filter(f => f.key === 'all' || f.count > 0)
})

const filteredSkills = computed(() => {
  const q = searchQuery.value.toLowerCase()
  return skills.value.filter((s) => {
    if (sourceFilter.value === 'plugin' && s.source !== 'plugin') return false
    if (sourceFilter.value === 'project' && (s.source === 'plugin' || s.scope !== 'project')) return false
    if (sourceFilter.value === 'user' && (s.source === 'plugin' || s.scope === 'project')) return false
    if (!q) return true
    return s.frontmatter.name.toLowerCase().includes(q)
      || s.frontmatter.description?.toLowerCase().includes(q)
      || s.frontmatter.agent?.toLowerCase().includes(q)
      || (s.pluginName || '').toLowerCase().includes(q)
  })
})
</script>

<template>
  <div>
    <PageHeader title="Skills">
      <template #trailing>
        <span class="font-mono text-[12px] text-meta">{{ skills.length }}</span>
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

    <div class="px-6 py-4">
      <p class="text-[13px] mb-4 leading-relaxed text-label">
        Specific capabilities that can be added to agents and invoked as slash commands.
      </p>

      <!-- Search + source filter -->
      <div class="mb-4 flex items-center gap-3 flex-wrap">
        <input
          v-model="searchQuery"
          placeholder="Search skills..."
          class="field-search max-w-xs"
        />
        <div v-if="sourceFilters.length > 2" class="flex items-center gap-1">
          <button
            v-for="filter in sourceFilters"
            :key="filter.key"
            class="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all focus-ring"
            :style="{
              background: sourceFilter === filter.key ? 'var(--accent-muted)' : 'transparent',
              color: sourceFilter === filter.key ? 'var(--accent)' : 'var(--text-tertiary)',
            }"
            @click="sourceFilter = filter.key"
          >
            {{ filter.label }}
            <span class="font-mono text-[10px] ml-1 opacity-70">{{ filter.count }}</span>
          </button>
        </div>
      </div>

      <div
        v-if="error"
        class="rounded-lg px-4 py-3 mb-4 flex items-start gap-3"
        style="background: rgba(248, 113, 113, 0.06); border: 1px solid rgba(248, 113, 113, 0.12);"
      >
        <UIcon name="i-lucide-alert-circle" class="size-4 shrink-0 mt-0.5" style="color: var(--error);" />
        <span class="text-[12px]" style="color: var(--error);">{{ error }}</span>
      </div>

      <div v-if="loading" class="space-y-1">
        <SkeletonRow v-for="i in 5" :key="i" />
      </div>

      <!-- Skill list -->
      <div v-else-if="filteredSkills.length" class="space-y-1">
        <NuxtLink
          v-for="skill in filteredSkills"
          :key="skill.slug"
          :to="`/skills/${skill.slug}`"
          class="flex items-center gap-3 px-3 py-2.5 rounded-md group focus-ring hover-row"
        >
          <!-- Icon -->
          <UIcon name="i-lucide-sparkles" class="size-3.5 shrink-0" style="color: var(--accent);" />

          <!-- Name -->
          <span class="type-strong w-44 shrink-0 truncate">
            {{ skill.frontmatter.name }}
          </span>

          <!-- Context badge -->
          <span
            v-if="skill.frontmatter.context"
            class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 badge badge-subtle"
          >
            {{ skill.frontmatter.context }}
          </span>

          <!-- Agent badge -->
          <span
            v-if="skill.frontmatter.agent"
            class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 badge badge-agent"
          >
            agent: {{ skill.frontmatter.agent }}
          </span>

          <!-- GitHub badge -->
          <ImportBadge
            v-if="skill.source === 'github' && skill.githubRepo"
            :repo="skill.githubRepo"
          />

          <!-- Description -->
          <span class="flex-1 text-[12px] truncate text-label">
            {{ skill.frontmatter.description }}
          </span>

          <!-- Metadata -->
          <div class="flex items-center gap-2 shrink-0">
            <SourceBadge
              v-if="skill.source !== 'github'"
              :scope="skill.scope"
              :source="skill.source === 'plugin' ? 'plugin' : 'local'"
              :plugin-name="skill.pluginName"
              :project-dir="skill.projectDir"
            />
            <UIcon
              name="i-lucide-chevron-right"
              class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-meta"
            />
          </div>
        </NuxtLink>
      </div>

      <!-- Empty state: search miss -->
      <EmptyState
        v-else-if="searchQuery"
        icon="i-lucide-search-x"
        title="No skills match your search"
        description="Try a shorter search, or switch the filter above."
      />

      <!-- Empty state: no skills -->
      <div v-else class="flex flex-col items-center justify-center py-12 space-y-5">
        <div class="rounded-md p-4 bg-card max-w-sm w-full type-detail leading-relaxed space-y-1">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-cpu" class="size-3.5" style="color: var(--accent);" />
            <span>code-reviewer</span>
            <span class="text-meta">agent</span>
          </div>
          <div class="flex items-center gap-2 ml-5">
            <UIcon name="i-lucide-sparkles" class="size-3" style="color: var(--accent);" />
            <span>security-audit</span>
            <span class="text-meta">skill</span>
          </div>
          <div class="flex items-center gap-2 ml-5">
            <UIcon name="i-lucide-sparkles" class="size-3" style="color: var(--accent);" />
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
