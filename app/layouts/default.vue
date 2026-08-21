<template>
  <!--
    The layout every page gets unless it asks for another one.

    Deliberately an element-free passthrough: `app.vue` now renders `<NuxtLayout>`
    around `<NuxtPage>`, and any wrapper here would appear in the DOM of every
    screen in the app — changing the box model under pages that have never heard
    of layouts. The only page that wants a wrapper asks for `work`.
  -->
  <slot />
</template>
