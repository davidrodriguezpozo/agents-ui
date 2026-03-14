<script setup lang="ts">
import type { PluginDetail, SkillFrontmatter } from '~/types'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { fetchOne, updateSkill, toggleEnabled, uninstall } = usePlugins()

const id = decodeURIComponent(route.params.id as string)
const plugin = ref<PluginDetail | null>(null)
const loading = ref(true)

// Track editable skill state
const editingSkill = ref<string | null>(null)
const skillFrontmatters = ref<Record<string, SkillFrontmatter>>({})
const skillBodies = ref<Record<string, string>>({})
const savingSkill = ref(false)

// Uninstall
const showUninstallConfirm = ref(false)
const uninstalling = ref(false)

onMounted(async () => {
  try {
    plugin.value = await fetchOne(id)
    for (const skill of plugin.value.skillDetails) {
      skillFrontmatters.value[skill.slug] = { ...skill.frontmatter }
      skillBodies.value[skill.slug] = skill.body
    }
  } catch {
    toast.add({ title: 'Plugin not found', color: 'error' })
    router.push('/plugins')
  } finally {
    loading.value = false
  }
})

function toggleSkillEditor(slug: string) {
  editingSkill.value = editingSkill.value === slug ? null : slug
}

async function saveSkill(slug: string) {
  savingSkill.value = true
  try {
    await updateSkill(id, slug, skillFrontmatters.value[slug], skillBodies.value[slug])
    const skill = plugin.value?.skillDetails.find(s => s.slug === slug)
    if (skill) {
      skill.frontmatter = { ...skillFrontmatters.value[slug] }
      skill.body = skillBodies.value[slug]
    }
    toast.add({ title: 'Skill saved', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Failed to save', description: e.message, color: 'error' })
  } finally {
    savingSkill.value = false
  }
}

async function onToggle(enabled: boolean) {
  try {
    await toggleEnabled(id, enabled)
    if (plugin.value) plugin.value.enabled = enabled
    toast.add({ title: `Plugin ${enabled ? 'enabled' : 'disabled'}`, color: 'success' })
  } catch {
    toast.add({ title: 'Failed to update', color: 'error' })
  }
}

async function onUninstall() {
  uninstalling.value = true
  try {
    await uninstall(id)
    toast.add({ title: 'Plugin uninstalled', color: 'success' })
    router.push('/plugins')
  } catch (e: any) {
    toast.add({ title: 'Failed to uninstall', description: e.message, color: 'error' })
  } finally {
    uninstalling.value = false
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Cmd+S to save current skill
if (import.meta.client) {
  const onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && editingSkill.value) {
      e.preventDefault()
      saveSkill(editingSkill.value)
    }
  }
  onMounted(() => document.addEventListener('keydown', onKeydown))
  onUnmounted(() => document.removeEventListener('keydown', onKeydown))
}
</script>

<template>
  <div>
    <PageHeader :title="plugin?.name || id">
      <template #leading>
        <NuxtLink to="/plugins" class="focus-ring rounded">
          <UIcon name="i-lucide-arrow-left" class="size-4" style="color: var(--text-tertiary);" />
        </NuxtLink>
      </template>
      <template #trailing>
        <div
          class="size-2.5 rounded-full shrink-0"
          :style="{ background: plugin?.enabled ? 'var(--success, #22c55e)' : 'var(--text-disabled)' }"
        />
      </template>
      <template #right>
        <button
          class="text-[12px] px-2 py-1 rounded focus-ring"
          style="color: var(--text-tertiary);"
          @click="showUninstallConfirm = true"
        >
          Uninstall
        </button>
        <label v-if="plugin" class="field-toggle" title="Enable/disable plugin">
          <input
            type="checkbox"
            :checked="plugin.enabled"
            @change="onToggle(($event.target as HTMLInputElement).checked)"
          />
          <span class="field-toggle__track">
            <span class="field-toggle__thumb" />
          </span>
        </label>
      </template>
    </PageHeader>

    <!-- Breadcrumb -->
    <div class="px-6 pt-3 pb-1">
      <span class="text-[11px]" style="color: var(--text-disabled);">
        Plugins &rsaquo; {{ plugin?.name || id }}
      </span>
    </div>

    <div v-if="loading" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin" style="color: var(--text-disabled);" />
    </div>

    <div v-else-if="plugin" class="px-6 py-4 space-y-6">
      <!-- Plugin info card -->
      <div
        class="rounded-xl overflow-hidden"
        style="border: 1px solid var(--border-subtle);"
      >
        <div class="relative px-5 pt-6 pb-5" style="background: var(--surface-raised);">
          <!-- Top accent bar -->
          <div
            class="absolute inset-x-0 top-0 h-[3px]"
            :style="{ background: plugin.enabled ? 'var(--success, #22c55e)' : 'var(--text-disabled)' }"
          />

          <div class="flex items-start gap-4">
            <div
              class="size-11 rounded-xl flex items-center justify-center shrink-0"
              style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-subtle);"
            >
              <UIcon name="i-lucide-puzzle" class="size-5" style="color: var(--accent);" />
            </div>

            <div class="flex-1 min-w-0 pt-0.5">
              <div class="flex items-center gap-2.5 flex-wrap">
                <span class="font-mono text-[15px] font-semibold tracking-tight truncate" style="color: var(--text-primary);">
                  {{ plugin.name }}
                </span>
                <span
                  class="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full shrink-0"
                  style="background: rgba(255,255,255,0.06); color: var(--text-disabled);"
                >
                  v{{ plugin.version }}
                </span>
                <span
                  class="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full shrink-0"
                  :style="{
                    background: plugin.enabled ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)',
                    color: plugin.enabled ? '#4ade80' : 'var(--text-disabled)',
                  }"
                >
                  {{ plugin.enabled ? 'enabled' : 'disabled' }}
                </span>
              </div>
              <p class="text-[12px] mt-1 leading-relaxed" style="color: var(--text-tertiary);">
                {{ plugin.description || 'No description' }}
              </p>
            </div>
          </div>
        </div>

        <!-- Metadata -->
        <div class="px-5 py-3 flex items-center gap-6 flex-wrap" style="background: var(--surface-base); border-top: 1px solid var(--border-subtle);">
          <div class="flex items-center gap-1.5">
            <span class="text-[11px]" style="color: var(--text-disabled);">Marketplace</span>
            <span class="font-mono text-[11px]" style="color: var(--text-secondary);">{{ plugin.marketplace }}</span>
          </div>
          <div v-if="plugin.author" class="flex items-center gap-1.5">
            <span class="text-[11px]" style="color: var(--text-disabled);">Author</span>
            <span class="font-mono text-[11px]" style="color: var(--text-secondary);">{{ plugin.author.name }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-[11px]" style="color: var(--text-disabled);">Installed</span>
            <span class="font-mono text-[11px]" style="color: var(--text-secondary);">{{ formatDate(plugin.installedAt) }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="text-[11px]" style="color: var(--text-disabled);">Skills</span>
            <span class="font-mono text-[11px]" style="color: var(--text-secondary);">{{ plugin.skillDetails.length }}</span>
          </div>
        </div>
      </div>

      <!-- Skills -->
      <div v-if="plugin.skillDetails.length">
        <h3 class="text-section-label mb-3">Skills</h3>
        <div class="space-y-2">
          <div
            v-for="skill in plugin.skillDetails"
            :key="skill.slug"
            class="rounded-xl overflow-hidden"
            style="border: 1px solid var(--border-subtle);"
          >
            <!-- Skill header (clickable) -->
            <button
              class="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
              :style="{ background: editingSkill === skill.slug ? 'var(--surface-raised)' : 'transparent' }"
              @mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--surface-raised)'"
              @mouseleave="editingSkill !== skill.slug && (($event.currentTarget as HTMLElement).style.background = 'transparent')"
              @click="toggleSkillEditor(skill.slug)"
            >
              <UIcon
                :name="editingSkill === skill.slug ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-3.5 shrink-0"
                style="color: var(--text-disabled);"
              />
              <span class="font-mono text-[13px] font-medium w-40 shrink-0 truncate" style="color: var(--text-primary);">
                {{ skill.frontmatter.name }}
              </span>
              <span
                v-if="skill.frontmatter.context"
                class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0"
                style="background: rgba(255,255,255,0.06); color: var(--text-disabled);"
              >
                {{ skill.frontmatter.context }}
              </span>
              <span
                v-if="skill.frontmatter.agent"
                class="text-[10px] font-mono px-1.5 py-px rounded-full shrink-0"
                style="background: rgba(99,102,241,0.1); color: rgb(129,140,248);"
              >
                agent: {{ skill.frontmatter.agent }}
              </span>
              <span class="flex-1 text-[12px] truncate" style="color: var(--text-tertiary);">
                {{ skill.frontmatter.description }}
              </span>
              <span class="font-mono text-[10px] shrink-0" style="color: var(--text-disabled);">
                {{ Math.round(skill.body.length / 100) / 10 }}k chars
              </span>
            </button>

            <!-- Expanded editor -->
            <div v-if="editingSkill === skill.slug" style="border-top: 1px solid var(--border-subtle);">
              <!-- Skill frontmatter fields -->
              <div class="px-5 py-4 space-y-4" style="background: var(--surface-base);">
                <h4 class="text-section-label">Configuration</h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div class="field-group">
                    <label class="field-label">Name</label>
                    <input v-model="skillFrontmatters[skill.slug].name" class="field-input" />
                  </div>
                  <div class="field-group">
                    <label class="field-label">Context</label>
                    <input v-model="skillFrontmatters[skill.slug].context" class="field-input" placeholder="e.g. fork" />
                  </div>
                  <div class="field-group sm:col-span-2">
                    <label class="field-label">Description</label>
                    <input v-model="skillFrontmatters[skill.slug].description" class="field-input" />
                  </div>
                  <div class="field-group">
                    <label class="field-label">Agent</label>
                    <input v-model="skillFrontmatters[skill.slug].agent" class="field-input" placeholder="Optional agent name" />
                  </div>
                </div>
              </div>

              <!-- Body editor -->
              <div style="border-top: 1px solid var(--border-subtle);">
                <div class="flex items-center justify-between px-4 py-2.5" style="background: var(--surface-raised); border-bottom: 1px solid var(--border-subtle);">
                  <h4 class="text-section-label">Skill Prompt</h4>
                  <div class="flex items-center gap-3">
                    <span class="font-mono text-[10px]" style="color: var(--text-disabled);">
                      {{ skillBodies[skill.slug].split('\n').length }} lines
                    </span>
                    <span class="font-mono text-[10px]" style="color: var(--text-disabled);">
                      {{ skillBodies[skill.slug].length.toLocaleString() }} chars
                    </span>
                  </div>
                </div>
                <textarea
                  v-model="skillBodies[skill.slug]"
                  class="editor-textarea"
                  style="min-height: 300px;"
                  spellcheck="false"
                  placeholder="Skill prompt..."
                />
              </div>

              <!-- Save bar -->
              <div class="flex items-center justify-between px-4 py-3" style="background: var(--surface-raised); border-top: 1px solid var(--border-subtle);">
                <span class="font-mono text-[10px] truncate" style="color: var(--text-disabled);">
                  {{ skill.filePath }}
                </span>
                <UButton label="Save Skill" icon="i-lucide-save" size="sm" :loading="savingSkill" @click="saveSkill(skill.slug)" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- No skills -->
      <div v-else class="flex flex-col items-center justify-center py-12 space-y-3">
        <UIcon name="i-lucide-puzzle" class="size-8" style="color: var(--text-disabled);" />
        <p class="text-[13px]" style="color: var(--text-tertiary);">This plugin has no skills.</p>
      </div>

      <!-- File info -->
      <div class="font-mono text-[10px]" style="color: var(--text-disabled);">
        {{ plugin.installPath }}
      </div>
    </div>

    <!-- Uninstall confirmation -->
    <UModal v-model:open="showUninstallConfirm">
      <template #content>
        <div class="p-6 space-y-4" style="background: var(--surface-overlay);">
          <h3 class="text-page-title">Uninstall Plugin</h3>
          <p class="text-[13px]" style="color: var(--text-secondary);">
            Uninstall <strong class="font-mono">{{ plugin?.name }}</strong>? This removes the plugin registration but keeps the files on disk.
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancel" variant="ghost" color="neutral" size="sm" @click="showUninstallConfirm = false" />
            <UButton label="Uninstall" color="error" size="sm" :loading="uninstalling" @click="onUninstall" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
