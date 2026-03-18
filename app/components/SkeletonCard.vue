<template>
  <div class="rounded-xl p-4 bg-card relative overflow-hidden">
    <div class="absolute inset-x-0 top-0 h-[4px] skeleton-shine" />
    <div class="flex items-start gap-3 mb-3">
      <div class="size-8 rounded-lg skeleton-shine shrink-0" />
      <div class="flex-1 space-y-2 pt-0.5">
        <div class="h-3.5 w-32 rounded skeleton-shine" />
        <div class="h-2.5 w-full rounded skeleton-shine" />
      </div>
    </div>
    <div class="pt-3" style="border-top: 1px solid var(--border-subtle);">
      <div class="flex gap-2">
        <div class="h-5 w-16 rounded-full skeleton-shine" />
        <div class="h-5 w-14 rounded-full skeleton-shine" />
      </div>
    </div>
  </div>
</template>
