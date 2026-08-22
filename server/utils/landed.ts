import { patchSession } from './sessions'
import { personName, type Identity } from './identity'

/**
 * What shipped.
 *
 * Nothing recorded a merge. The branch went into `main`, the session record was
 * touched to say `updatedAt` and otherwise looked exactly as it had a minute
 * before — idle, checks passing, work in flight. So every surface that asks
 * "what came out of last night" had to answer with sessions that were *ready*,
 * and the one thing anybody actually wants to know first was unanswerable: what
 * landed. The standing brief shipped without that line for exactly this reason.
 *
 * **Three ways in, one record.** This is the part worth being careful about,
 * because a field called `mergedAt` written in one of them would have been worse
 * than nothing — a session that landed by another route would read as one that
 * never landed at all:
 *
 *   - `mergeSession` merges the branch into its base here, on this machine.
 *     Recorded inside that function rather than by its callers, because there are
 *     two of them and a third will be along.
 *   - the pull request watcher merges the pull request itself once CI is green.
 *   - the watcher finds the pull request already `MERGED`, which means a person
 *     merged it on github.com and nothing here did anything at all.
 *
 * The third is why `how` exists rather than a boolean. "It is in" and "we put it
 * in" are different facts, and only one of them is this app taking credit.
 */

export type LandedHow =
  /** A git merge into the base branch, by this machine. */
  | 'merged'
  /** This app merged the pull request once it was green. */
  | 'pull-request'
  /** Found already merged. Somebody did it on github.com. */
  | 'elsewhere'

export interface SessionLanded {
  at: number
  how: LandedHow
  /** The branch it went into. Only known when this machine did the merge. */
  into?: string
  /** How many commits came across, same caveat. */
  commits?: number
  /**
   * It went in over a failing check.
   *
   * Kept because it is a decision somebody made with reasons, and the question
   * "was this known to be broken when it landed" deserves an answer six months
   * later. The merge commit says so too — this is the same fact where a list can
   * read it without parsing git history.
   */
  overrodeChecks?: boolean
  /** The pull request, when that is what landed. */
  pr?: number
  /**
   * The commit on the base branch that carries the work.
   *
   * The merge commit, for the two routes that produce one here. It is kept
   * because a landing with no commit named cannot be followed up on: `revertWatch`
   * asks whether the base branch has since taken the work back out, and the only
   * thing that question can be asked *of* is a commit. Absent on every record
   * written before this existed, and on a landing whose merge commit is not on
   * this machine at all — see `revertWatch.ts` for what that costs.
   */
  sha?: string
  /**
   * Who put it in, as git names them. See `identity.ts`.
   *
   * Written for the two routes this machine takes — the merge here, and the pull
   * request this app merged once CI came good — because in both of them the
   * commit git wrote carries this same identity, so the record and the history
   * agree about one person.
   *
   * Deliberately never written for `elsewhere`. That merge happened on
   * github.com and nothing here did any of it; stamping it with the identity of
   * whoever's machine noticed would be this app claiming a colleague's merge,
   * which is the exact failure this field exists to prevent. GitHub knows who
   * did it and is the place to ask.
   *
   * Absent on every landing recorded before this existed, which reads as
   * unattributed.
   */
  by?: Identity
}

/**
 * File the landing against the session.
 *
 * Never throws, and deliberately so. A merge that has already happened must not
 * be reported as failed because the bookkeeping afterwards did — the branch is
 * in, and the caller telling somebody otherwise would send them to undo a merge
 * that was fine. A landing this fails to record is a missing line in a report,
 * which is the smaller loss by a wide margin.
 */
export async function recordLanded(sessionId: string, landed: SessionLanded): Promise<void> {
  try {
    await patchSession(sessionId, { landed })
  } catch (e: any) {
    console.log(`[landed] could not record ${sessionId}: ${e?.message ?? e}`)
  }
}

/**
 * Landings inside a window, newest first.
 *
 * The presence of the record is checked separately from its timestamp, rather
 * than defaulting the missing one to zero and comparing. `0 >= 0` is true, so a
 * window of "since the beginning of time" quietly returned every session that
 * had never landed — as a list of landings.
 */
export function landedSince<T extends { landed?: SessionLanded }>(sessions: T[], since: number): T[] {
  return sessions
    .filter((session): session is T & { landed: SessionLanded } => Boolean(session.landed))
    .filter(session => session.landed.at >= since)
    .sort((a, b) => b.landed.at - a.landed.at)
}

/**
 * How it got in, in words, for a line somebody reads.
 *
 * The base branch is named where it is known, because "landed" without a
 * destination is only half a fact on a machine with several long-lived branches
 * — and it is exactly the half that matters when something lands in the wrong
 * one.
 *
 * The person is named the same way and for the same reason: on a machine one
 * person uses it adds nothing, and on a machine two people share it is the first
 * thing either of them wants to know. Nothing is said when the record carries
 * nobody, which is every landing from before identity was recorded — the
 * sentence simply reads as it always did rather than guessing.
 */
export function describeLanded(landed: SessionLanded): string {
  // Read off the record rather than resolved now: `by` was written at the moment
  // of the merge, and a config changed since must not rewrite who did it.
  const who = personName(landed.by)
  const by = who ? ` by ${who}` : ''

  if (landed.how === 'elsewhere') {
    // Never named, because this app was not there — see `SessionLanded.by`.
    return landed.pr
      ? `#${landed.pr} was merged on GitHub — not by this machine`
      : 'merged somewhere else, not by this machine'
  }

  if (landed.how === 'pull-request') {
    return `#${landed.pr} passed CI and was merged${by}`
  }

  const into = landed.into ? ` into ${landed.into}` : ''
  const over = landed.overrodeChecks ? ', over a failing check' : ''
  return `merged${into}${over}${by}`
}
