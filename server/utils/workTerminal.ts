import type { H3Event } from 'h3'
import { getProjectDir } from './scope'
import { readProjectState } from './projects'

/**
 * Which shell a request to `/api/terminal` means.
 *
 * The session terminal answers this with a session id and its worktree. There
 * is no session here — the Work view is the page you stand on *between*
 * sessions — so the shell is identified by the project you have selected, which
 * is the same thing every other surface on that page is scoped to.
 *
 * The id is namespaced because `utils/terminal.ts` keeps one map for every
 * shell in the process, session and project alike. `work:` cannot collide with
 * a session id, and it makes a stray entry recognisable in a heap dump.
 */

export interface WorkTerminalTarget {
  id: string
  cwd: string
}

/**
 * The selected project, or the active one.
 *
 * `getProjectDir` reads the `x-project-dir` header the client interceptor
 * stamps on every `$fetch`, or a `projectDir` query parameter — which is the
 * branch the stream uses, because `EventSource` cannot send headers.
 *
 * Registered-only, deliberately. `getProjectDir` proves a path is absolute and
 * exists; it does not prove it is one of yours, and this endpoint's whole job
 * is to start a shell in whatever it is handed. Restricting it to directories
 * already in the project list keeps an arbitrary path out of the URL surface
 * without costing anything a real user would notice — the picker only ever
 * sends paths that are in that list.
 *
 * This is not the security boundary; there isn't one, by design (see the note
 * at the top of `terminal.ts` — anything typed into a shell here runs as you).
 * It is the difference between a URL that names a directory and a URL that
 * chooses one.
 */
export async function resolveWorkTerminal(event: H3Event): Promise<WorkTerminalTarget> {
  const requested = getProjectDir(event)
  const state = await readProjectState()
  const known = new Set(state.projects.map(p => p.path))

  /**
   * A request that names a project is answered with that project or not at all.
   *
   * Falling back to the active one would be worse than the error: the shell
   * would open, in a directory the caller did not ask for, and the first thing
   * anyone would know about it is a command running against the wrong
   * repository. A named-but-unknown project is a mistake to report, not one to
   * paper over.
   */
  if (requested && !known.has(requested)) {
    throw createError({
      statusCode: 400,
      message: `Not a project on this machine: ${requested}`,
    })
  }

  // Nothing named, so the active project — which is what the page is showing
  // anyway on a first load, before the client has stamped anything.
  const cwd = requested
    ?? (state.activePath && known.has(state.activePath) ? state.activePath : null)

  if (!cwd) {
    throw createError({
      statusCode: 400,
      message: 'No project is selected, so there is nowhere to open a shell.',
    })
  }

  return { id: `work:${cwd}`, cwd }
}
