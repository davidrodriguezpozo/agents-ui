<script setup lang="ts">
const { skills, loading } = useSkills()
const router = useRouter()

const showCreateModal = ref(false)
const searchQuery = ref('')

const filteredSkills = computed(() => {
  if (!searchQuery.value) return skills.value
  const q = searchQuery.value.toLowerCase()
  return skills.value.filter(s =>
    s.frontmatter.name.toLowerCase().includes(q) ||
    s.frontmatter.description?.toLowerCase().includes(q) ||
    s.frontmatter.agent?.toLowerCase().includes(q)
  )
})
</script>

<template>
  <div>
    <PageHeader title="Skills">
      <template #trailing>
        <span class="font-mono text-[12px]" style="color: var(--text-disabled);">{{ skills.length }}</span>
      </template>
      <template #right>
        <UButton label="New Skill" icon="i-lucide-plus" size="sm" @click="showCreateModal = true" />
      </template>
    </PageHeader>

    <div class="px-6 py-4">
      <!-- Search -->
      <div class="mb-4">
        <input
          v-model="searchQuery"
          placeholder="Search skills..."
          class="field-search max-w-xs"
        />
      </div>

      <div v-if="loading" class="flex justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" style="color: var(--text-disabled);" />
      </div>

      <!-- Skill list -->
      <div v-else-if="filteredSkills.length" class="space-y-1">
        <NuxtLink
          v-for="skill in filteredSkills"
          :key="skill.slug"
          :to="`/skills/${skill.slug}`"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group focus-ring"
          style="border: 1px solid transparent;"
          @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)'; ($event.currentTarget as HTMLElement).style.background = 'var(--surface-raised)'"
          @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'transparent'; ($event.currentTarget as HTMLElement).style.background = 'transparent'"
        >
          <!-- Icon -->
          <UIcon name="i-lucide-sparkles" class="size-3.5 shrink-0" style="color: var(--accent);" />

          <!-- Name -->
          <span class="font-mono text-[13px] font-medium w-44 shrink-0 truncate" style="color: var(--text-primary);">
            {{ skill.frontmatter.name }}
          </span>

          <!-- Context badge -->
          <span
            v-if="skill.frontmatter.context"
            class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0"
            style="background: rgba(255,255,255,0.06); color: var(--text-disabled);"
          >
            {{ skill.frontmatter.context }}
          </span>

          <!-- Agent badge -->
          <span
            v-if="skill.frontmatter.agent"
            class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0"
            style="background: rgba(99,102,241,0.1); color: rgb(129,140,248);"
          >
            agent: {{ skill.frontmatter.agent }}
          </span>

          <!-- Description -->
          <span class="flex-1 text-[12px] truncate" style="color: var(--text-tertiary);">
            {{ skill.frontmatter.description }}
          </span>

          <!-- Metadata -->
          <div class="flex items-center gap-3 shrink-0">
            <span class="font-mono text-[10px]" style="color: var(--text-disabled);">
              {{ Math.round(skill.body.length / 100) / 10 }}k chars
            </span>
            <UIcon
              name="i-lucide-chevron-right"
              class="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
              style="color: var(--text-disabled);"
            />
          </div>
        </NuxtLink>
      </div>

      <!-- Empty state -->
      <div v-else class="flex flex-col items-center justify-center py-16 space-y-3">
        <UIcon name="i-lucide-sparkles" class="size-10" style="color: var(--text-disabled);" />
        <p class="text-[13px]" style="color: var(--text-tertiary);">
          {{ searchQuery ? 'No skills match your search.' : 'No skills found.' }}
        </p>
        <p v-if="!searchQuery" class="text-[12px] max-w-sm text-center leading-relaxed" style="color: var(--text-disabled);">
          Skills are reusable prompts that can be invoked as slash commands. Create one to define a repeatable workflow.
        </p>
        <UButton v-if="!searchQuery" label="Create your first skill" size="sm" @click="showCreateModal = true" />
      </div>
    </div>

    <UModal v-model:open="showCreateModal">
      <template #content>
        <SkillForm
          mode="create"
          @saved="(s) => { showCreateModal = false; router.push(`/skills/${s.slug}`) }"
          @cancel="showCreateModal = false"
        />
      </template>
    </UModal>
  </div>
</template>
