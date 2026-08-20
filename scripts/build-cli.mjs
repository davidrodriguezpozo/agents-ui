#!/usr/bin/env node

import { build } from 'esbuild'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Bundle the terminal app into `.output/cli/index.mjs`.
 *
 * Everything it needs goes inside the bundle, for the same reason the server's
 * dependencies are vendored into `.output`: a published install resolves
 * nothing and compiles nothing. Ink and React are build-time concerns here, not
 * things a machine that only wants to run this should have to download.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(root, '.output', 'cli', 'index.mjs')

await build({
  entryPoints: [join(root, 'cli', 'index.tsx')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  // Matches the floor in package.json's `engines`, so the bundle cannot quietly
  // require something newer than the package claims to run on.
  target: 'node18',
  jsx: 'automatic',
  alias: {
    '~': join(root, 'app'),
    // Optional peer of Ink, imported statically and only used under `DEV=true`.
    'react-devtools-core': join(root, 'cli', 'stubs', 'react-devtools-core.ts'),
  },
  // Ink's dependencies are ESM-only and reach for these, which do not exist in
  // an ESM bundle. Without the shim the app dies on the first render.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module'",
      "import { fileURLToPath as __fileURLToPath } from 'node:url'",
      "import { dirname as __dirname_ } from 'node:path'",
      'const require = __createRequire(import.meta.url)',
      'const __filename = __fileURLToPath(import.meta.url)',
      'const __dirname = __dirname_(__filename)',
    ].join('\n'),
  },
  logLevel: 'info',
})

console.log(`Bundled the terminal app into ${outfile}`)
