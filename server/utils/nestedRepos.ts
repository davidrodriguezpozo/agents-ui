import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isGitRepo } from './worktrees'

/**
 * Finding the repository inside a folder that is not one.
 *
 * A common way to lay out work, and one this app had no answer for:
 *
 *   project/            no git
 *     app/              the repository
 *     specs/            notes, designs, requirements
 *
 * You point the app at `project/` — because that is the thing you are working
 * on, and because the specs are half of what Claude needs to read — and every
 * session is refused: not a git repository, cannot be branched. True, and
 * useless, because the repository it wants is one directory down and plainly
 * visible.
 *
 * Terminal Claude Code has no trouble here. You run it in `project/`, it reads
 * everything, and git work happens wherever git happens to live. Sessions
 * cannot do that — a worktree has to be a worktree *of* something — but they
 * can at least stop pretending there is nothing to work with.
 */

/** Never worth walking a whole tree; the answer is one or two levels down or it is not there. */
const MAX_DEPTH = 2
const MAX_RESULTS = 12

/** Directories that are never the answer and are expensive to walk. */
const SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'vendor', 'target',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.worktrees',
])

export interface NestedRepo {
  path: string
  name: string
  /** 1 for a direct child, 2 for a grandchild — a direct child is the likely answer. */
  depth: number
}

/**
 * Repositories inside `dir`, nearest first.
 *
 * Stops descending into a directory once it turns out to be a repository: the
 * repositories *inside* a repository are its business, not a choice to offer.
 */
export async function findRepositoriesIn(dir: string): Promise<NestedRepo[]> {
  if (!existsSync(dir)) return []

  const found: NestedRepo[] = []

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || found.length >= MAX_RESULTS) return

    let entries: string[]
    try {
      entries = (await readdir(current, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && !SKIP.has(entry.name) && !entry.name.startsWith('.'))
        .map(entry => entry.name)
    } catch {
      // Unreadable directory — not worth failing the whole search over.
      return
    }

    for (const name of entries.sort()) {
      if (found.length >= MAX_RESULTS) return

      const path = join(current, name)
      if (await isGitRepo(path)) {
        found.push({ path, name, depth })
        continue
      }

      await walk(path, depth + 1)
    }
  }

  await walk(dir, 1)
  return found.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
}
