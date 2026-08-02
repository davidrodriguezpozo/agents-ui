<script setup lang="ts">
import type { Scope } from '~/types'

/**
 * Where a definition comes from: your global `~/.claude`, the current project's
 * `.claude`, or a plugin. Plugin content is read-only here.
 */
const props = defineProps<{
  scope?: Scope
  source?: 'local' | 'plugin' | 'github'
  pluginName?: string
  githubRepo?: string
  projectDir?: string
}>()

const display = computed(() => {
  if (props.source === 'plugin') {
    return {
      label: props.pluginName || 'plugin',
      icon: 'i-lucide-puzzle',
      title: `Provided by the ${props.pluginName || 'unknown'} plugin`,
      tone: 'plugin' as const,
    }
  }
  if (props.source === 'github') {
    return {
      label: props.githubRepo || 'github',
      icon: 'i-lucide-github',
      title: `Imported from ${props.githubRepo}`,
      tone: 'github' as const,
    }
  }
  if (props.scope === 'project') {
    return {
      label: 'project',
      icon: 'i-lucide-folder-git-2',
      title: props.projectDir ? `Defined in ${props.projectDir}/.claude` : 'Defined in this project',
      tone: 'project' as const,
    }
  }
  return {
    label: 'personal',
    icon: 'i-lucide-user',
    title: 'Defined in your global ~/.claude directory',
    tone: 'user' as const,
  }
})

const toneStyle = computed(() => {
  switch (display.value.tone) {
    case 'plugin':
      return { background: 'rgba(139, 92, 246, 0.12)', color: 'rgb(139, 92, 246)' }
    case 'github':
      return { background: 'rgba(56, 139, 253, 0.12)', color: 'rgb(56, 139, 253)' }
    case 'project':
      return { background: 'rgba(34, 197, 94, 0.12)', color: 'rgb(34, 197, 94)' }
    default:
      return { background: 'var(--badge-subtle-bg)', color: 'var(--text-tertiary)' }
  }
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-px rounded-full shrink-0 max-w-[180px]"
    :style="toneStyle"
    :title="display.title"
  >
    <UIcon :name="display.icon" class="size-2.5 shrink-0" />
    <span class="truncate">{{ display.label }}</span>
  </span>
</template>
