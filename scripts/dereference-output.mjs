#!/usr/bin/env node

import { cpSync, lstatSync, readdirSync, readlinkSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Turn every symlink inside `.output` into a real copy, before packing.
 *
 * Nitro deduplicates the server's vendored dependencies by symlinking some of
 * them into `.output/server/node_modules/.nitro/` — `@vueuse/core` and
 * `@vueuse/shared` at the time of writing. npm's tarball silently drops
 * symlinks: the targets under `.nitro/` ship, the links pointing at them do
 * not, and the package installs looking complete.
 *
 * It fails in the least helpful way possible. The API answers, the health
 * check passes, the server logs nothing at boot — and every page render dies
 * with `Cannot find package '@vueuse/core'`. Caught only by installing the
 * tarball and asking for a page, which is why that is now part of the release
 * check rather than something to remember.
 *
 * Copying costs a few hundred kilobytes of duplication, which is nothing
 * against shipping a package that cannot render.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = join(root, '.output')

let replaced = 0

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stats = lstatSync(path)

    if (stats.isSymbolicLink()) {
      const target = resolve(dirname(path), readlinkSync(path))

      if (!existsSync(target)) {
        console.error(`  dangling symlink, leaving alone: ${path}`)
        continue
      }

      rmSync(path)
      // `dereference` so a symlink pointing at more symlinks resolves all the
      // way down rather than copying the problem across.
      cpSync(target, path, { recursive: true, dereference: true })
      replaced++
      continue
    }

    if (stats.isDirectory()) walk(path)
  }
}

if (!existsSync(outputDir)) {
  console.error('No .output to prepare — build first.')
  process.exit(1)
}

walk(outputDir)
console.log(`Dereferenced ${replaced} symlink${replaced === 1 ? '' : 's'} in .output`)
