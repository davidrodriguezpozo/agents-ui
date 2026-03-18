<script setup lang="ts">
defineProps<{
  title: string
  description: string
  icon: string
  to?: string
}>()

defineEmits<{
  click: []
}>()
</script>

<template>
  <NuxtLink
    v-if="to"
    :to="to"
    class="flex items-center gap-4 px-5 py-5 rounded-xl transition-all duration-150 focus-ring cursor-pointer group"
    style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
    @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; ($event.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(229, 169, 62, 0.06)'"
    @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'; ($event.currentTarget as HTMLElement).style.boxShadow = 'none'"
  >
    <div
      class="size-10 rounded-xl flex items-center justify-center shrink-0"
      style="background: linear-gradient(135deg, rgba(229, 169, 62, 0.12) 0%, rgba(229, 169, 62, 0.04) 100%); border: 1px solid rgba(229, 169, 62, 0.1);"
    >
      <UIcon :name="icon" class="size-5" style="color: var(--accent);" />
    </div>
    <div class="flex-1 text-left">
      <div class="text-[13px] font-medium" style="color: var(--text-primary); font-family: var(--font-sans);">
        {{ title }}
      </div>
      <div class="text-[11px] mt-0.5" style="color: var(--text-tertiary);">
        {{ description }}
      </div>
    </div>
    <UIcon name="i-lucide-arrow-right" class="size-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style="color: var(--text-disabled);" />
  </NuxtLink>
  <button
    v-else
    class="flex items-center gap-4 px-5 py-5 rounded-xl transition-all duration-150 focus-ring cursor-pointer group w-full"
    style="background: var(--surface-raised); border: 1px solid var(--border-subtle);"
    @mouseenter="($event.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; ($event.currentTarget as HTMLElement).style.boxShadow = '0 0 20px rgba(229, 169, 62, 0.06)'"
    @mouseleave="($event.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)'; ($event.currentTarget as HTMLElement).style.boxShadow = 'none'"
    @click="$emit('click')"
  >
    <div
      class="size-10 rounded-xl flex items-center justify-center shrink-0"
      style="background: linear-gradient(135deg, rgba(229, 169, 62, 0.12) 0%, rgba(229, 169, 62, 0.04) 100%); border: 1px solid rgba(229, 169, 62, 0.1);"
    >
      <UIcon :name="icon" class="size-5" style="color: var(--accent);" />
    </div>
    <div class="flex-1 text-left">
      <div class="text-[13px] font-medium" style="color: var(--text-primary); font-family: var(--font-sans);">
        {{ title }}
      </div>
      <div class="text-[11px] mt-0.5" style="color: var(--text-tertiary);">
        {{ description }}
      </div>
    </div>
    <UIcon name="i-lucide-arrow-right" class="size-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style="color: var(--text-disabled);" />
  </button>
</template>
