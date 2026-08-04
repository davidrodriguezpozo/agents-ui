<script setup lang="ts">
/**
 * The canonical "there is nothing here yet".
 *
 * Empty states are where someone new spends their first minute, so they say
 * what the thing is and offer the obvious next step rather than just reporting
 * absence. Every page was hand-rolling a centred icon and one line of text.
 */
withDefaults(defineProps<{
  icon?: string
  title: string
  description?: string
  /** Primary action. Either `to` for navigation or listen to `@action`. */
  actionLabel?: string
  actionIcon?: string
  actionTo?: string
  /** Optional quieter secondary action. */
  secondaryLabel?: string
  secondaryTo?: string
  /** `inset` sits inside an existing card; `page` stands alone. */
  variant?: 'page' | 'inset'
}>(), {
  icon: 'i-lucide-inbox',
  variant: 'page',
})

const emit = defineEmits<{ action: []; secondary: [] }>()
</script>

<template>
  <div
    class="flex flex-col items-center justify-center text-center"
    :class="variant === 'page' ? 'py-16 px-6' : 'py-10 px-5'"
  >
    <div
      class="flex items-center justify-center mb-4"
      :class="variant === 'page' ? 'size-11 rounded-lg' : 'size-9 rounded-md'"
      style="background: var(--badge-subtle-bg); border: 1px solid var(--border-subtle);"
    >
      <UIcon :name="icon" :class="variant === 'page' ? 'size-5' : 'size-4'" style="color: var(--text-tertiary);" />
    </div>

    <p class="type-strong">{{ title }}</p>

    <p v-if="description" class="type-detail mt-1.5 max-w-sm leading-relaxed">
      {{ description }}
    </p>

    <div v-if="actionLabel || secondaryLabel" class="flex items-center gap-2 mt-5">
      <UButton
        v-if="actionLabel"
        :label="actionLabel"
        :icon="actionIcon"
        :to="actionTo"
        size="sm"
        @click="() => { if (!actionTo) emit('action') }"
      />
      <UButton
        v-if="secondaryLabel"
        :label="secondaryLabel"
        :to="secondaryTo"
        size="sm"
        variant="ghost"
        color="neutral"
        @click="() => { if (!secondaryTo) emit('secondary') }"
      />
    </div>
  </div>
</template>
