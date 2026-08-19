import { describe, expect, it } from 'vitest'
import { checkoutDrifted, driftChip, driftNote } from '../app/utils/checkout'

/**
 * A session whose worktree is not on the branch its record names.
 *
 * Found on a real machine: 6 of 46 live sessions, including the one running at
 * the time. Five `/hd:review` sessions recorded
 * `hd-review-…-msy9ux9alyfo` while the checkout sat on
 * `feat/langfuse-conciliation-bootstrap` — the agent had run `gh pr checkout`,
 * which is exactly what a review session should do. Each then reported 2,231
 * changed files and 214 commits ahead, because the recorded base and the branch
 * actually checked out share a merge base from four months earlier. Measured
 * against the repository's default branch the same session is 7 files and 2
 * commits.
 *
 * The predicate is deliberately narrow: two kinds of unknown must not read as
 * drift, because both would block ordinary work.
 */

const RECORDED = 'hd-review-https-github-com-haddock-app-m-msy9ux9alyfo'
const ACTUAL = 'feat/langfuse-conciliation-bootstrap'

describe('checkoutDrifted', () => {
  it('sees a checkout that has moved to another branch', () => {
    expect(checkoutDrifted({ recorded: RECORDED, actual: ACTUAL })).toBe(true)
  })

  it('sees no drift when the checkout is on the branch on record', () => {
    expect(checkoutDrifted({ recorded: RECORDED, actual: RECORDED })).toBe(false)
  })

  it('treats a worktree nobody has read yet as no drift', () => {
    // `worktreeStatus` reports `null` for a worktree that is gone or not yet
    // looked at. Reading "we have not asked" as "it has moved" would refuse a
    // merge on every cold poll — the failure mode being fixed, inverted.
    expect(checkoutDrifted({ recorded: RECORDED, actual: null })).toBe(false)
    expect(checkoutDrifted({ recorded: RECORDED, actual: undefined })).toBe(false)
  })

  it('treats a detached HEAD as no drift', () => {
    // A rebase or a bisect in progress. Not a branch disagreeing with another
    // branch, and it resolves itself without anybody being told.
    expect(checkoutDrifted({ recorded: RECORDED, actual: 'HEAD' })).toBe(false)
  })

  it('says nothing about a session with no branch of its own', () => {
    expect(checkoutDrifted({ recorded: '', actual: ACTUAL })).toBe(false)
  })

  it('never calls a deliberately detached review session drifted', () => {
    /*
     * A review session is `git worktree add --detach` on the pull request's head
     * commit, and its record still names the head *branch* because that is what
     * a person reads. Both shapes of that arrive here — git reporting no branch,
     * and a record naming one nobody is on — and neither is drift.
     *
     * This one matters more than the others: the repair for drift is to stop
     * measuring against the recorded base, and for a review session the honest
     * answer is the recorded base. Worse, anything that "fixed" the checkout by
     * taking the branch back out would take it from the person working on it.
     */
    expect(checkoutDrifted({ recorded: 'feat/some-pr-head', actual: null, detached: true })).toBe(false)
    expect(checkoutDrifted({ recorded: 'feat/some-pr-head', actual: 'HEAD', detached: true })).toBe(false)
    expect(checkoutDrifted({ recorded: 'feat/some-pr-head', actual: 'other', detached: true })).toBe(false)
  })
})

describe('what it says about it', () => {
  it('names both branches, so the sentence is actionable on its own', () => {
    const note = driftNote(RECORDED, ACTUAL)
    expect(note).toContain(RECORDED)
    expect(note).toContain(ACTUAL)
  })

  it('says why the merge is refused rather than only that it is', () => {
    // A refusal that does not carry its reason reads as the app being broken —
    // the same argument `baseCheckoutState` makes about its own wording.
    expect(driftNote(RECORDED, ACTUAL)).toMatch(/land the wrong work/)
  })

  it('has a short form for a row with no room for the reason', () => {
    expect(driftChip(ACTUAL)).toBe(`on ${ACTUAL}`)
  })
})
