import { findSession } from './sessions'

/**
 * Where a permission granted from a run should be remembered.
 *
 * Rituals learned this a while ago: blocked on `Bash(gh:*)` once, granted
 * exactly that, and they stop asking. Everything else kept asking forever,
 * which is the same thing as never being able to leave it running.
 *
 * The trap is the obvious answer. A session's working directory is its
 * worktree, and that directory is deleted when the session closes — a
 * permission filed against it would be granted, look granted, and then be
 * gone, along with any explanation. Rules belong to the repository, which is
 * the unit the answer is actually about: "running the tests here is fine" is
 * true of the project, not of the one conversation that first needed to ask.
 */
export async function rulesDirFor(
  run: { sessionId?: string; projectDir?: string },
): Promise<string | undefined> {
  if (run.sessionId) {
    const session = await findSession(run.sessionId).catch(() => null)
    if (session) return session.repoDir
  }

  return run.projectDir
}
