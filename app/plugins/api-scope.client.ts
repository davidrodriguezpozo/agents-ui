/**
 * Tag every API request with the project the user currently has selected, so the
 * server can merge `~/.claude` with `<project>/.claude` without every composable
 * having to thread the path through by hand.
 *
 * Reads localStorage directly rather than the `useWorkingDir` state: the
 * interceptor runs outside a component context, and localStorage is the source
 * of truth that state hydrates from anyway.
 */
export default defineNuxtPlugin(() => {
  const scoped = $fetch.create({
    onRequest({ request, options }) {
      const url = typeof request === 'string' ? request : (request as Request).url
      if (!url?.includes('/api/')) return

      let projectDir = ''
      try {
        projectDir = localStorage.getItem('agents-ui:working-dir') || ''
      } catch {
        return
      }
      if (!projectDir) return

      const headers = new Headers(options.headers as HeadersInit | undefined)
      headers.set('x-project-dir', encodeURIComponent(projectDir))
      options.headers = headers
    },
  })

  globalThis.$fetch = scoped as typeof globalThis.$fetch
})
