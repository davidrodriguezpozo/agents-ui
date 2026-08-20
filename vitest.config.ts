import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Unit tests for the pure logic behind scheduling, plugin discovery and file
 * parsing. These run outside Nuxt, so `~` is aliased by hand and anything
 * relying on Nitro auto-imports is stubbed per-test rather than globally.
 */
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '@': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    /*
     * The terminal client's tests live in `cli/test/` rather than here, because
     * `nuxt typecheck` reads the whole repository with Vue's JSX settings — and
     * a test importing the Ink app from `test/` drags every `.tsx` in the client
     * into the wrong typechecker. `cli/` is excluded there and checked by
     * `tsc -p cli` instead, so its tests belong inside that boundary.
     */
    include: ['test/**/*.test.ts', 'cli/test/**/*.test.ts'],
    // Sessions keep a full checkout of this repo in .worktrees/, so without
    // this the suite is discovered once per open session and runs several
    // times over. Anyone using sessions on a repo with tests needs the same
    // line in their own config.
    exclude: ['**/node_modules/**', '**/.worktrees/**'],
    globals: true,
  },
})
