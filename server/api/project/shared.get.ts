import { getProjectDir } from '../../utils/scope'
import { readSharedProject, SHARED_FILE } from '../../utils/sharedProject'

/**
 * What this repository shares, and what is wrong with it.
 *
 * Read straight off the working tree every time rather than cached: the whole
 * point is that it arrives by `git pull`, and a cache would mean a colleague's
 * change showing up whenever this process happened to restart.
 *
 * `problems` is the half that matters most. A shared definition somebody
 * mistyped, or one that names a path only their machine has, is invisible
 * otherwise — the row is simply absent, or present and never firing, with
 * nothing anywhere saying why.
 */
export default defineEventHandler(async (event) => {
  const dir = (getQuery(event).dir as string) || getProjectDir(event)
  if (!dir) return { dir: null, exists: false, file: SHARED_FILE, config: {}, problems: [] }

  const read = await readSharedProject(dir)

  return {
    dir,
    exists: read.exists,
    /** Relative, because that is how somebody refers to it in a repository. */
    file: SHARED_FILE,
    path: read.path,
    config: read.config,
    problems: read.problems,
  }
})
