<script setup lang="ts">
const props = defineProps<{
  featureKey: string
  message: string
  action: string
}>()

const { settings, save } = useSettings()

const dismissed = computed(() => {
  return !!(settings.value?.guidanceSeen as any)?.[props.featureKey]
})

async function dismiss() {
  if (!settings.value) return
  const guidanceSeen = { ...(settings.value.guidanceSeen || {}), [props.featureKey]: true }
  // Optimistic update
  settings.value = { ...settings.value, guidanceSeen }
  // Persist in background
  try {
    await save({ ...settings.value, guidanceSeen })
  } catch {
    // Non-critical — state is already updated locally
  }
}
</script>

<template>
  <div
    v-if="!dismissed"
    class="rounded-xl px-4 py-3 flex items-start gap-3 mb-4"
    style="background: rgba(229, 169, 62, 0.06); border: 1px solid rgba(229, 169, 62, 0.12);"
  >
    <UIcon name="i-lucide-info" class="size-4 shrink-0 mt-0.5" style="color: var(--accent);" />
    <div class="flex-1 min-w-0">
      <p class="text-[12px] leading-relaxed" style="color: var(--text-secondary);">{{ message }}</p>
      <p class="text-[11px] mt-1 font-medium" style="color: var(--accent);">{{ action }}</p>
    </div>
    <button
      class="p-1 rounded shrink-0"
      style="color: var(--text-disabled);"
      aria-label="Dismiss"
      @click="dismiss"
    >
      <UIcon name="i-lucide-x" class="size-3.5" />
    </button>
  </div>
</template>
