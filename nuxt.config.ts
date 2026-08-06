export default defineNuxtConfig({
  modules: ['@nuxt/ui'],

  devtools: { enabled: true },

  future: { compatibilityVersion: 4 },

  css: ['~/assets/css/main.css'],

  compatibilityDate: '2025-01-15',

  runtimeConfig: {
    claudeDir: process.env.CLAUDE_DIR || '',
  },

  app: {
    head: {
      title: 'Agents Studio',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'description', content: "Leave Claude Code running — work that fires on a schedule against your own repositories, checks itself with your own tests, and stops when it can't." },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#F7F8FA' },
        { property: 'og:title', content: 'Agents Studio — leave Claude Code running' },
        { property: 'og:description', content: "Leave Claude Code running — work that fires on a schedule against your own repositories, checks itself with your own tests, and stops when it can't." },
        { property: 'og:type', content: 'website' },
        { name: 'twitter:card', content: 'summary' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://api.fontshare.com/v2/css?f[]=clash-display@400;500;600;700&display=swap' },
        { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/style.min.css' },
        { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-mono/style.min.css' },
      ],
    },
    /**
     * No page transition, deliberately.
     *
     * Vue's <Transition> swaps `page-enter-from` for `page-enter-to` inside
     * requestAnimationFrame. rAF does not run while the document is hidden — a
     * backgrounded tab, an occluded or minimised window — so that swap never
     * happens and the page stays at its enter-from state of `opacity: 0`. The
     * page has mounted and rendered perfectly; it is simply invisible, which
     * reads as the app being broken. `mode: 'out-in'` made it worse: a leave
     * transition stuck the same way stops the next page mounting at all.
     *
     * Gating whether content can be seen on an animation completing is not a
     * trade worth making for 220ms of fade — and instant navigation is what
     * Linear and Vercel actually do.
     */
    pageTransition: false,
  },

  components: [
    { path: '~/components/chat', pathPrefix: false },
    { path: '~/components/studio', pathPrefix: false },
    { path: '~/components' },
  ],

  colorMode: {
    preference: 'light',
  },

  routeRules: {
    '/templates': { redirect: '/explore' },
  },
})
