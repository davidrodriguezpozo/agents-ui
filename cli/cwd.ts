import { execFileSync } from 'node:child_process'

/**
 * Which project you are standing in.
 *
 * The browser has no answer to this and has to be told; a terminal does, and
 * `git` has trained everybody to expect it — you run `git status` in a
 * repository and it talks about that repository. So `agents-studio work` in a
 * checkout means this checkout, without a flag, and the app's own active
 * project is the fallback for when you are somewhere else entirely.
 *
 * Only projects the app already knows are honoured. Scoping to a repository it
 * has never heard of would produce a correct and useless "nothing here".
 */
export function gitRoot(cwd = process.cwd()): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
  } catch {
    return null
  }
}

/**
 * The project to scope this invocation to: what was asked for, then where you
 * are, then whatever the app was last pointed at.
 */
export function scopeFor(
  options: { project?: string; here: string | null; known: string[]; fallback: string | null },
): string | null {
  if (options.project) return options.project
  if (options.here && options.known.includes(options.here)) return options.here
  return options.fallback
}
