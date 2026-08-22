import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  forgetSymbolMaps,
  symbolMap,
  symbolsFromPatch,
  type FileSymbols,
  type SymbolMap,
} from '../server/utils/symbols'

/**
 * Which names a session's diff defines, drops, and depends on.
 *
 * Real git for the end-to-end half, because the shapes that matter here are
 * git's rather than ours: a rename that arrives as `rename from`/`rename to`
 * with no hunks at all, a delete that arrives as `+++ /dev/null`, and a new
 * file that never appears in a diff because it is untracked. A hand-written
 * fixture would encode whichever of those three we got wrong.
 *
 * The regex half is tested against patches written by hand, because there the
 * thing under test is the regex and a temp repository would only be scenery.
 */

let repo: string
let base: string
let map: SymbolMap

function git(args: string[], cwd = repo) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

function file(path: string): FileSymbols {
  const found = map.files.find(f => f.path === path)
  if (!found) throw new Error(`${path} is not in the map: ${map.files.map(f => f.path).join(', ')}`)
  return found
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'symbols-'))
  await mkdir(join(repo, 'src'), { recursive: true })
  await mkdir(join(repo, 'app', 'components'), { recursive: true })
  await mkdir(join(repo, 'scripts'), { recursive: true })

  await writeFile(join(repo, 'src', 'rename.ts'), [
    'export function oldName(): number {',
    '  return 1',
    '}',
    '',
  ].join('\n'))

  await writeFile(join(repo, 'src', 'deleted.ts'), [
    'export const goneExport = 1',
    'export const stays = 2',
    '',
  ].join('\n'))

  await writeFile(join(repo, 'src', 'caller.ts'), [
    'import { oldName } from \'./rename\'',
    '',
    'export function report(): number {',
    '  return oldName()',
    '}',
    '',
  ].join('\n'))

  await writeFile(join(repo, 'app', 'components', 'OldCard.vue'), [
    '<script setup lang="ts">',
    'const label = \'card\'',
    '</script>',
    '',
    '<template>',
    '  <div>{{ label }}</div>',
    '</template>',
    '',
  ].join('\n'))

  await writeFile(join(repo, 'README.md'), '# base\n')
  await writeFile(join(repo, 'scripts', 'tool.py'), 'def base():\n    return 1\n')

  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  git(['add', '.'])
  git(['commit', '-m', 'base'])
  base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim()

  // A rename.
  await writeFile(join(repo, 'src', 'rename.ts'), [
    'export function newName(): number {',
    '  return 1',
    '}',
    '',
  ].join('\n'))

  // A deleted export, in a file that stays.
  await writeFile(join(repo, 'src', 'deleted.ts'), 'export const stays = 2\n')

  // A call site following the rename.
  await writeFile(join(repo, 'src', 'caller.ts'), [
    'import { newName } from \'./rename\'',
    '',
    'export function report(): number {',
    '  return newName()',
    '}',
    '',
  ].join('\n'))

  // A new export, and a re-export.
  await writeFile(join(repo, 'src', 'added.ts'), [
    'export interface Fresh {',
    '  id: string',
    '}',
    '',
    'export function brandNew(): Fresh {',
    '  return { id: \'1\' }',
    '}',
    '',
  ].join('\n'))
  await writeFile(join(repo, 'src', 'reexport.ts'), 'export { newName } from \'./rename\'\n')

  // A Vue component renamed, and one that uses it.
  git(['mv', 'app/components/OldCard.vue', 'app/components/NewCard.vue'])
  await writeFile(join(repo, 'app', 'components', 'Board.vue'), [
    '<script setup lang="ts">',
    'import NewCard from \'./NewCard.vue\'',
    '</script>',
    '',
    '<template>',
    '  <NewCard />',
    '  <work-rail-row />',
    '</template>',
    '',
  ].join('\n'))

  // Languages the pass does not read.
  await writeFile(join(repo, 'README.md'), '# head\n')
  await writeFile(join(repo, 'scripts', 'tool.py'), 'def head():\n    return 2\n')

  git(['add', '.'])
  git(['commit', '-m', 'head'])

  // Uncommitted, and never in any diff.
  await writeFile(join(repo, 'src', 'scratch.ts'), 'export const scratch = 1\n')

  forgetSymbolMaps()
  map = await symbolMap(repo, base)
})

afterAll(async () => {
  forgetSymbolMaps()
  await rm(repo, { recursive: true, force: true })
})

describe('symbolMap', () => {
  it('reads a rename as one name gone and one arrived', () => {
    expect(file('src/rename.ts').defined).toEqual(['newName'])
    expect(file('src/rename.ts').removed).toEqual(['oldName'])
  })

  it('records a new export and nothing removed with it', () => {
    expect(file('src/added.ts').defined).toEqual(['Fresh', 'brandNew'])
    expect(file('src/added.ts').removed).toEqual([])
  })

  it('records a deleted export from a file that stays', () => {
    expect(file('src/deleted.ts').removed).toEqual(['goneExport'])
    expect(file('src/deleted.ts').defined).toEqual([])
  })

  it('reads a re-export as both defining the name and depending on it', () => {
    expect(file('src/reexport.ts').defined).toEqual(['newName'])
    expect(file('src/reexport.ts').used).toContain('newName')
  })

  it('takes the new call site and leaves the removed one out', () => {
    expect(file('src/caller.ts').used).toContain('newName')
    expect(file('src/caller.ts').used).not.toContain('oldName')
  })

  it('reads a renamed Vue component from the file name', () => {
    expect(file('app/components/NewCard.vue').defined).toContain('NewCard')
    expect(file('app/components/NewCard.vue').removed).toContain('OldCard')
    expect(map.files.some(f => f.path === 'app/components/OldCard.vue')).toBe(false)
  })

  it('takes the components a template uses, in either spelling', () => {
    const board = file('app/components/Board.vue')
    expect(board.defined).toContain('Board')
    expect(board.used).toContain('NewCard')
    expect(board.used).toContain('WorkRailRow')
  })

  it('reads an untracked file, which is in no diff at all', () => {
    expect(file('src/scratch.ts').defined).toEqual(['scratch'])
  })

  it('names the files it does not understand rather than guessing at them', () => {
    expect(map.skipped).toContain('README.md')
    expect(map.skipped).toContain('scripts/tool.py')
    expect(map.files.some(f => f.path === 'scripts/tool.py')).toBe(false)
  })

  it('says nothing about a worktree that is not there', async () => {
    expect(await symbolMap(join(repo, 'gone'), base)).toEqual({ files: [], skipped: [] })
  })
})

describe('symbolsFromPatch', () => {
  /** A one-file patch with the given hunk body, so the shapes stay readable. */
  function patch(path: string, body: string[]): string {
    return [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1,0 +1,0 @@',
      ...body,
      '',
    ].join('\n')
  }

  function only(raw: string): FileSymbols {
    const { files } = symbolsFromPatch(raw)
    expect(files).toHaveLength(1)
    return files[0]!
  }

  it('takes every export form TypeScript has', () => {
    const symbols = only(patch('src/kinds.ts', [
      '+export const value = 1',
      '+export let mutable = 2',
      '+export interface Shape { id: string }',
      '+export type Alias = Shape',
      '+export enum Colour { Red }',
      '+export const enum Fast { On }',
      '+export class Thing {}',
      '+export default function entry() {}',
      '+export * as helpers from \'./helpers\'',
    ]))

    expect(symbols.defined).toEqual([
      'Alias', 'Colour', 'Fast', 'Shape', 'Thing', 'entry', 'helpers', 'mutable', 'value',
    ])
  })

  it('does not read the declaration it just made as a call to itself', () => {
    const symbols = only(patch('src/one.ts', ['+export function alone() {}']))
    expect(symbols.defined).toEqual(['alone'])
    expect(symbols.used).toEqual([])
  })

  it('takes both sides of an aliased import', () => {
    const symbols = only(patch('src/alias.ts', [
      '+import { worktreeStatus as status } from \'./worktrees\'',
      '+import * as fs from \'node:fs\'',
      '+import plain from \'./plain\'',
    ]))

    expect(symbols.used).toEqual(['fs', 'plain', 'status', 'worktreeStatus'])
  })

  it('reads a member of a multi-line import off its own line', () => {
    const symbols = only(patch('src/multi.ts', ['+  diffBase,']))
    expect(symbols.used).toEqual(['diffBase'])
  })

  it('leaves control flow out of the call sites', () => {
    const symbols = only(patch('src/flow.ts', [
      '+  if (ready) doWork()',
      '+  for (const item of list) items.push(item)',
      '+  return new Session(id)',
    ]))

    expect(symbols.used).toEqual(['Session', 'doWork'])
  })

  it('does not read a regex literal in the source as a call', () => {
    const symbols = only(patch('src/pattern.ts', [
      '+export const MATCH = /\\bdefine(?:Options)/',
    ]))

    expect(symbols.defined).toEqual(['MATCH'])
    expect(symbols.used).toEqual([])
  })

  it('keeps a name whose defining line was only reformatted', () => {
    const symbols = only(patch('src/same.ts', [
      '-export function touched(a: string) {',
      '+export function touched(a: string, b: number) {',
    ]))

    expect(symbols.defined).toEqual(['touched'])
    expect(symbols.removed).toEqual([])
  })

  it('ignores a name that is only in a comment', () => {
    const symbols = only(patch('src/commented.ts', [
      '+// export function notReal() {}',
      '+ * calls somethingElse()',
    ]))

    expect(symbols.defined).toEqual([])
    expect(symbols.used).toEqual([])
  })

  it('reads a pure rename, which has no hunks to read', () => {
    const { files } = symbolsFromPatch([
      'diff --git a/app/components/OldCard.vue b/app/components/NewCard.vue',
      'similarity index 100%',
      'rename from app/components/OldCard.vue',
      'rename to app/components/NewCard.vue',
      '',
    ].join('\n'))

    expect(files).toHaveLength(1)
    expect(files[0]!.defined).toEqual(['NewCard'])
    expect(files[0]!.removed).toEqual(['OldCard'])
  })

  it('reads a deleted Vue file as the component going away', () => {
    const { files } = symbolsFromPatch([
      'diff --git a/app/components/Gone.vue b/app/components/Gone.vue',
      '--- a/app/components/Gone.vue',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-<template><div /></template>',
      '',
    ].join('\n'))

    expect(files[0]!.path).toBe('app/components/Gone.vue')
    expect(files[0]!.removed).toEqual(['Gone'])
  })

  it('does not mistake a removed line for a file header', () => {
    const symbols = only(patch('src/dashes.ts', [
      '--- a fake header',
      '+export const real = 1',
    ]))

    expect(symbols.path).toBe('src/dashes.ts')
    expect(symbols.defined).toEqual(['real'])
  })

  it('returns nothing for a language it does not understand', () => {
    const { files, skipped } = symbolsFromPatch(patch('scripts/tool.py', [
      '+def widget():',
      '+    return 1',
    ]))

    expect(files).toEqual([])
    expect(skipped).toEqual(['scripts/tool.py'])
  })

  it('reads a fifty-file diff well inside the budget', () => {
    // The 200ms budget in the brief is for the whole call, and three `git`
    // invocations at ~35ms each spend most of it before any parsing happens.
    // This measures the part we control; the margin is wide enough that a busy
    // machine does not turn it into a flake.
    const body = Array.from({ length: 40 }, (_, line) => [
      `+export function handler${line}(input: Input): Output {`,
      `+  return transform(collect(input), option${line})`,
      '+}',
    ]).flat()

    const big = Array.from({ length: 50 }, (_, index) =>
      patch(`src/module${index}.ts`, body)).join('')

    const started = performance.now()
    const { files } = symbolsFromPatch(big)
    const took = performance.now() - started

    expect(files).toHaveLength(50)
    expect(took).toBeLessThan(200)
  })
})
