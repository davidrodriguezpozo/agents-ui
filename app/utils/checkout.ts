/**
 * When a session's checkout stops being the branch on record.
 *
 * A session is created with a branch of its own, cut from wherever the main
 * checkout happened to be. Then the agent inside it runs `gh pr checkout`, or
 * `git switch`, and the worktree is on something else entirely — which is
 * usually the correct thing for it to have done: `/hd:review <url>` is *about*
 * somebody else's branch, and stacked work is about another session's.
 *
 * Nothing wrote it down, and three separate answers went wrong as a result.
 * All three were observed live, on one repository, on the same afternoon:
 *
 *  - **The diff.** `ahead` and `changedFiles` are measured from HEAD against
 *    the *recorded* base, and once HEAD is on an unrelated lineage the merge
 *    base between them is months back. Five review sessions each reported
 *    2,200-odd changed files and 214 commits ahead; measured against the
 *    repository's default branch the same sessions are 7 files and 2 commits.
 *  - **The merge.** `mergeSession` merges `session.branch`. The branch on
 *    record has no commits on it, so the merge is either a no-op or — worse —
 *    the preview says "this session has not committed anything yet" over a
 *    worktree holding two commits of real work.
 *  - **"Landed".** `hasLanded` needs two facts and, drifted, takes one from each
 *    branch: `ahead > 0` from the checkout, and `merged.has(branch)` from the
 *    record, whose untouched tip *is* the base commit and so is trivially
 *    contained in it. The guard written to stop an empty session reading as a
 *    finished one is defeated by being handed halves of two different branches.
 *
 * So this is one small predicate, kept pure and shared, because the server has
 * to refuse a merge on it and the session page has to say it — and those two
 * disagreeing about whether a checkout has moved is the same class of bug as
 * the one above.
 */

export interface CheckoutFacts {
  /** The branch the session record names. */
  recorded: string
  /** What the worktree is on, as git reports it. Null when nobody has looked. */
  actual: string | null | undefined
  /**
   * The worktree holds a commit rather than a branch, and was made that way.
   *
   * A review session is a detached checkout of a pull request's head: it must
   * not hold the branch, because somebody else is working on it and taking it
   * would be the bug rather than the fix. Its record still names that branch,
   * since that is what a person needs to read — so "the record names a branch
   * the worktree is not on" is *true by construction* here and is not drift.
   * Repairing it would do real damage.
   */
  detached?: boolean
}

/**
 * Whether the worktree has wandered off the branch the record made for it.
 *
 * Three separate "no" answers, and every one of them was a way to get this
 * wrong:
 *
 *  - **Made detached on purpose.** See above. Never drift.
 *  - **Not read yet.** A worktree that is gone, or that no poll has reached,
 *    reports `null`. Treating "we have not looked" as "it has moved" would
 *    refuse a merge on every cold poll — this bug, inverted.
 *  - **Detached by accident.** A rebase or a bisect in progress reports `HEAD`,
 *    which is not one branch disagreeing with another, and it resolves itself
 *    without anybody needing to be told.
 */
export function checkoutDrifted({ recorded, actual, detached }: CheckoutFacts): boolean {
  if (detached) return false
  if (!recorded || !actual) return false
  if (actual === 'HEAD') return false
  return actual !== recorded
}

/**
 * The one sentence every surface says about it.
 *
 * Written once for the reason `baseCheckoutState` gives about its own refusals:
 * two places wording the same fact differently is how somebody concludes they
 * are looking at two different problems.
 */
export function driftNote(recorded: string, actual: string): string {
  return `This worktree is on ${actual}, not the ${recorded} branch this session records. `
    + 'Its diff is measured against the default branch instead, and it will not merge '
    + 'until they agree — merging the recorded branch would land the wrong work.'
}

/**
 * Short form, for a row that has no room for the reason.
 */
export function driftChip(actual: string): string {
  return `on ${actual}`
}

/**
 * Why a review workspace has nothing to land.
 *
 * The sibling of the above, and it exists because the two are opposite mistakes
 * about the same disagreement. A drifted session must not merge the branch on
 * record because the work is elsewhere. A *review* session must not merge it
 * because the work is somebody else's: its workspace is a detached checkout of a
 * pull request's head, and `baseBranch..branch` counts the author's commits, so
 * the merge preview would happily offer to bring a colleague's branch into your
 * local base.
 *
 * Not drift — the record is correct here, which is exactly why the drift check
 * cannot catch it and this has to be asked separately.
 */
export function reviewOnlyNote(branch: string): string {
  return `This is a read-only checkout of ${branch} for reviewing it. `
    + 'Nothing here is yours to land — merge it from Land, or on github.com, '
    + 'where the pull request itself is what gets merged.'
}
