import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * Who did this.
 *
 * The merge commit already records that somebody went ahead over a failing
 * check. It does not record who, and neither does anything else here: a run, a
 * turn and a landing were all written by "the machine". On one person's laptop
 * that is fine. The moment a second person has this open, the two questions
 * worth asking — *who merged with the checks red*, and *whose rituals cost that*
 * — have no answer at all, not for want of records but for want of a name on
 * them.
 *
 * Identity is git's, and only git's: `user.name` and `user.email` as the
 * repository resolves them, which is already the name on every commit this app
 * makes. There are no accounts, no login and no store of people, because all
 * three would be a second source of truth about a fact git is keeping anyway —
 * and the one that ends up in the history is git's regardless of what any store
 * here said.
 *
 * **Nothing is inferred.** `git var GIT_COMMITTER_IDENT` would always answer,
 * because git invents a name from the system login and the hostname when the
 * config is empty. That invented name is a person who never agreed to be one,
 * filed against merges they did not take. So the two settings are read directly
 * and a repository with neither answers `undefined` — which every reader turns
 * into *unattributed*, never into whoever happens to be sitting here.
 *
 * Records written before any of this carry no identity, and read as the same
 * thing for the same reason. That is the whole of the migration: unattributed is
 * a real answer, and it is the honest one about a record that never held a name.
 */

export interface Identity {
  /** `user.name`, for reading. Absent when the repository resolves none. */
  name?: string
  /** `user.email` — the half that survives a rename. See `personKey`. */
  email?: string
}

/**
 * One setting, as this repository resolves it — local, then global, then system,
 * the same order every `git commit` uses.
 *
 * Exit 1 is "not set", and every other failure is the same answer here: git is
 * not installed, the directory is not a repository, the worktree has been
 * removed. None of those is a person, and guessing one is the mistake this file
 * exists to avoid.
 */
async function setting(dir: string, key: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', ['config', '--get', key], { cwd: dir, timeout: 5_000 })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * The person this machine is acting as, in one repository.
 *
 * Resolved at the moment of the act and written onto the record there and then,
 * rather than looked up again when something reads it back. `user.email` is a
 * setting somebody can change, and a merge taken in March has to keep saying who
 * took it in March — a record that resolves its own author lazily reattributes
 * the past every time the config moves.
 */
export async function gitIdentity(dir: string): Promise<Identity | undefined> {
  const [name, email] = await Promise.all([
    setting(dir, 'user.name'),
    setting(dir, 'user.email'),
  ])

  if (!name && !email) return undefined

  return { ...(name ? { name } : {}), ...(email ? { email } : {}) }
}

/**
 * What two records have to agree on to be the same person.
 *
 * The email, lower-cased, because it is the half that survives: people rewrite
 * `user.name`, and two of them sharing a name matters in a table that adds up
 * money against it. A repository with only a name configured falls back to the
 * name, which is a worse key and still better than dropping the work on the
 * floor. Undefined when there is nobody, which is not a key and must never
 * become one.
 */
export function personKey(identity?: Identity): string | undefined {
  const email = identity?.email?.trim().toLowerCase()
  if (email) return email

  return identity?.name?.trim() || undefined
}

/**
 * The person, short, for prose. Undefined when there is nobody.
 *
 * The name alone where there is one, because a sentence in a morning briefing
 * that reads "merged into main by Ada Lovelace <ada@example.com>" is an address
 * pasted into a paragraph. `describePerson` is the other one, for the places
 * where the address is the point.
 */
export function personName(identity?: Identity): string | undefined {
  return identity?.name?.trim() || identity?.email?.trim() || undefined
}

/** The person, in full, for a record or a commit. Undefined when there is nobody. */
export function describePerson(identity?: Identity): string | undefined {
  const name = identity?.name?.trim()
  const email = identity?.email?.trim()

  if (name && email) return `${name} <${email}>`

  return name || email || undefined
}

/**
 * The line an override leaves in the merge commit.
 *
 * In the commit and not only on the session record, because six months on the
 * question "was this known to be broken when it landed, and who decided that" is
 * asked of `git log` by somebody who has never opened this app. The unnamed case
 * says *why* it is unnamed rather than leaving a blank, so the answer reads as
 * "this repository has no identity configured" instead of "the app forgot".
 */
export function overrideNote(identity?: Identity): string {
  const who = describePerson(identity)

  return who
    ? `Override taken by ${who}.`
    : 'Override taken by an unnamed user — this repository has no git user.name or user.email set.'
}
