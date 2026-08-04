<script setup lang="ts">
import type { NuxtError } from '#app'

/**
 * The last line of defence. Nuxt's default error page shows a stack trace,
 * which is alarming and useless to someone in sales — this says what happened
 * and gives them a way out. The technical detail stays available, folded away.
 */
const props = defineProps<{ error: NuxtError }>()

const isNotFound = computed(() => props.error?.statusCode === 404)

const heading = computed(() => {
  if (isNotFound.value) return "That page doesn't exist"
  if (props.error?.statusCode === 403) return 'You do not have access to that'
  return 'Something went wrong'
})

const explanation = computed(() => {
  if (isNotFound.value) {
    return 'The link may be out of date, or the thing it pointed at was renamed or deleted.'
  }
  return 'This is a problem with the app, not something you did. Going back usually clears it.'
})

/** Genuine detail for whoever ends up debugging, not shown by default. */
const detail = computed(() => {
  // The error Nuxt hands the page carries the failing URL; NuxtError's type
  // does not admit to it.
  const error = props.error as (NuxtError & { url?: string }) | undefined
  const parts = [
    error?.statusCode ? `Status ${error.statusCode}` : null,
    error?.message,
    error?.url,
  ].filter(Boolean)
  return parts.join('\n')
})

function goHome() {
  clearError({ redirect: '/' })
}

function retry() {
  clearError({ redirect: useRoute().fullPath })
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-6" style="background: var(--surface-base);">
    <div class="max-w-md w-full space-y-6 text-center">
      <div class="flex justify-center">
        <div
          class="size-14 rounded-xl flex items-center justify-center"
          style="background: var(--badge-subtle-bg); border: 1px solid var(--border-subtle);"
        >
          <UIcon
            :name="isNotFound ? 'i-lucide-compass' : 'i-lucide-triangle-alert'"
            class="size-6"
            style="color: var(--accent);"
          />
        </div>
      </div>

      <div class="space-y-2">
        <h1
          class="text-page-title"
          style="color: var(--text-primary); font-family: var(--font-display);"
        >
          {{ heading }}
        </h1>
        <p class="text-[13px] leading-relaxed" style="color: var(--text-secondary);">
          {{ explanation }}
        </p>
      </div>

      <div class="flex items-center justify-center gap-2">
        <UButton label="Go home" icon="i-lucide-house" size="sm" @click="goHome" />
        <UButton
          v-if="!isNotFound"
          label="Try again"
          icon="i-lucide-rotate-ccw"
          size="sm"
          variant="soft"
          color="neutral"
          @click="retry"
        />
      </div>

      <details v-if="detail" class="text-left">
        <summary
          class="text-[11px] cursor-pointer list-none flex items-center justify-center gap-1.5"
          style="color: var(--text-disabled);"
        >
          <UIcon name="i-lucide-chevron-right" class="size-3" />
          Technical detail
        </summary>
        <pre
          class="mt-2 font-mono text-[10px] p-3 rounded-md overflow-x-auto whitespace-pre-wrap"
          style="background: var(--surface-raised); border: 1px solid var(--border-subtle); color: var(--text-tertiary);"
        >{{ detail }}</pre>
      </details>
    </div>
  </div>
</template>
