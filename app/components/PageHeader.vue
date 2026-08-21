<script setup lang="ts">
/**
 * The page header, and the only one.
 *
 * It used to take a `width` prop — narrow, wide or full — chosen per page,
 * which meant the title's x-position moved as you clicked between nav items.
 * That is gone. There are now exactly two kinds of page and the header knows
 * which is which:
 *
 *   - a **document** page (lists, detail, settings) sits in the shared
 *     `.page-container` frame, so every title lands on the same pixel;
 *   - a **workbench** page (`bleed`) is edge-to-edge because its body is
 *     panes, not prose — the graph canvas, the agent studio, a session.
 *
 * `overlay` floats the header over the body instead of stacking above it, for
 * a canvas that should run under it. Height and type never vary.
 *
 * `measure` is the narrower of the two document frames, for pages that are
 * mostly prose and lists. It exists as a prop rather than being decided in CSS
 * because the header and the body are separate elements: the body sets its own
 * frame, and a title centred in a 1320px frame above content centred in a 1080px
 * one is two columns that never line up. Whichever frame the body takes, the
 * header has to take the same one.
 */
withDefaults(defineProps<{
  title: string
  bleed?: boolean
  overlay?: boolean
  measure?: boolean
}>(), {
  bleed: false,
  overlay: false,
  measure: false,
})
</script>

<template>
  <div
    class="shrink-0 z-10 page-header"
    :class="overlay ? 'absolute top-0 left-0 right-0' : 'sticky top-0'"
    :style="{ height: 'var(--header-h)' }"
  >
    <!--
      A query container, so the controls a page hangs off `#right` can answer to
      how much header there actually is. Viewport media queries cannot: the
      sidebar collapses to 56px and the work rail can be put away entirely, so
      the same window gives this row anywhere from ~560px to the full width, and
      a rule keyed to the window would drop labels on a header with room to
      spare — or keep them on one without.
    -->
    <div
      class="h-full flex items-center gap-3 page-header__row"
      :class="bleed || overlay ? 'px-8' : ['page-container', { 'page-container--measure': measure }]"
    >
      <slot name="leading" />
      <h1 class="text-page-title flex-1 flex items-center gap-2.5 min-w-0">
        <!-- Pages with a rename-in-place title replace the text node -->
        <slot name="title">
          <span class="truncate">{{ title }}</span>
        </slot>
        <slot name="trailing" />
      </h1>
      <div class="flex items-center gap-2 shrink-0">
        <slot name="right" />
      </div>
    </div>
  </div>
</template>
