export default defineAppConfig({
  ui: {
    // Nuxt UI keeps its own palette; point it at the same indigo the design
    // tokens use so buttons and inputs match the rest of the app.
    colors: {
      primary: 'indigo',
      neutral: 'neutral',
    },
  },
})
