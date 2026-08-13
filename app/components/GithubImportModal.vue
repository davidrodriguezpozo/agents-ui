<script setup lang="ts">
import { errorMessage } from '~/utils/errors'
import type { ScanResult } from '~/types'

const emit = defineEmits<{
  imported: []
}>()

const { scan, importRepo, scanning } = useGithubImports()
const toast = useToast()

const step = ref<'url' | 'preview' | 'importing' | 'done'>('url')
const url = ref('')
const scanResult = ref<ScanResult | null>(null)
const selected = ref<Set<string>>(new Set())
const importing = ref(false)
const error = ref('')

async function doScan() {
  error.value = ''
  try {
    scanResult.value = await scan(url.value)
    selected.value = new Set(scanResult.value.skills.map(s => s.slug))
    step.value = 'preview'
  } catch (e: any) {
    error.value = errorMessage(e, 'Failed to scan repository')
  }
}

function toggleSkill(slug: string) {
  if (selected.value.has(slug)) {
    selected.value.delete(slug)
  } else {
    selected.value.add(slug)
  }
  selected.value = new Set(selected.value)
}

function toggleAll() {
  if (!scanResult.value) return
  if (selected.value.size === scanResult.value.skills.length) {
    selected.value = new Set()
  } else {
    selected.value = new Set(scanResult.value.skills.map(s => s.slug))
  }
}

async function doImport() {
  if (!scanResult.value || selected.value.size === 0) return
  importing.value = true
  step.value = 'importing'
  try {
    await importRepo({
      owner: scanResult.value.owner,
      repo: scanResult.value.repo,
      url: url.value,
      targetPath: scanResult.value.targetPath,
      selectedSkills: [...selected.value],
    })
    step.value = 'done'
    toast.add({ title: `Imported ${selected.value.size} skills from ${scanResult.value.owner}/${scanResult.value.repo}`, color: 'success' })
    emit('imported')
  } catch (e: any) {
    error.value = errorMessage(e, 'Import failed')
    step.value = 'preview'
  } finally {
    importing.value = false
  }
}

function reset() {
  step.value = 'url'
  url.value = ''
  scanResult.value = null
  selected.value = new Set()
  error.value = ''
}
</script>

<template>
  <div class="p-6 space-y-4 bg-overlay min-w-[480px]">
    <h3 class="text-page-title">Import from GitHub</h3>

    <!-- Step 1: URL input -->
    <template v-if="step === 'url'">
      <p class="type-detail leading-relaxed">
        Paste a GitHub repository URL to scan for importable skills.
      </p>

      <div class="field-group">
        <label class="field-label">GitHub URL</label>
        <input
          v-model="url"
          class="field-input"
          placeholder="https://github.com/owner/repo"
          @keydown.enter="doScan"
        />
        <span class="field-hint">Supports repo URLs, subfolder URLs, and single file URLs</span>
      </div>

      <div
        v-if="error"
        class="rounded-md px-3 py-2 fs-sm"
        style="background: var(--error-wash); color: var(--error); border: 1px solid var(--error-tint);"
      >
        {{ error }}
      </div>

      <div class="flex justify-end gap-2">
        <UButton
          label="Scan"
          icon="i-lucide-search"
          size="sm"
          :loading="scanning"
          :disabled="!url.trim()"
          @click="doScan"
        />
      </div>
    </template>

    <!-- Step 2: Preview & select -->
    <template v-if="step === 'preview' && scanResult">
      <div class="flex items-center justify-between">
        <p class="type-detail">
          Found <strong>{{ scanResult.skills.length }}</strong> skills in
          <span class="font-mono">{{ scanResult.owner }}/{{ scanResult.repo }}</span>
        </p>
        <button class="fs-sm text-meta hover:text-label" @click="toggleAll">
          {{ selected.size === scanResult.skills.length ? 'Deselect all' : 'Select all' }}
        </button>
      </div>

      <div class="max-h-80 overflow-y-auto space-y-1 rounded-md p-1" style="background: var(--surface-base);">
        <label
          v-for="skill in scanResult.skills"
          :key="skill.slug"
          class="flex items-start gap-3 px-3 py-2.5 rounded-md cursor-pointer hover-row"
        >
          <input
            type="checkbox"
            :checked="selected.has(skill.slug)"
            class="mt-0.5 shrink-0"
            @change="toggleSkill(skill.slug)"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="type-strong truncate">{{ skill.name }}</span>
              <span
                v-if="skill.conflict"
                class="fs-micro font-medium px-1.5 py-px rounded-full shrink-0"
                style="background: var(--warning-tint); color: var(--warning, #eab308);"
              >
                exists locally
              </span>
              <span
                v-if="skill.category"
                class="fs-micro font-mono px-1.5 py-px rounded-full shrink-0 badge badge-subtle"
              >
                {{ skill.category }}
              </span>
            </div>
            <p class="fs-mono text-label mt-0.5 line-clamp-2">{{ skill.description }}</p>
          </div>
        </label>
      </div>

      <div
        v-if="error"
        class="rounded-md px-3 py-2 fs-sm"
        style="background: var(--error-wash); color: var(--error); border: 1px solid var(--error-tint);"
      >
        {{ error }}
      </div>

      <div class="flex justify-between">
        <UButton label="Back" variant="ghost" color="neutral" size="sm" @click="reset" />
        <UButton
          :label="`Import ${selected.size} skill${selected.size === 1 ? '' : 's'}`"
          icon="i-lucide-download"
          size="sm"
          :disabled="selected.size === 0"
          @click="doImport"
        />
      </div>
    </template>

    <!-- Step 3: Importing -->
    <template v-if="step === 'importing'">
      <div class="flex flex-col items-center py-8 space-y-3">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-meta" />
        <p class="type-body">Cloning repository...</p>
      </div>
    </template>

    <!-- Step 4: Done -->
    <template v-if="step === 'done'">
      <div class="flex flex-col items-center py-6 space-y-3">
        <div
          class="size-12 rounded-full flex items-center justify-center"
          style="background: var(--success-tint);"
        >
          <UIcon name="i-lucide-check" class="size-6" style="color: var(--success, #22c55e);" />
        </div>
        <p class="type-strong">Import complete</p>
        <p class="type-detail">
          {{ selected.size }} skill{{ selected.size === 1 ? '' : 's' }} imported from
          <span class="font-mono">{{ scanResult?.owner }}/{{ scanResult?.repo }}</span>
        </p>
      </div>
    </template>
  </div>
</template>
