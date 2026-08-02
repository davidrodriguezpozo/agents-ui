import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { findScopeContaining, type ScopeRoot } from './scope'

export interface CommandPath {
  directory: string
  filename: string
}

/**
 * `git--sync` → `commands/git/sync.md`. Inverse of the slug built in `collect.ts`.
 *
 * Ambiguous by construction: a file named `my--command.md` at the root produces
 * the same slug as `my/command.md`, so prefer the deepest reading and let the
 * caller fall back. Use `slugCandidates` when the filesystem is available.
 */
export function slugToPath(slug: string): CommandPath {
  const parts = slug.split('--')
  if (parts.length === 1) {
    return { directory: '', filename: `${parts[0]}.md` }
  }
  const filename = `${parts.pop()}.md`
  return { directory: parts.join('/'), filename }
}

/**
 * Every path a slug could mean, deepest first. `a--b--c` might be
 * `a/b/c.md`, `a/b--c.md` or `a--b--c.md` — only the filesystem knows which.
 */
export function slugCandidates(slug: string): CommandPath[] {
  const parts = slug.split('--')
  const candidates: CommandPath[] = []

  for (let split = parts.length - 1; split >= 0; split--) {
    candidates.push({
      directory: parts.slice(0, split).join('/'),
      filename: `${parts.slice(split).join('--')}.md`,
    })
  }

  return candidates
}

export function commandSegments(path: CommandPath): string[] {
  return path.directory
    ? ['commands', ...path.directory.split('/'), path.filename]
    : ['commands', path.filename]
}

export interface ResolvedCommand extends CommandPath {
  root: ScopeRoot
  segments: string[]
  filePath: string
}

/** Find where a command slug actually lives, trying each reading in turn. */
export function resolveCommand(event: H3Event, slug: string): ResolvedCommand | null {
  for (const candidate of slugCandidates(slug)) {
    const segments = commandSegments(candidate)
    const root = findScopeContaining(event, ...segments)
    if (root) {
      return { ...candidate, root, segments, filePath: join(root.dir, ...segments) }
    }
  }
  return null
}

/** Where a new command should be written — no filesystem lookup involved. */
export function targetPathFor(slug: string): { path: CommandPath; segments: string[] } {
  const path = slugToPath(slug)
  return { path, segments: commandSegments(path) }
}

export { existsSync }
